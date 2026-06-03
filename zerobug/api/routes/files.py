"""
File upload routes.

POST   /api/sessions/{session_id}/files                — multipart upload, accepts >=1 file
GET    /api/sessions/{session_id}/files                — list uploaded files
DELETE /api/sessions/{session_id}/files/{file_id}      — delete an upload

Uploaded files are persisted to disk under ``ZEROBUG_UPLOAD_DIR`` (defaults to
``zerobug/.uploads/<session_id>/<file_id>__<safe_name>``) and the metadata is
stored on the session under a JSON-encoded ``files`` attribute. The runtime
handler reads that list and injects it into the sandbox as the
``ZEROBUG_FILES`` env var so Claude can open the files on the fly with
whatever Python library suits the format — keeping the system tool-agnostic.

Prod note: replace the local-disk write with S3 by switching the
``_persist_file`` helper. The metadata shape stays the same.
"""
import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import List

import boto3
from fastapi import APIRouter, File, HTTPException, UploadFile

from logging_setup import get_logger, log_event

log = get_logger(__name__)

router = APIRouter()

_region = os.getenv("AWS_DEFAULT_REGION", "us-east-1")
_dynamo = boto3.resource("dynamodb", region_name=_region)

_dynamo_endpoint = os.getenv("DYNAMODB_ENDPOINT")
if _dynamo_endpoint:
    _dynamo = boto3.resource(
        "dynamodb",
        region_name=_region,
        endpoint_url=_dynamo_endpoint,
        aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID", "local"),
        aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY", "local"),
    )

_table = _dynamo.Table(os.getenv("DYNAMODB_TABLE_SESSIONS", "zerobug-sessions"))

# Default upload root: zerobug/.uploads/ (sibling of api/, runtime/, sandbox/)
_DEFAULT_UPLOAD_ROOT = Path(__file__).resolve().parent.parent.parent / ".uploads"
UPLOAD_ROOT = Path(os.getenv("ZEROBUG_UPLOAD_DIR", str(_DEFAULT_UPLOAD_ROOT)))
MAX_FILE_BYTES = int(os.getenv("ZEROBUG_MAX_FILE_MB", "20")) * 1024 * 1024
MAX_FILES_PER_SESSION = int(os.getenv("ZEROBUG_MAX_FILES_PER_SESSION", "30"))


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_filename(name: str) -> str:
    """Strip directory components and disallowed characters from an upload name."""
    base = os.path.basename(name or "upload")
    cleaned = "".join(c if c.isalnum() or c in (".", "-", "_") else "_" for c in base)
    return cleaned or "upload"


def _load_files(session: dict) -> list:
    raw = session.get("files", "[]")
    try:
        return json.loads(raw) if isinstance(raw, str) else (raw or [])
    except (json.JSONDecodeError, TypeError):
        return []


def _get_session_or_404(session_id: str) -> dict:
    resp = _table.get_item(Key={"session_id": session_id})
    item = resp.get("Item")
    if not item:
        raise HTTPException(status_code=404, detail="Session not found")
    return item


def _persist_files_field(session_id: str, files: list) -> None:
    _table.update_item(
        Key={"session_id": session_id},
        UpdateExpression="SET #f = :f",
        ExpressionAttributeNames={"#f": "files"},
        ExpressionAttributeValues={":f": json.dumps(files)},
    )


@router.post("/sessions/{session_id}/files", status_code=201)
async def upload_files(session_id: str, files: List[UploadFile] = File(...)):
    """Accept one or more files for the session, persist them, return metadata.

    The endpoint is intentionally generic — no per-format parsing happens
    here. We just store the bytes and record metadata; Claude reads the
    file contents at agent-runtime via the sandbox.
    """
    session = _get_session_or_404(session_id)
    existing = _load_files(session)

    if len(existing) + len(files) > MAX_FILES_PER_SESSION:
        raise HTTPException(
            status_code=413,
            detail=f"Per-session limit ({MAX_FILES_PER_SESSION}) reached.",
        )

    UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)
    session_dir = UPLOAD_ROOT / session_id
    session_dir.mkdir(parents=True, exist_ok=True)

    saved: list = []
    for upload in files:
        contents = await upload.read()
        if len(contents) > MAX_FILE_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"File '{upload.filename}' exceeds the {MAX_FILE_BYTES // (1024 * 1024)} MB limit.",
            )

        file_id = str(uuid.uuid4())
        safe_name = _safe_filename(upload.filename or "upload")
        disk_path = session_dir / f"{file_id}__{safe_name}"
        disk_path.write_bytes(contents)

        meta = {
            "id":            file_id,
            "name":          upload.filename or safe_name,
            "size":          len(contents),
            "content_type":  upload.content_type or "application/octet-stream",
            "path":          str(disk_path),
            "uploaded_at":   _now(),
        }
        saved.append(meta)
        existing.append(meta)

        log_event(
            "file.uploaded",
            session_id=session_id,
            file_id=file_id,
            name=meta["name"],
            size=meta["size"],
            content_type=meta["content_type"],
        )

    _persist_files_field(session_id, existing)

    return {"session_id": session_id, "files": saved, "all_files": existing}


@router.get("/sessions/{session_id}/files")
def list_files(session_id: str):
    session = _get_session_or_404(session_id)
    # Don't surface the on-disk path to the client — it's only needed by the
    # runtime/sandbox path that runs server-side.
    files = [
        {k: v for k, v in f.items() if k != "path"}
        for f in _load_files(session)
    ]
    return {"session_id": session_id, "files": files}


@router.delete("/sessions/{session_id}/files/{file_id}")
def delete_file(session_id: str, file_id: str):
    session = _get_session_or_404(session_id)
    files = _load_files(session)
    target = next((f for f in files if f.get("id") == file_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="File not found")

    try:
        Path(target.get("path", "")).unlink(missing_ok=True)
    except OSError:
        pass  # best-effort cleanup; metadata removal is the source of truth

    remaining = [f for f in files if f.get("id") != file_id]
    _persist_files_field(session_id, remaining)
    log_event("file.deleted", session_id=session_id, file_id=file_id)
    return {"session_id": session_id, "files": remaining}
