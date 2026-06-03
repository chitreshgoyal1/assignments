"""
ZeroBug Runtime Lambda — the conversation loop.
Receives a user message, calls Claude via Bedrock Converse API,
executes any <execute> blocks in the sandbox, handles approvals,
and returns the final cleaned message to the caller.
"""
import base64
import json
import os
import re
import sys
import uuid
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError

# Allow local imports when running directly (not in Lambda)
sys.path.insert(0, os.path.dirname(__file__))
from system_prompt import ZEROBUG_SYSTEM_PROMPT  # noqa: E402

# ── AWS clients ───────────────────────────────────────────────────────────────

_region = os.environ.get("AWS_DEFAULT_REGION", "us-east-1")
_bedrock_region = os.environ.get("BEDROCK_REGION", _region)

_dynamo_kwargs: dict = {"region_name": _region}
_dynamo_endpoint = os.environ.get("DYNAMODB_ENDPOINT")
if _dynamo_endpoint:
    _dynamo_kwargs.update({
        "endpoint_url": _dynamo_endpoint,
        "aws_access_key_id": os.environ.get("AWS_ACCESS_KEY_ID", "local"),
        "aws_secret_access_key": os.environ.get("AWS_SECRET_ACCESS_KEY", "local"),
    })

_dynamo        = boto3.resource("dynamodb", **_dynamo_kwargs)
_lambda_client = boto3.client("lambda", region_name=_region)
_bedrock       = boto3.client("bedrock-runtime", region_name=_bedrock_region)
_kms           = boto3.client("kms", region_name=_region)
_sns           = boto3.client("sns", region_name=_region)

_sessions_table = _dynamo.Table(
    os.environ.get("DYNAMODB_TABLE_SESSIONS", os.environ.get("SESSIONS_TABLE", "zerobug-sessions"))
)

BEDROCK_MODEL_ID     = os.environ.get("BEDROCK_MODEL_ID", "us.anthropic.claude-sonnet-4-5-20250929-v1:0")
SANDBOX_LAMBDA_NAME  = os.environ.get("SANDBOX_LAMBDA_NAME") or os.environ.get("SANDBOX_LAMBDA_ARN", "")
APPROVALS_TOPIC_ARN  = os.environ.get("APPROVALS_TOPIC_ARN", "")

# Extended thinking: Claude Sonnet 4.5 (and other recent models) can emit a
# chain-of-thought reasoning block before the visible reply. We surface it as
# the "Thinking" chip in the chat. Disable via env if a model in use doesn't
# support it.
BEDROCK_THINKING_ENABLED = os.environ.get("BEDROCK_THINKING_ENABLED", "1").lower() not in ("0", "false", "no")
BEDROCK_THINKING_BUDGET  = int(os.environ.get("BEDROCK_THINKING_BUDGET", "2000"))

# Max sandbox iterations per turn — prevents infinite execute loops
MAX_EXECUTE_ROUNDS = 10
# Max retries on sandbox execution errors before giving up
MAX_SANDBOX_RETRIES = 3


# ── Activity logging ──────────────────────────────────────────────────────────

def _log_activity(session_id: str, event_id: str, label: str, icon: str, status: str, detail: str = None) -> None:
    """Upsert a structured activity event into the session. Best-effort — never raises."""
    try:
        resp = _sessions_table.get_item(Key={"session_id": session_id})
        item = resp.get("Item", {})
        raw = item.get("activity", "[]")
        events = json.loads(raw) if isinstance(raw, str) else (raw or [])

        found = False
        for ev in events:
            if ev.get("id") == event_id:
                ev.update({"label": label, "icon": icon, "status": status, "updated_at": _now()})
                if detail is not None:
                    ev["detail"] = detail
                found = True
                break
        if not found:
            ev = {"id": event_id, "ts": _now(), "label": label, "icon": icon, "status": status}
            if detail is not None:
                ev["detail"] = detail
            events.append(ev)

        _sessions_table.update_item(
            Key={"session_id": session_id},
            UpdateExpression="SET activity = :a",
            ExpressionAttributeValues={":a": json.dumps(events)},
        )
    except Exception:
        pass  # activity logging is best-effort


def _start_activity(session_id: str, label: str, icon: str, detail: str = None) -> str:
    event_id = str(uuid.uuid4())
    _log_activity(session_id, event_id, label, icon, "in_progress", detail)
    return event_id


def _finish_activity(session_id: str, event_id: str, label: str, icon: str, status: str, detail: str = None) -> None:
    _log_activity(session_id, event_id, label, icon, status, detail)


def _icon_from_code(code: str) -> tuple[str, str]:
    """Return (label, icon) based on what the sandbox code does.

    Heuristic-only — the LLM may use any library. When we can't tell, we fall
    back to the generic "Running code" label, which keeps the system tool-
    agnostic by design.

    Order matters: we check the most specific actions (merge, PR creation)
    before generic vendor connectors (just `from github import …`) or the
    catch-all `"deploy"` substring. Otherwise `pr.merge()` could match the
    `github` connector branch and we'd lose the merge-vs-open distinction
    the timeline relies on.
    """
    lower = code.lower()
    # Merge actions first — covers PyGithub `pull.merge(`, python-gitlab
    # `mr.merge(`, REST clients calling `/merge`, and the generic verbs
    # `merge_pull_request` / `merge_pr`. Distinct from `pr.create(` because
    # merging and opening are different decisions in our flow (steps 7 vs 10
    # in the system prompt) and the user needs separate visibility.
    if (
        ".merge(" in lower
        or "merge_pull_request" in lower
        or "merge_pr(" in lower
        or "/merge" in lower
    ):
        return "Merging PR", "merge"
    if "create_pull" in lower or "create_pr" in lower or "mergerequests.create" in lower:
        return "Opening pull request", "pr"
    if "from github import" in lower or "github(" in lower:
        return "Connecting to GitHub", "github"
    if "from jira import" in lower or "jira(" in lower:
        return "Connecting to Jira", "jira"
    if "import gitlab" in lower or "gitlab.gitlab(" in lower:
        return "Connecting to GitLab", "gitlab"
    if "deploy" in lower:
        return "Deploying", "deploy"
    return "Running code", "code"


def _summarise_sandbox_result(sandbox_result: dict) -> str:
    """Single-line, user-friendly summary of what a sandbox run produced.

    Tool-agnostic: looks for common shapes (error envelope, RESULT dict with
    status/count, list, primitive). Falls back to "Done." when nothing
    interesting is found. Never raises.
    """
    try:
        if not isinstance(sandbox_result, dict):
            return "Done."

        # Sandbox error envelope set by executor.py
        err = sandbox_result.get("error")
        if err:
            detail = sandbox_result.get("detail") or sandbox_result.get("message", "")
            detail = str(detail).strip().split("\n", 1)[0][:140]
            return f"Error: {err}{(' — ' + detail) if detail else ''}"

        # Convention: sandbox returns RESULT, executor surfaces it under "result"
        result = sandbox_result.get("result", sandbox_result)

        if isinstance(result, dict):
            status = result.get("status")
            # Count-like keys give a nice "Found N items" line
            for key in ("count", "total", "open_prs", "tickets", "issues", "results", "items"):
                val = result.get(key)
                if isinstance(val, list):
                    return f"Found {len(val)} {key.replace('_', ' ')}."
                if isinstance(val, int):
                    return f"{key.replace('_', ' ').capitalize()}: {val}."
            if status:
                if status == "ok":
                    # Pick first non-status string-ish field as detail
                    for k, v in result.items():
                        if k == "status":
                            continue
                        if isinstance(v, str) and v:
                            return f"OK — {k}: {v[:140]}"
                    return "OK."
                return f"Status: {status}."
            keys = ", ".join(list(result.keys())[:3])
            return f"Returned: {keys}." if keys else "Done."

        if isinstance(result, list):
            return f"Returned {len(result)} items."

        if result is None:
            return "Done."

        return f"Returned: {str(result)[:140]}"
    except Exception:
        return "Done."

# ── DynamoDB session helpers ──────────────────────────────────────────────────

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load_session(session_id: str) -> dict:
    resp = _sessions_table.get_item(Key={"session_id": session_id})
    item = resp.get("Item")
    if item:
        return item
    # New session
    now = _now()
    item = {
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
    }
    try:
        _sessions_table.put_item(
            Item=item,
            ConditionExpression="attribute_not_exists(session_id)",
        )
    except ClientError as exc:
        if exc.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise
        # Race — another invocation created it; reload
        return _load_session(session_id)
    return item


def _save_session(session_id: str, **fields) -> None:
    fields["updated_at"] = _now()
    set_parts, names, values = [], {}, {}
    for i, (k, v) in enumerate(fields.items()):
        nt, vt = f"#f{i}", f":v{i}"
        names[nt] = k
        values[vt] = v
        set_parts.append(f"{nt} = {vt}")
    _sessions_table.update_item(
        Key={"session_id": session_id},
        UpdateExpression="SET " + ", ".join(set_parts),
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
    )


def _kms_decrypt(ciphertext_b64: str) -> str:
    """Decrypt a KMS-encrypted credential value stored in the session.

    The API encrypts every credential with our customer-managed CMK before
    persisting it to DynamoDB (see ``api/routes/credentials.py``). We
    decrypt just-in-time here, immediately before the sandbox executes the
    LLM-generated code that needs the credential, so the plaintext only
    lives in memory for the duration of one ``<execute>`` block. The KMS
    Decrypt API call itself does not require the key ID — it's encoded in
    the ciphertext blob.
    """
    blob = base64.b64decode(ciphertext_b64)
    resp = _kms.decrypt(CiphertextBlob=blob)
    return resp["Plaintext"].decode()


def _get_credentials(session: dict) -> dict:
    """Return ``{key: plaintext_value}`` for this session's credentials.

    Values come out of DynamoDB as base64-encoded KMS ciphertext. We
    decrypt each one here and return plaintext so the sandbox can inject
    them as env vars. If decryption fails for a specific credential we log
    the key name (never the ciphertext) and skip it — better to let the
    LLM see an ``auth_error`` from the sandbox and ask the user to re-enter
    the credential than to crash the whole turn.
    """
    raw = session.get("credentials", "{}")
    try:
        ciphertexts = json.loads(raw) if isinstance(raw, str) else raw
    except (json.JSONDecodeError, TypeError):
        return {}
    if not isinstance(ciphertexts, dict):
        return {}

    plaintexts: dict = {}
    for key, ciphertext in ciphertexts.items():
        if not isinstance(ciphertext, str) or not ciphertext:
            continue
        try:
            plaintexts[key] = _kms_decrypt(ciphertext)
        except ClientError as exc:
            # Log key name only — never the ciphertext, never the error
            # detail (KMS errors can echo back identifiers). The sandbox
            # will get an auth_error when it tries to use the missing
            # credential, which Claude is already trained to surface to
            # the user with a "please re-enter your X" message.
            print(
                f"[runtime] kms_decrypt_failed key={key} "
                f"code={exc.response.get('Error', {}).get('Code', '?')}"
            )
            continue
        except Exception:
            print(f"[runtime] kms_decrypt_failed key={key} code=unknown")
            continue
    return plaintexts


def _get_uploaded_files(session: dict) -> list:
    """Return the list of files the user uploaded on this session.

    Stored on the session by the file-upload route as a JSON-encoded list of
    ``{id, name, size, content_type, path, uploaded_at}``. Empty list if
    nothing was uploaded.
    """
    raw = session.get("files", "[]")
    try:
        files = json.loads(raw) if isinstance(raw, str) else raw
    except (json.JSONDecodeError, TypeError):
        return []
    return files or []


def _credentials_with_uploads(credentials: dict, uploaded_files: list) -> dict:
    """Augment the per-session credentials dict with a ZEROBUG_FILES env var
    that the sandbox can use to discover uploaded files.

    Keeping this as a "credential" lets us reuse the existing env-var
    injection pipeline in the sandbox — Claude reads it with ``os.environ``
    like any other secret. The value is a JSON array of
    ``{name, path, content_type}`` so Claude can pick the right Python
    library per file (open() for text, pypdf for PDFs, PIL for images,
    pandas/csv for tables, etc.). Tool-agnostic by construction.
    """
    if not uploaded_files:
        return credentials
    payload = [
        {
            "name":         f.get("name", ""),
            "path":         f.get("path", ""),
            "content_type": f.get("content_type", ""),
            "size":         f.get("size", 0),
        }
        for f in uploaded_files if f.get("path")
    ]
    if not payload:
        return credentials
    augmented = dict(credentials)
    augmented["ZEROBUG_FILES"] = json.dumps(payload)
    return augmented


# ── Bedrock Converse API ──────────────────────────────────────────────────────

def _extract_visible_text(content_blocks) -> str:
    """Return only user-visible text from a Bedrock content array.

    With extended thinking enabled, ``content`` is a list of blocks like
    ``[{"reasoningContent": {...}}, {"text": "..."}]``. We discard reasoning
    blocks here — the visible text is what gets parsed for tags, persisted to
    history, and shown in the bubble. Reasoning is exposed separately via
    streaming events to the "Thinking" chip in the UI.
    """
    if not content_blocks:
        return ""
    parts = []
    for block in content_blocks:
        if isinstance(block, dict) and "text" in block:
            parts.append(block.get("text", ""))
    return "".join(parts).strip()


def _bedrock_request_kwargs(conversation: list) -> dict:
    """Common request payload for both converse and converse_stream.

    Thinking adds a ``additionalModelRequestFields`` block. Per Anthropic's
    contract, ``temperature`` must be 1 when thinking is enabled, and
    ``maxTokens`` must exceed the thinking budget.
    """
    kwargs: dict = {
        "modelId": BEDROCK_MODEL_ID,
        "system": [{"text": ZEROBUG_SYSTEM_PROMPT}],
        "messages": conversation,
        "inferenceConfig": {"maxTokens": 4096},
    }
    if BEDROCK_THINKING_ENABLED:
        kwargs["inferenceConfig"]["temperature"] = 1.0
        kwargs["additionalModelRequestFields"] = {
            "thinking": {
                "type": "enabled",
                "budget_tokens": BEDROCK_THINKING_BUDGET,
            }
        }
    return kwargs


def _call_bedrock(conversation: list) -> str:
    resp = _bedrock.converse(**_bedrock_request_kwargs(conversation))
    return _extract_visible_text(resp["output"]["message"]["content"])


def _stream_bedrock(conversation: list):
    """Generator over Bedrock converse_stream events.

    Yields ``(kind, chunk)`` tuples where ``kind`` is ``"reasoning"`` (chain-
    of-thought text), ``"text"`` (visible reply text), or ``"done"`` whose
    chunk is the full accumulated visible text. We deliberately drop the
    reasoning ``signature`` field — we don't replay reasoning back to the
    model on subsequent turns, so we don't need to round-trip the signature.
    """
    resp = _bedrock.converse_stream(**_bedrock_request_kwargs(conversation))
    visible_parts: list[str] = []

    for event in resp["stream"]:
        if "contentBlockDelta" in event:
            delta = event["contentBlockDelta"].get("delta", {})
            if "reasoningContent" in delta:
                rc = delta["reasoningContent"] or {}
                # Bedrock can deliver reasoning either as flat text or nested
                # under reasoningText — handle both shapes.
                txt = rc.get("text") or rc.get("reasoningText", {}).get("text") or ""
                if txt:
                    yield "reasoning", txt
            elif "text" in delta:
                txt = delta["text"] or ""
                if txt:
                    visible_parts.append(txt)
                    yield "text", txt
        elif "modelStreamErrorException" in event or "internalServerException" in event \
                or "validationException" in event or "throttlingException" in event:
            err = next(iter(event.values()), {})
            raise RuntimeError(f"Bedrock stream error: {err.get('message', err)}")

    yield "done", "".join(visible_parts).strip()


# ── Tag parsing ───────────────────────────────────────────────────────────────

_TAG = re.DOTALL

def _find(tag: str, text: str) -> list[str]:
    return re.findall(rf"<{tag}>(.*?)</{tag}>", text, _TAG)

def _strip_tags(text: str) -> str:
    """Remove all special system tags so users never see raw XML."""
    for tag in ("execute", "ask", "approval_needed", "done"):
        text = re.sub(rf"<{tag}>.*?</{tag}>", "", text, flags=_TAG)
    return text.strip()


def _activity_summary(assistant_text: str) -> str:
    """Compact, user-facing summary of Claude's response for activity detail.

    Combines the visible reply (with tags stripped) and a short "decided to"
    line based on which tags were present. Truncated to keep the sidebar
    readable.
    """
    if not assistant_text:
        return ""

    visible = _strip_tags(assistant_text)
    decisions = []
    if _find("execute", assistant_text):
        decisions.append(f"write {len(_find('execute', assistant_text))} code block(s)")
    if _find("ask", assistant_text):
        decisions.append("ask the user")
    if _find("approval_needed", assistant_text):
        decisions.append("request approval")
    if _find("done", assistant_text):
        decisions.append("wrap up")

    parts = []
    if visible:
        parts.append(visible[:500] + ("…" if len(visible) > 500 else ""))
    if decisions:
        parts.append("\n\nDecided to: " + ", ".join(decisions) + ".")

    summary = "".join(parts).strip()
    return summary or assistant_text[:500]


# ── Sandbox invocation ────────────────────────────────────────────────────────

def _invoke_sandbox(session_id: str, code: str, credentials: dict) -> dict:
    if not SANDBOX_LAMBDA_NAME:
        # Local dev fallback — import executor directly
        sandbox_path = os.path.join(os.path.dirname(__file__), "..", "sandbox")
        sys.path.insert(0, sandbox_path)
        import importlib
        executor = importlib.import_module("executor")
        return executor.lambda_handler({
            "session_id":      session_id,
            "code":            code,
            "credentials":     credentials,
            "timeout_seconds": 30,
        }, None)

    resp = _lambda_client.invoke(
        FunctionName=SANDBOX_LAMBDA_NAME,
        InvocationType="RequestResponse",
        Payload=json.dumps({
            "session_id":      session_id,
            "code":            code,
            "credentials":     credentials,
            "timeout_seconds": 30,
        }),
    )
    payload = json.loads(resp["Payload"].read())
    # Lambda wraps response in statusCode/body when invoked via API Gateway;
    # direct Lambda-to-Lambda invoke returns the dict directly.
    if "body" in payload and isinstance(payload["body"], str):
        return json.loads(payload["body"])
    return payload


# ── Main handler ──────────────────────────────────────────────────────────────

def _safe_error_response(session_id: str, error: Exception) -> dict:
    """Return a clean user-facing error — never a raw traceback."""
    err_type = type(error).__name__
    # Map known boto/network errors to friendly messages
    msg = {
        "EndpointResolutionError": "I couldn't reach AWS right now. Please try again in a moment.",
        "NoCredentialsError":      "AWS credentials are not configured. Please check the setup.",
        "ThrottlingException":     "The AI service is busy right now. Give me a moment and try again.",
        "ModelTimeoutException":   "The AI took too long to respond. Please try again.",
    }.get(err_type, f"I ran into an issue ({err_type}). Let me try a different approach.")

    return {
        "statusCode": 200,
        "body": json.dumps({
            "session_id":        session_id,
            "message":           msg,
            "reply":             msg,
            "status":            "active",
            "approval_items":    [],
            "agent_code_blocks": [],
            "type":              "message",
        }),
    }


def lambda_handler(event, context):
    # Accept both direct invocation and API Gateway proxy format
    if isinstance(event.get("body"), str):
        body = json.loads(event["body"])
    else:
        body = event

    session_id   = body.get("session_id") or str(uuid.uuid4())
    user_message = body.get("user_message") or body.get("message", "")

    try:
        return _lambda_handler_inner(session_id, user_message)
    except Exception as exc:
        # Append recovery message to conversation so history stays coherent
        try:
            session = _load_session(session_id)
            raw_conv = session.get("conversation", "[]")
            conversation = json.loads(raw_conv) if isinstance(raw_conv, str) else raw_conv
            conversation.append({
                "role": "assistant",
                "content": [{"text": f"I ran into an issue: {type(exc).__name__}. Let me try a different approach."}],
            })
            _save_session(session_id, conversation=json.dumps(conversation))
        except Exception:
            pass  # Don't let error-handling itself crash the response
        return _safe_error_response(session_id, exc)


def _lambda_handler_inner(session_id: str, user_message: str) -> dict:

    # 1. Load (or create) session
    session = _load_session(session_id)
    credentials = _credentials_with_uploads(
        _get_credentials(session), _get_uploaded_files(session)
    )

    # 2. Build conversation list and append new user message
    raw_conv = session.get("conversation", "[]")
    conversation: list = json.loads(raw_conv) if isinstance(raw_conv, str) else raw_conv
    conversation.append({"role": "user", "content": [{"text": user_message}]})

    # 3 & 4. Call Bedrock
    think_id = _start_activity(session_id, "Thinking…", "thinking")
    assistant_text = _call_bedrock(conversation)
    _finish_activity(session_id, think_id, "Analysed request", "thinking", "done",
                     detail=_activity_summary(assistant_text))

    # 5. Append assistant response
    conversation.append({"role": "assistant", "content": [{"text": assistant_text}]})

    status         = session.get("status", "active")
    approval_items = []  # always fresh per turn; only populated if <approval_needed> is emitted
    # Every on-fly agent (Python block) Claude wrote in this turn — surfaced
    # to the chat UI so the user can see the generated code that ran.
    agent_code_blocks: list = []
    # Visible narrative the LLM emitted on each round (with tags stripped),
    # accumulated so the bubble shows the full story, not just the last
    # round's text. Without this, multi-round flows that end on an
    # <approval_needed> / <done> block render as a wall of code chips with
    # no explanation — see "previously it was showing steps" bug.
    narrative_parts: list[str] = []
    _initial_visible = _strip_tags(assistant_text)
    if _initial_visible:
        narrative_parts.append(_initial_visible)

    # 6 & 7. Execute sandbox blocks — loop until no more <execute> tags
    sandbox_fail_count = 0
    for _round in range(MAX_EXECUTE_ROUNDS):
        execute_blocks = _find("execute", assistant_text)
        if not execute_blocks:
            break

        for code in execute_blocks:
            code = code.strip()
            label, icon = _icon_from_code(code)
            # Surface the code in the activity sidebar `detail` from the start
            # so the user can expand and see what's running, not just the label.
            exec_id = _start_activity(session_id, label, icon, detail=code)

            sandbox_result = _invoke_sandbox(session_id, code, credentials)

            error_type = sandbox_result.get("error")
            error_detail = sandbox_result.get("detail")

            # Track consecutive sandbox failures for retry cap
            if error_type:
                sandbox_fail_count += 1
            else:
                sandbox_fail_count = 0

            result_summary = _summarise_sandbox_result(sandbox_result)
            block_status = "error" if error_type else "done"

            agent_code_blocks.append({
                "id":             str(uuid.uuid4()),
                "language":       "python",
                "code":           code,
                "purpose":        label,
                "status":         block_status,
                "result_summary": result_summary,
            })

            # Finish activity with correct status — keep the code in `detail`
            # so the user can compare what ran with what came back.
            if error_type == "auth_error":
                _finish_activity(session_id, exec_id, f"{label} — auth failed", icon, "error",
                                 f"Credentials rejected: {error_detail}")
            elif error_type == "timeout" or error_type == "network_timeout":
                _finish_activity(session_id, exec_id, f"{label} — timed out", icon, "error", error_detail)
            elif error_type == "network_error":
                _finish_activity(session_id, exec_id, f"{label} — network error", icon, "error", error_detail)
            elif error_type == "library_not_available":
                _finish_activity(session_id, exec_id, f"{label} — library missing", icon, "error", error_detail)
            elif error_type:
                _finish_activity(session_id, exec_id, f"{label} — failed", icon, "error",
                                 f"{error_type}: {error_detail}")
            else:
                _finish_activity(session_id, exec_id, label, icon, "done", detail=code)

            if sandbox_fail_count >= MAX_SANDBOX_RETRIES:
                result_text = (
                    "Sandbox result:\n" + json.dumps(sandbox_result, indent=2) +
                    "\n\nSystem note: sandbox has failed 3 times in a row. "
                    "Stop retrying this approach and tell the user what went wrong "
                    "in plain language. Do not attempt another <execute> block."
                )
            elif error_type == "auth_error":
                result_text = (
                    "Sandbox result:\n" + json.dumps(sandbox_result, indent=2) +
                    "\n\nSystem note: the credentials provided did not work (authentication failed). "
                    "Stop execution immediately. Tell the user clearly: their credentials are not working "
                    "and they should check them. Specify which credential failed (e.g. GITHUB_PAT, JIRA_TOKEN). "
                    "Do not retry. Do not attempt another <execute> block."
                )
            else:
                result_text = f"Sandbox result:\n{json.dumps(sandbox_result, indent=2)}"

            conversation.append({
                "role": "user",
                "content": [{"text": result_text}],
            })

        # Call Bedrock again with updated conversation
        think_id = _start_activity(session_id, "Thinking…", "thinking")
        assistant_text = _call_bedrock(conversation)
        _finish_activity(session_id, think_id, "Processed results", "thinking", "done",
                         detail=_activity_summary(assistant_text))
        conversation.append({"role": "assistant", "content": [{"text": assistant_text}]})
        _round_visible = _strip_tags(assistant_text)
        if _round_visible:
            narrative_parts.append(_round_visible)

    # 8. Handle <approval_needed>
    approval_blocks = _find("approval_needed", assistant_text)
    if approval_blocks:
        _log_activity(session_id, str(uuid.uuid4()), "Awaiting your approval", "pending", "pending")
        for block in approval_blocks:
            try:
                item = json.loads(block.strip())
            except json.JSONDecodeError:
                item = {"raw": block.strip()}
            approval_items.append(item)

        status = "awaiting_approval"

        if APPROVALS_TOPIC_ARN:
            api_base    = os.environ.get("API_BASE_URL", "").rstrip("/")
            approval_url = f"{api_base}/sessions/{session_id}" if api_base else f"(open the chat — session {session_id})"
            n           = len(approval_items)
            pr_urls     = [i.get("pr_url") or i.get("prs", [{}])[0].get("url", "") for i in approval_items if isinstance(i, dict)]
            pr_urls     = [u for u in pr_urls if u]
            test_env    = next((i.get("test_env_url", "") for i in approval_items if isinstance(i, dict) and i.get("test_env_url")), "")
            summary_txt = next((i.get("summary", "") for i in approval_items if isinstance(i, dict) and i.get("summary")), f"{n} fix{'es' if n != 1 else ''} ready")

            email_body = (
                f"ZeroBug has {n} fix{'es' if n != 1 else ''} ready for your approval.\n\n"
                f"{summary_txt}\n\n"
                + (f"Pull requests:\n" + "\n".join(f"  - {u}" for u in pr_urls) + "\n\n" if pr_urls else "")
                + (f"Test environment: {test_env}\n\n" if test_env else "")
                + f"Review and approve here:\n{approval_url}\n\n"
                "This approval will merge the PRs and close the linked tickets.\n"
                "After the merge completes, ZeroBug will ask you whether to deploy "
                "to production and what deployment target to use.\n"
                "If you did not expect this, you can reject it in the chat."
            )

            _sns.publish(
                TopicArn=APPROVALS_TOPIC_ARN,
                Subject=f"[ZeroBug] {n} fix{'es' if n != 1 else ''} ready for your approval",
                Message=email_body,
                MessageAttributes={
                    "session_id": {"DataType": "String", "StringValue": session_id},
                },
            )

    # 9. Handle <done>
    done_blocks = _find("done", assistant_text)
    if done_blocks:
        status = "completed"
        _log_activity(session_id, str(uuid.uuid4()), "Task complete", "done", "done")

    # 10. Build the visible message from every round's narrative — not just
    # the final round. Without this, when the LLM ends a multi-round turn on
    # an <approval_needed> / <done> block, the bubble would show 0 lines of
    # text (because _strip_tags of the final round leaves nothing) and the
    # user would just see a wall of code chips. We dedupe consecutive
    # repeats so a model that re-states its plan across rounds doesn't echo
    # itself in the bubble.
    deduped: list[str] = []
    for part in narrative_parts:
        if part and (not deduped or deduped[-1] != part):
            deduped.append(part)
    clean_message = "\n\n".join(deduped)

    # Also surface <ask> and <done> content as the visible message if that's
    # all Claude said (avoids returning an empty string)
    ask_blocks = _find("ask", assistant_text)
    if not clean_message:
        if ask_blocks:
            clean_message = ask_blocks[0].strip()
        elif done_blocks:
            clean_message = done_blocks[0].strip()

    # 11. Persist conversation and session state
    _save_session(
        session_id,
        conversation=json.dumps(conversation),
        status=status,
        approval_items=json.dumps(approval_items),
    )

    # 12. Return
    return {
        "statusCode": 200,
        "body": json.dumps({
            "session_id":        session_id,
            "message":           clean_message,
            "reply":             clean_message,   # backward-compat alias
            "status":            status,
            "approval_items":    approval_items,
            "agent_code_blocks": agent_code_blocks,
            "type":              "approval_request" if approval_blocks else
                                 "completed"        if done_blocks      else
                                 "message",
        }),
    }


# Alias for backward compatibility
handler = lambda_handler


# ── Streaming handler ─────────────────────────────────────────────────────────
#
# Mirrors lambda_handler / _lambda_handler_inner but yields structured events
# as Claude streams and as sandbox blocks execute. Consumed by the SSE
# endpoint in api/routes/chat.py for the "Cursor-style" inline reasoning chip
# and live activity feed.
#
# Emitted event kinds (always (kind, payload_dict) tuples):
#   "reasoning_delta" — {"text": chunk}  chain-of-thought text chunk
#   "text_delta"      — {"text": chunk}  visible reply text chunk (raw, may
#                                        contain XML tags — frontend should
#                                        not render these mid-stream)
#   "activity_start"  — {id,label,icon,status,detail?}  step began
#   "activity_done"   — {id,label,icon,status,detail?}  step finished
#   "agent_code"      — {full agent_code_block dict}    sandbox run finished
#   "done"            — {full final payload, matches lambda_handler body}
#   "error"           — {message, ...}                  hard error, terminal
#
# We deliberately yield text_delta even though we also send the cleaned reply
# in "done", so the frontend can stream the bot bubble live if it wants. For
# now the frontend renders the bubble on "done" to avoid mid-stream tag
# rendering; we can switch to live streaming later for free.


def _stream_one_bedrock_call(session_id: str, conversation: list,
                             start_label: str, done_label: str, icon: str = "thinking"):
    """Sub-generator: start a thinking activity, stream Bedrock, finish.

    Yields the same event kinds as ``stream_handler``. Appends the assistant
    message to ``conversation`` in place. Stashes the final assistant_text on
    the generator's ``.gi_frame`` via a closure dict — callers read it back
    from the dict they pass in via ``out``.
    """
    think_id = _start_activity(session_id, start_label, icon)
    yield "activity_start", {
        "id": think_id, "label": start_label, "icon": icon, "status": "in_progress",
    }

    parts: list[str] = []
    full_visible = ""
    for kind, chunk in _stream_bedrock(conversation):
        if kind == "reasoning":
            yield "reasoning_delta", {"text": chunk}
        elif kind == "text":
            parts.append(chunk)
            yield "text_delta", {"text": chunk}
        elif kind == "done":
            full_visible = chunk or "".join(parts).strip()

    assistant_text = full_visible or "".join(parts).strip()
    detail = _activity_summary(assistant_text)
    _finish_activity(session_id, think_id, done_label, icon, "done", detail=detail)
    yield "activity_done", {
        "id": think_id, "label": done_label, "icon": icon, "status": "done", "detail": detail,
    }

    conversation.append({"role": "assistant", "content": [{"text": assistant_text}]})
    yield "assistant_text", {"text": assistant_text}  # internal signal — consumed in main loop


def _stream_handler_inner(session_id: str, user_message: str):
    session = _load_session(session_id)
    credentials = _credentials_with_uploads(
        _get_credentials(session), _get_uploaded_files(session)
    )

    raw_conv = session.get("conversation", "[]")
    conversation: list = json.loads(raw_conv) if isinstance(raw_conv, str) else raw_conv
    conversation.append({"role": "user", "content": [{"text": user_message}]})

    assistant_text = ""
    for kind, payload in _stream_one_bedrock_call(
        session_id, conversation, "Thinking…", "Analysed request"
    ):
        if kind == "assistant_text":
            assistant_text = payload["text"]
        else:
            yield kind, payload

    status = session.get("status", "active")
    approval_items = json.loads(session.get("approval_items", "[]"))
    agent_code_blocks: list = []
    # Accumulate visible narrative across rounds — see _lambda_handler_inner
    # for the rationale. Without this, the streaming bubble ends up empty
    # when the last round is purely an <approval_needed> / <done> block.
    narrative_parts: list[str] = []
    _initial_visible = _strip_tags(assistant_text)
    if _initial_visible:
        narrative_parts.append(_initial_visible)

    sandbox_fail_count = 0
    for _round in range(MAX_EXECUTE_ROUNDS):
        execute_blocks = _find("execute", assistant_text)
        if not execute_blocks:
            break

        for code in execute_blocks:
            code = code.strip()
            label, icon = _icon_from_code(code)
            exec_id = _start_activity(session_id, label, icon, detail=code)
            yield "activity_start", {
                "id": exec_id, "label": label, "icon": icon,
                "status": "in_progress", "detail": code,
            }

            sandbox_result = _invoke_sandbox(session_id, code, credentials)

            error_type = sandbox_result.get("error")
            error_detail = sandbox_result.get("detail")
            if error_type:
                sandbox_fail_count += 1
            else:
                sandbox_fail_count = 0

            result_summary = _summarise_sandbox_result(sandbox_result)
            block_status = "error" if error_type else "done"

            block = {
                "id":             str(uuid.uuid4()),
                "language":       "python",
                "code":           code,
                "purpose":        label,
                "status":         block_status,
                "result_summary": result_summary,
            }
            agent_code_blocks.append(block)
            yield "agent_code", block

            if error_type == "auth_error":
                err_label, err_detail = f"{label} — auth failed", f"Credentials rejected: {error_detail}"
            elif error_type in ("timeout", "network_timeout"):
                err_label, err_detail = f"{label} — timed out", error_detail
            elif error_type == "network_error":
                err_label, err_detail = f"{label} — network error", error_detail
            elif error_type == "library_not_available":
                err_label, err_detail = f"{label} — library missing", error_detail
            elif error_type:
                err_label, err_detail = f"{label} — failed", f"{error_type}: {error_detail}"
            else:
                err_label, err_detail = label, code

            _finish_activity(session_id, exec_id, err_label, icon, block_status, detail=err_detail)
            yield "activity_done", {
                "id": exec_id, "label": err_label, "icon": icon,
                "status": block_status, "detail": err_detail,
            }

            if sandbox_fail_count >= MAX_SANDBOX_RETRIES:
                result_text = (
                    "Sandbox result:\n" + json.dumps(sandbox_result, indent=2) +
                    "\n\nSystem note: sandbox has failed 3 times in a row. "
                    "Stop retrying this approach and tell the user what went wrong "
                    "in plain language. Do not attempt another <execute> block."
                )
            elif error_type == "auth_error":
                result_text = (
                    "Sandbox result:\n" + json.dumps(sandbox_result, indent=2) +
                    "\n\nSystem note: the credentials provided did not work (authentication failed). "
                    "Stop execution immediately. Tell the user clearly: their credentials are not working "
                    "and they should check them. Specify which credential failed (e.g. GITHUB_PAT, JIRA_TOKEN). "
                    "Do not retry. Do not attempt another <execute> block."
                )
            else:
                result_text = f"Sandbox result:\n{json.dumps(sandbox_result, indent=2)}"

            conversation.append({"role": "user", "content": [{"text": result_text}]})

        for kind, payload in _stream_one_bedrock_call(
            session_id, conversation, "Thinking…", "Processed results"
        ):
            if kind == "assistant_text":
                assistant_text = payload["text"]
            else:
                yield kind, payload
        _round_visible = _strip_tags(assistant_text)
        if _round_visible:
            narrative_parts.append(_round_visible)

    # Approval handling — mirror the sync path including SNS notify.
    approval_blocks = _find("approval_needed", assistant_text)
    if approval_blocks:
        appr_id = str(uuid.uuid4())
        _log_activity(session_id, appr_id, "Awaiting your approval", "pending", "pending")
        yield "activity_start", {
            "id": appr_id, "label": "Awaiting your approval", "icon": "pending", "status": "pending",
        }
        for block in approval_blocks:
            try:
                item = json.loads(block.strip())
            except json.JSONDecodeError:
                item = {"raw": block.strip()}
            approval_items.append(item)
        status = "awaiting_approval"

        if APPROVALS_TOPIC_ARN:
            api_base    = os.environ.get("API_BASE_URL", "").rstrip("/")
            approval_url = f"{api_base}/sessions/{session_id}" if api_base else f"(open the chat — session {session_id})"
            n           = len(approval_items)
            pr_urls     = [i.get("pr_url") or i.get("prs", [{}])[0].get("url", "") for i in approval_items if isinstance(i, dict)]
            pr_urls     = [u for u in pr_urls if u]
            test_env    = next((i.get("test_env_url", "") for i in approval_items if isinstance(i, dict) and i.get("test_env_url")), "")
            summary_txt = next((i.get("summary", "") for i in approval_items if isinstance(i, dict) and i.get("summary")), f"{n} fix{'es' if n != 1 else ''} ready")

            email_body = (
                f"ZeroBug has {n} fix{'es' if n != 1 else ''} ready for your approval.\n\n"
                f"{summary_txt}\n\n"
                + (f"Pull requests:\n" + "\n".join(f"  - {u}" for u in pr_urls) + "\n\n" if pr_urls else "")
                + (f"Test environment: {test_env}\n\n" if test_env else "")
                + f"Review and approve here:\n{approval_url}\n\n"
                "This approval will merge the PRs and close the linked tickets.\n"
                "After the merge completes, ZeroBug will ask you whether to deploy "
                "to production and what deployment target to use.\n"
                "If you did not expect this, you can reject it in the chat."
            )
            try:
                _sns.publish(
                    TopicArn=APPROVALS_TOPIC_ARN,
                    Subject=f"[ZeroBug] {n} fix{'es' if n != 1 else ''} ready for your approval",
                    Message=email_body,
                    MessageAttributes={"session_id": {"DataType": "String", "StringValue": session_id}},
                )
            except Exception:
                pass  # SNS publish is best-effort — don't break the turn

    done_blocks = _find("done", assistant_text)
    if done_blocks:
        status = "completed"
        d_id = str(uuid.uuid4())
        _log_activity(session_id, d_id, "Task complete", "done", "done")
        yield "activity_done", {"id": d_id, "label": "Task complete", "icon": "done", "status": "done"}

    deduped: list[str] = []
    for part in narrative_parts:
        if part and (not deduped or deduped[-1] != part):
            deduped.append(part)
    clean_message = "\n\n".join(deduped)

    ask_blocks = _find("ask", assistant_text)
    if not clean_message:
        if ask_blocks:
            clean_message = ask_blocks[0].strip()
        elif done_blocks:
            clean_message = done_blocks[0].strip()

    _save_session(
        session_id,
        conversation=json.dumps(conversation),
        status=status,
        approval_items=json.dumps(approval_items),
    )

    yield "done", {
        "session_id":        session_id,
        "message":           clean_message,
        "reply":             clean_message,
        "status":            status,
        "approval_items":    approval_items,
        "agent_code_blocks": agent_code_blocks,
        "type":              "approval_request" if approval_blocks else
                             "completed"        if done_blocks      else
                             "message",
    }


def stream_handler(event):
    """Public streaming entry point. Mirrors lambda_handler's input shape.

    Yields the same event kinds as ``_stream_handler_inner``. On uncaught
    error, appends a recovery message to the session history (so subsequent
    turns stay coherent) and yields a single ``("error", payload)`` event
    with the same body shape as ``_safe_error_response``.
    """
    if isinstance(event.get("body"), str):
        body = json.loads(event["body"])
    else:
        body = event

    session_id   = body.get("session_id") or str(uuid.uuid4())
    user_message = body.get("user_message") or body.get("message", "")

    try:
        yield from _stream_handler_inner(session_id, user_message)
    except Exception as exc:
        try:
            session = _load_session(session_id)
            raw_conv = session.get("conversation", "[]")
            conversation = json.loads(raw_conv) if isinstance(raw_conv, str) else raw_conv
            conversation.append({
                "role": "assistant",
                "content": [{"text": f"I ran into an issue: {type(exc).__name__}. Let me try a different approach."}],
            })
            _save_session(session_id, conversation=json.dumps(conversation))
        except Exception:
            pass
        body = json.loads(_safe_error_response(session_id, exc)["body"])
        yield "error", body
