"""
Chat and session endpoints.

POST   /api/sessions                              — create session
POST   /api/sessions/{session_id}/message         — send message, get Claude response
GET    /api/sessions/{session_id}                 — session status (no history)
GET    /api/sessions/{session_id}/messages        — full conversation history
POST   /api/sessions/{session_id}/approve         — approve pending items
"""
import json
import os
import time
import uuid
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

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

_lambda = boto3.client("lambda", region_name=_region)
_table  = _dynamo.Table(os.getenv("DYNAMODB_TABLE_SESSIONS", "zerobug-sessions"))

RUNTIME_LAMBDA_NAME = os.getenv("RUNTIME_LAMBDA_ARN") or os.getenv("RUNTIME_LAMBDA_NAME", "")


# ── helpers ───────────────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _get_session_or_404(session_id: str) -> dict:
    resp = _table.get_item(Key={"session_id": session_id})
    item = resp.get("Item")
    if not item:
        raise HTTPException(status_code=404, detail="Session not found")
    return item


def _invoke_runtime(session_id: str, user_message: str) -> dict:
    """Call RuntimeLambda synchronously. Falls back to direct import for local dev."""
    mode = "lambda" if RUNTIME_LAMBDA_NAME else "local-import"
    log_event(
        "runtime.invoking",
        session_id=session_id,
        mode=mode,
        message=user_message,
    )
    start = time.perf_counter()
    try:
        if RUNTIME_LAMBDA_NAME:
            resp = _lambda.invoke(
                FunctionName=RUNTIME_LAMBDA_NAME,
                InvocationType="RequestResponse",
                Payload=json.dumps({
                    "session_id":   session_id,
                    "user_message": user_message,
                }),
            )
            payload = json.loads(resp["Payload"].read())
            if "body" in payload and isinstance(payload["body"], str):
                result = json.loads(payload["body"])
            else:
                result = payload
        else:
            import sys, os as _os
            sys.path.insert(0, _os.path.join(_os.path.dirname(__file__), "..", "..", "runtime"))
            import importlib
            # Reload system_prompt first so prompt edits flow through without
            # needing a uvicorn restart. handler.py is reloaded right after.
            try:
                import system_prompt as _sp
                importlib.reload(_sp)
            except ImportError:
                pass
            mod = importlib.import_module("handler")
            importlib.reload(mod)
            invoke_result = mod.lambda_handler(
                {"session_id": session_id, "user_message": user_message}, None
            )
            result = json.loads(invoke_result["body"])
    except Exception:
        elapsed_ms = round((time.perf_counter() - start) * 1000, 1)
        log.exception(
            "runtime.failed session=%s mode=%s elapsed_ms=%s",
            session_id, mode, elapsed_ms,
        )
        log_event(
            "runtime.failed",
            session_id=session_id,
            mode=mode,
            elapsed_ms=elapsed_ms,
        )
        raise

    elapsed_ms = round((time.perf_counter() - start) * 1000, 1)
    log_event(
        "runtime.returned",
        session_id=session_id,
        mode=mode,
        elapsed_ms=elapsed_ms,
        status=result.get("status"),
        reply=result.get("message") or result.get("reply", ""),
        approval_items=result.get("approval_items", []),
        type=result.get("type"),
    )
    return result


def _parse_conversation(session: dict) -> list:
    raw = session.get("conversation", "[]")
    try:
        conv = json.loads(raw) if isinstance(raw, str) else raw
    except (json.JSONDecodeError, TypeError):
        return []

    messages = []
    for entry in conv:
        role = entry.get("role", "assistant")
        # Converse API format: content is a list of {"text": "..."}
        content_raw = entry.get("content", "")
        if isinstance(content_raw, list):
            text = " ".join(
                c.get("text", "") for c in content_raw if isinstance(c, dict)
            )
        else:
            text = str(content_raw)
        messages.append({"role": role, "content": text})
    return messages


# ── models ────────────────────────────────────────────────────────────────────

class MessageBody(BaseModel):
    message: str


class ApproveBody(BaseModel):
    approved: bool
    note: str = ""


# ── routes ────────────────────────────────────────────────────────────────────

@router.post("/sessions", status_code=201)
def create_session():
    """Create a new session and return its ID."""
    session_id = str(uuid.uuid4())
    now = _now()
    _table.put_item(Item={
        "session_id":     session_id,
        "created_at":     now,
        "updated_at":     now,
        "status":         "active",
        "conversation":   json.dumps([]),
        "credentials":    json.dumps({}),
        "context":        json.dumps({
            "goal": None,
            "systems_identified": [],
            "tickets_found": [],
            "prs_opened": [],
            "fixes_applied": [],
        }),
        "approval_items": json.dumps([]),
    })
    log_event("session.created", session_id=session_id)
    return {"session_id": session_id, "status": "active"}


def _sse_frame(event: str, data: dict) -> str:
    """Format one SSE event. Always wraps data as JSON for the frontend parser."""
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


def _iter_runtime_stream(session_id: str, user_message: str):
    """Generator that wires the runtime stream_handler into SSE-formatted bytes.

    Local-import mode only — the deployed Lambda still uses the synchronous
    ``/message`` endpoint. Streaming over Lambda would need Function URLs +
    response streaming which is a bigger architectural lift; the live
    "Cursor-style" UX is most needed during local dev / demos.
    """
    import sys, os as _os
    sys.path.insert(0, _os.path.join(_os.path.dirname(__file__), "..", "..", "runtime"))
    import importlib
    try:
        import system_prompt as _sp
        importlib.reload(_sp)
    except ImportError:
        pass
    mod = importlib.import_module("handler")
    importlib.reload(mod)

    start = time.perf_counter()
    log_event("runtime.streaming", session_id=session_id, message=user_message)

    final_payload = None
    try:
        for kind, payload in mod.stream_handler({
            "session_id": session_id,
            "user_message": user_message,
        }):
            yield _sse_frame(kind, payload).encode("utf-8")
            if kind == "done":
                final_payload = payload
            elif kind == "error":
                final_payload = payload
                break
    except Exception as exc:
        log.exception("runtime.stream_failed session=%s", session_id)
        err_body = {
            "message": f"I ran into an issue ({type(exc).__name__}). Let me try a different approach.",
            "reply":   f"I ran into an issue ({type(exc).__name__}). Let me try a different approach.",
            "status":  "active",
            "approval_items":    [],
            "agent_code_blocks": [],
            "type":    "message",
            "session_id": session_id,
        }
        yield _sse_frame("error", err_body).encode("utf-8")
        final_payload = err_body

    elapsed_ms = round((time.perf_counter() - start) * 1000, 1)
    log_event(
        "runtime.stream_returned",
        session_id=session_id,
        elapsed_ms=elapsed_ms,
        status=(final_payload or {}).get("status"),
        reply=(final_payload or {}).get("reply") or (final_payload or {}).get("message", ""),
        agent_code_block_count=len((final_payload or {}).get("agent_code_blocks", [])),
    )


@router.post("/sessions/{session_id}/message/stream")
def stream_message(session_id: str, body: MessageBody):
    """SSE endpoint — streams Claude's reasoning, activity, and final reply live.

    Frame format::

        event: <kind>
        data: <json>
        \\n

    where ``kind`` ∈ {reasoning_delta, text_delta, activity_start,
    activity_done, agent_code, done, error}. Frontend parses with a manual
    ReadableStream reader (EventSource doesn't support POST).
    """
    log_event("message.received", session_id=session_id, text=body.message, transport="sse")
    _get_session_or_404(session_id)

    if RUNTIME_LAMBDA_NAME:
        # Lambda invocation can't stream chunks back over RequestResponse.
        # Tell the frontend to fall back to the synchronous endpoint.
        raise HTTPException(
            status_code=501,
            detail="Streaming is only supported in local-import mode; use POST /message instead.",
        )

    return StreamingResponse(
        _iter_runtime_stream(session_id, body.message),
        media_type="text/event-stream",
        headers={
            # Disable proxy buffering so events flush immediately
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.post("/sessions/{session_id}/message")
def send_message(session_id: str, body: MessageBody):
    """Send a user message and get Claude's response synchronously."""
    log_event("message.received", session_id=session_id, text=body.message)

    _get_session_or_404(session_id)

    try:
        result = _invoke_runtime(session_id, body.message)
    except ClientError as exc:
        log_event("message.failed", session_id=session_id, error=str(exc), kind="ClientError")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except Exception as exc:
        log_event("message.failed", session_id=session_id, error=str(exc), kind=type(exc).__name__)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    response = {
        "message":           result.get("message") or result.get("reply", ""),
        "status":            result.get("status", "active"),
        "approval_items":    result.get("approval_items", []),
        "agent_code_blocks": result.get("agent_code_blocks", []),
        "type":              result.get("type", "message"),
        "session_id":        session_id,
    }
    log_event(
        "message.replied",
        session_id=session_id,
        reply=response["message"],
        status=response["status"],
        type=response["type"],
        approval_items=response["approval_items"],
        agent_code_block_count=len(response["agent_code_blocks"]),
    )
    return response


@router.get("/sessions/{session_id}")
def get_session(session_id: str):
    """Return session status — no conversation history."""
    session = _get_session_or_404(session_id)
    approval_items_raw = session.get("approval_items", "[]")
    try:
        approval_items = json.loads(approval_items_raw) if isinstance(approval_items_raw, str) else approval_items_raw
    except (json.JSONDecodeError, TypeError):
        approval_items = []

    return {
        "session_id":     session_id,
        "status":         session.get("status", "active"),
        "approval_items": approval_items,
        "created_at":     session.get("created_at", ""),
        "updated_at":     session.get("updated_at", ""),
    }


@router.get("/sessions/{session_id}/messages")
def get_messages(session_id: str):
    """Return full conversation history for rendering the chat UI."""
    session = _get_session_or_404(session_id)
    return {"session_id": session_id, "messages": _parse_conversation(session)}


@router.get("/sessions/{session_id}/activity")
def get_activity(session_id: str):
    """Return structured activity events for the sidebar timeline."""
    session = _get_session_or_404(session_id)
    raw = session.get("activity", "[]")
    try:
        events = json.loads(raw) if isinstance(raw, str) else (raw or [])
    except (json.JSONDecodeError, TypeError):
        events = []
    return {"session_id": session_id, "events": events}


@router.post("/sessions/{session_id}/approve")
def approve_session(session_id: str, body: ApproveBody):
    """Approve or reject pending items and continue the Claude loop."""
    log_event(
        "approval.decision",
        session_id=session_id,
        approved=body.approved,
        note=body.note,
        channel="ui",
    )

    session = _get_session_or_404(session_id)

    if session.get("status") != "awaiting_approval":
        raise HTTPException(
            status_code=409,
            detail=f"Session status is '{session.get('status')}' — nothing awaiting approval",
        )

    if not body.approved:
        note = body.note or "No reason given."
        synthetic_message = (
            f"User rejected the approval request. Reason: {note}. "
            "Do not proceed with merge or any deployment. "
            "Summarise what was done and what was not done."
        )
    else:
        note_part = f" Note from reviewer: {body.note}." if body.note else ""
        # Merge and deploy are separate decisions. Approving the review card
        # only authorises the merge; the agent must explicitly ask the user
        # about deployment afterwards (see system_prompt steps 10–12).
        synthetic_message = (
            f"User approved all items.{note_part} "
            "Proceed with merging the PRs and closing linked tickets. "
            "After the merge completes, ask the user whether they want to "
            "deploy to production and, if so, what deployment target to use "
            "(ArgoCD, ECS, Vercel, Helm, Jenkins, custom CI, etc.). "
            "Do not call this 'deployed' — only merged."
        )

    try:
        result = _invoke_runtime(session_id, synthetic_message)
    except Exception as exc:
        log_event(
            "approval.failed",
            session_id=session_id,
            approved=body.approved,
            error=str(exc),
            kind=type(exc).__name__,
        )
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return {
        "message":           result.get("message") or result.get("reply", ""),
        "status":            result.get("status", "active"),
        "agent_code_blocks": result.get("agent_code_blocks", []),
        # If the merge turn ended with another <approval_needed> (e.g. the bot
        # wants explicit confirmation of a destructive deploy target before
        # running it), the frontend needs the new items so it can render a
        # fresh review card in the new bot bubble.
        "approval_items":    result.get("approval_items", []),
        "session_id":        session_id,
        "approved":          body.approved,
    }
