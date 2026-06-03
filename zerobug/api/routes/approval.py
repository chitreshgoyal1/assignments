"""
Approval routes.

POST /api/webhooks/approve  — programmatic approval (Slack bot, CI, etc.)

The chat-UI approval path lives in routes/chat.py
(POST /api/sessions/{session_id}/approve).

SNS email subscription is configured in infra/zerobug_stack.py.
The runtime publishes the notification payload; this module only handles
the inbound webhook for external approvers.
"""
import hashlib
import hmac
import json
import os

import boto3
from botocore.exceptions import ClientError
from fastapi import APIRouter, HTTPException
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
WEBHOOK_SECRET      = os.getenv("WEBHOOK_SECRET", "")


# ── helpers ───────────────────────────────────────────────────────────────────

def _verify_token(token: str) -> bool:
    if not WEBHOOK_SECRET:
        raise HTTPException(status_code=503, detail="WEBHOOK_SECRET is not configured")
    # Constant-time comparison to prevent timing attacks
    return hmac.compare_digest(
        hashlib.sha256(token.encode()).hexdigest(),
        hashlib.sha256(WEBHOOK_SECRET.encode()).hexdigest(),
    )


def _get_session_or_404(session_id: str) -> dict:
    resp = _table.get_item(Key={"session_id": session_id})
    item = resp.get("Item")
    if not item:
        raise HTTPException(status_code=404, detail="Session not found")
    return item


def _invoke_runtime(session_id: str, user_message: str) -> dict:
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
            return json.loads(payload["body"])
        return payload
    else:
        import sys, os as _os
        sys.path.insert(0, _os.path.join(_os.path.dirname(__file__), "..", "..", "runtime"))
        import importlib
        mod = importlib.import_module("handler")
        importlib.reload(mod)
        result = mod.lambda_handler({"session_id": session_id, "user_message": user_message}, None)
        return json.loads(result["body"])


# ── models ────────────────────────────────────────────────────────────────────

class WebhookApproveBody(BaseModel):
    session_id: str
    approved:   bool
    token:      str
    note:       str = ""


# ── routes ────────────────────────────────────────────────────────────────────

@router.post("/webhooks/approve")
def webhook_approve(body: WebhookApproveBody):
    """
    Programmatic approval endpoint — for Slack bots, CI pipelines, etc.

    The caller must supply the WEBHOOK_SECRET value in the `token` field.
    The secret is compared using a constant-time HMAC to prevent timing attacks.
    """
    log_event(
        "approval.decision",
        session_id=body.session_id,
        approved=body.approved,
        note=body.note,
        channel="webhook",
    )

    if not _verify_token(body.token):
        log_event("approval.rejected_token", session_id=body.session_id)
        raise HTTPException(status_code=403, detail="Invalid webhook token")

    session = _get_session_or_404(body.session_id)
    if session.get("status") != "awaiting_approval":
        raise HTTPException(
            status_code=409,
            detail=f"Session status is '{session.get('status')}' — nothing awaiting approval",
        )

    # Build synthetic message (same logic as chat.py /approve)
    if not body.approved:
        note = body.note or "No reason given."
        synthetic_message = (
            f"User rejected the approval request via webhook. Reason: {note}. "
            "Do not proceed with merge or any deployment. "
            "Summarise what was done and what was not done."
        )
    else:
        note_part = f" Note: {body.note}." if body.note else ""
        # Merge and deploy are separate decisions. Approving via webhook only
        # authorises the merge; the agent must explicitly ask the user about
        # deployment afterwards (see system_prompt steps 10–12).
        synthetic_message = (
            f"User approved all items via webhook.{note_part} "
            "Proceed with merging the PRs and closing linked tickets. "
            "After the merge completes, ask the user whether they want to "
            "deploy to production and, if so, what deployment target to use. "
            "Do not call this 'deployed' — only merged."
        )

    try:
        result = _invoke_runtime(body.session_id, synthetic_message)
    except ClientError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return {
        "session_id": body.session_id,
        "approved":   body.approved,
        "message":    result.get("message") or result.get("reply", ""),
        "status":     result.get("status", "active"),
    }
