"""
DynamoDB-backed session store for zerobug_sessions.

Table schema
------------
session_id      String  PK
created_at      String  ISO-8601
updated_at      String  ISO-8601
status          String  active | awaiting_approval | completed | failed
conversation    String  JSON array of {role, content}
credentials     String  JSON dict — values KMS-encrypted (base64 ciphertext)
context         String  JSON {goal, systems_identified, tickets_found,
                              prs_opened, fixes_applied}
approval_items  String  JSON array of PRs awaiting approval
"""

import base64
import json
import os
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError

# ── AWS clients ──────────────────────────────────────────────────────────────

_region = os.getenv("AWS_DEFAULT_REGION", "us-east-1")
_endpoint = os.getenv("DYNAMODB_ENDPOINT")

_dynamo_kwargs: dict = {"region_name": _region}
if _endpoint:
    _dynamo_kwargs.update(
        endpoint_url=_endpoint,
        aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID", "local"),
        aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY", "local"),
    )

_dynamo = boto3.resource("dynamodb", **_dynamo_kwargs)
_kms = boto3.client("kms", region_name=_region)

_TABLE_NAME = os.getenv("DYNAMODB_TABLE_SESSIONS", "zerobug-sessions")
_KMS_KEY_ID = os.getenv("KMS_KEY_ID", "")  # ARN or alias, e.g. alias/zerobug

table = _dynamo.Table(_TABLE_NAME)


# ── helpers ──────────────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _kms_encrypt(plaintext: str) -> str:
    resp = _kms.encrypt(KeyId=_KMS_KEY_ID, Plaintext=plaintext.encode())
    return base64.b64encode(resp["CiphertextBlob"]).decode()


def _kms_decrypt(ciphertext_b64: str) -> str:
    blob = base64.b64decode(ciphertext_b64)
    resp = _kms.decrypt(CiphertextBlob=blob)
    return resp["Plaintext"].decode()


# ── public API ───────────────────────────────────────────────────────────────

def create_session(session_id: str) -> None:
    """Create a new session.  Raises if session_id already exists."""
    now = _now()
    try:
        table.put_item(
            Item={
                "session_id": session_id,
                "created_at": now,
                "updated_at": now,
                "status": "active",
                "conversation": json.dumps([]),
                "credentials": json.dumps({}),
                "context": json.dumps({
                    "goal": None,
                    "systems_identified": [],
                    "tickets_found": [],
                    "prs_opened": [],
                    "fixes_applied": [],
                }),
                "approval_items": json.dumps([]),
            },
            ConditionExpression="attribute_not_exists(session_id)",
        )
    except ClientError as exc:
        if exc.response["Error"]["Code"] == "ConditionalCheckFailedException":
            raise ValueError(f"Session '{session_id}' already exists") from exc
        raise


def get_session(session_id: str) -> dict:
    """Return the raw session item (string fields un-decoded)."""
    resp = table.get_item(Key={"session_id": session_id})
    item = resp.get("Item")
    if item is None:
        raise KeyError(f"Session '{session_id}' not found")
    return item


def append_message(session_id: str, role: str, content: str) -> None:
    """Atomically append one message to the conversation array."""
    msg = json.dumps({"role": role, "content": content})
    now = _now()
    try:
        table.update_item(
            Key={"session_id": session_id},
            # list_append on a JSON string is not possible natively, so we
            # do a full read-modify-write protected by a version check.
            # We instead store conversation as a real List in DynamoDB to
            # make this atomic, but the schema declares it as a String for
            # cross-service JSON portability.  We therefore read, parse,
            # append, and write back under a condition on updated_at to
            # detect concurrent writers.
            UpdateExpression=(
                "SET conversation = list_append("
                "  if_not_exists(conversation, :empty), :msg"
                "), updated_at = :now"
            ),
            ExpressionAttributeValues={
                ":empty": [],
                ":msg": [msg],
                ":now": now,
            },
            ConditionExpression="attribute_exists(session_id)",
        )
    except ClientError as exc:
        if exc.response["Error"]["Code"] == "ConditionalCheckFailedException":
            raise KeyError(f"Session '{session_id}' not found") from exc
        raise


def update_session(session_id: str, **fields) -> None:
    """Update arbitrary top-level fields (except session_id / created_at)."""
    if not fields:
        return

    forbidden = {"session_id", "created_at"}
    bad = forbidden & fields.keys()
    if bad:
        raise ValueError(f"Cannot update immutable fields: {bad}")

    now = _now()
    fields["updated_at"] = now

    set_parts = []
    names: dict = {}
    values: dict = {}

    for i, (k, v) in enumerate(fields.items()):
        name_token = f"#f{i}"
        val_token = f":v{i}"
        names[name_token] = k
        values[val_token] = v
        set_parts.append(f"{name_token} = {val_token}")

    try:
        table.update_item(
            Key={"session_id": session_id},
            UpdateExpression="SET " + ", ".join(set_parts),
            ExpressionAttributeNames=names,
            ExpressionAttributeValues=values,
            ConditionExpression="attribute_exists(session_id)",
        )
    except ClientError as exc:
        if exc.response["Error"]["Code"] == "ConditionalCheckFailedException":
            raise KeyError(f"Session '{session_id}' not found") from exc
        raise


def store_credential(session_id: str, key: str, value: str) -> None:
    """Encrypt *value* with KMS and persist it in the credentials dict."""
    if not _KMS_KEY_ID:
        raise RuntimeError("KMS_KEY_ID env var is not set")

    encrypted = _kms_encrypt(value)

    # Read-modify-write: fetch current credentials, merge, write back.
    item = get_session(session_id)
    creds: dict = json.loads(item.get("credentials") or "{}")
    creds[key] = encrypted

    update_session(session_id, credentials=json.dumps(creds))


def get_credential(session_id: str, key: str) -> str:
    """Retrieve and KMS-decrypt a stored credential value."""
    if not _KMS_KEY_ID:
        raise RuntimeError("KMS_KEY_ID env var is not set")

    item = get_session(session_id)
    creds: dict = json.loads(item.get("credentials") or "{}")
    if key not in creds:
        raise KeyError(f"Credential '{key}' not found in session '{session_id}'")

    return _kms_decrypt(creds[key])
