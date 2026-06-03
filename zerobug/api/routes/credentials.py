"""
Credential storage endpoints.

POST   /sessions/{session_id}/credentials          — store one encrypted credential
GET    /sessions/{session_id}/credentials/keys     — list stored key names only
DELETE /sessions/{session_id}                      — hard-delete session + all credentials
"""
import base64
import json
import os

import boto3
from botocore.exceptions import ClientError
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from logging_setup import get_logger, log_event

log = get_logger(__name__)

router = APIRouter()

_region    = os.getenv("AWS_DEFAULT_REGION", "us-east-1")
_kms       = boto3.client("kms", region_name=_region)
_dynamo    = boto3.resource("dynamodb", region_name=_region)
_KMS_KEY_ID = os.getenv("KMS_KEY_ID", "")

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


# ── helpers ───────────────────────────────────────────────────────────────────

def _get_session_or_404(session_id: str) -> dict:
    resp = _table.get_item(Key={"session_id": session_id})
    item = resp.get("Item")
    if not item:
        raise HTTPException(status_code=404, detail="Session not found")
    return item


def _require_active(session: dict) -> None:
    if session.get("status") not in ("active", "awaiting_approval"):
        raise HTTPException(
            status_code=409,
            detail=f"Session is {session.get('status')} — credentials cannot be modified",
        )


def _encrypt(plaintext: str) -> str:
    if not _KMS_KEY_ID:
        raise HTTPException(
            status_code=503,
            detail="KMS_KEY_ID is not configured on this server",
        )
    try:
        resp = _kms.encrypt(KeyId=_KMS_KEY_ID, Plaintext=plaintext.encode())
        return base64.b64encode(resp["CiphertextBlob"]).decode()
    except ClientError as exc:
        raise HTTPException(status_code=500, detail=f"KMS encrypt failed: {exc}") from exc


def _load_credentials(session: dict) -> dict:
    raw = session.get("credentials", "{}")
    try:
        return json.loads(raw) if isinstance(raw, str) else raw
    except (json.JSONDecodeError, TypeError):
        return {}


# ── models ────────────────────────────────────────────────────────────────────

class CredentialBody(BaseModel):
    key: str
    value: str


# ── routes ────────────────────────────────────────────────────────────────────

@router.post("/sessions/{session_id}/credentials", status_code=200)
def store_credential(session_id: str, body: CredentialBody):
    """Encrypt and store a single credential in the session."""
    session = _get_session_or_404(session_id)
    _require_active(session)

    encrypted_b64 = _encrypt(body.value)

    creds = _load_credentials(session)
    is_update = body.key in creds
    creds[body.key] = encrypted_b64

    _table.update_item(
        Key={"session_id": session_id},
        UpdateExpression="SET credentials = :c",
        ExpressionAttributeValues={":c": json.dumps(creds)},
        ConditionExpression="attribute_exists(session_id)",
    )

    # Log the KEY only — never the value or the ciphertext.
    log_event(
        "credential.stored",
        session_id=session_id,
        key=body.key,
        is_update=is_update,
        total_keys=len(creds),
    )

    return {"stored": True, "key": body.key}


@router.get("/sessions/{session_id}/credentials/keys")
def list_credential_keys(session_id: str):
    """Return the names of stored credentials without their values."""
    session = _get_session_or_404(session_id)
    creds   = _load_credentials(session)
    return {"keys": list(creds.keys())}


@router.delete("/sessions/{session_id}", status_code=200)
def delete_session(session_id: str):
    """Hard-delete the session and all stored credentials."""
    _get_session_or_404(session_id)

    try:
        _table.delete_item(
            Key={"session_id": session_id},
            ConditionExpression="attribute_exists(session_id)",
        )
    except ClientError as exc:
        if exc.response["Error"]["Code"] == "ConditionalCheckFailedException":
            raise HTTPException(status_code=404, detail="Session not found") from exc
        raise

    log_event("session.deleted", session_id=session_id)
    return {"deleted": True, "session_id": session_id}
