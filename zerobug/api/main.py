"""
ZeroBug API — session management + approval endpoints.
Bridges the React frontend and the runtime/sandbox Lambdas.
"""
import json
import os
import time
import uuid

import boto3
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

import sys
sys.path.insert(0, os.path.dirname(__file__))

load_dotenv()

from logging_setup import setup_logging, get_logger, log_event  # noqa: E402
setup_logging(os.getenv("LOG_LEVEL", "INFO"))
log = get_logger("api.main")

app = FastAPI(title="ZeroBug API", version="0.1.0")


@app.middleware("http")
async def access_log_middleware(request: Request, call_next):
    """Log every request with method, path, status, and latency."""
    start = time.perf_counter()
    response = await call_next(request)
    elapsed_ms = round((time.perf_counter() - start) * 1000, 1)

    path = request.url.path
    # Skip the noisy /activity polling for the structured event log,
    # but still surface non-2xx polling responses.
    is_activity_poll = request.method == "GET" and path.endswith("/activity")
    if not is_activity_poll or response.status_code >= 400:
        log_event(
            "http.request",
            method=request.method,
            path=path,
            status=response.status_code,
            latency_ms=elapsed_ms,
            client=request.client.host if request.client else None,
        )
    return response

from routes.credentials import router as credentials_router  # noqa: E402
from routes.chat import router as chat_router                # noqa: E402
from routes.approval import router as approval_router        # noqa: E402
from routes.files import router as files_router              # noqa: E402
app.include_router(credentials_router, prefix="/api")
app.include_router(chat_router, prefix="/api")
app.include_router(approval_router, prefix="/api")
app.include_router(files_router, prefix="/api")

CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_lambda = boto3.client("lambda", region_name=os.getenv("AWS_DEFAULT_REGION", "us-east-1"))
_dynamo = boto3.resource("dynamodb", region_name=os.getenv("AWS_DEFAULT_REGION", "us-east-1"))
_dynamo_endpoint = os.getenv("DYNAMODB_ENDPOINT")
if _dynamo_endpoint:
    _dynamo = boto3.resource(
        "dynamodb",
        region_name=os.getenv("AWS_DEFAULT_REGION", "us-east-1"),
        endpoint_url=_dynamo_endpoint,
        aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID", "local"),
        aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY", "local"),
    )

approvals_table = _dynamo.Table(os.getenv("DYNAMODB_TABLE_APPROVALS", "zerobug-approvals"))
sessions_table = _dynamo.Table(os.getenv("DYNAMODB_TABLE_SESSIONS", "zerobug-sessions"))


class ChatRequest(BaseModel):
    session_id: str | None = None
    message: str


class ApprovalRequest(BaseModel):
    approval_id: str
    approved: bool
    session_id: str


@app.get("/health")
def health():
    results = {"status": "ok", "dynamodb": "ok", "bedrock": "ok", "sandbox": "ok"}

    # DynamoDB ping
    try:
        _dynamo.meta.client.describe_table(
            TableName=os.getenv("DYNAMODB_TABLE_SESSIONS", "zerobug-sessions")
        )
    except Exception as e:
        results["dynamodb"] = f"error: {type(e).__name__}"
        results["status"] = "degraded"

    # Bedrock ping — list_foundation_models with no args is the lightest call
    try:
        bedrock = boto3.client(
            "bedrock",
            region_name=os.getenv("BEDROCK_REGION", os.getenv("AWS_DEFAULT_REGION", "us-east-1")),
        )
        bedrock.list_foundation_models(byProvider="Anthropic")
    except Exception as e:
        results["bedrock"] = f"error: {type(e).__name__}"
        results["status"] = "degraded"

    # Sandbox ping — import check only (no Lambda invocation needed for local dev)
    try:
        import sys as _sys
        sandbox_path = os.path.join(os.path.dirname(__file__), "..", "sandbox")
        if sandbox_path not in _sys.path:
            _sys.path.insert(0, sandbox_path)
        import importlib
        importlib.import_module("executor")
    except Exception as e:
        results["sandbox"] = f"error: {type(e).__name__}"
        results["status"] = "degraded"

    return results


@app.post("/chat")
def chat(req: ChatRequest):
    session_id = req.session_id or str(uuid.uuid4())
    runtime_arn = os.getenv("RUNTIME_LAMBDA_ARN")

    try:
        if runtime_arn:
            resp = _lambda.invoke(
                FunctionName=runtime_arn,
                InvocationType="RequestResponse",
                Payload=json.dumps({"session_id": session_id, "user_message": req.message}),
            )
            payload = json.loads(resp["Payload"].read())
            body = json.loads(payload.get("body", "{}"))
        else:
            # Local dev fallback — direct import
            import sys, os as _os
            sys.path.insert(0, _os.path.join(_os.path.dirname(__file__), "..", "runtime"))
            import importlib
            runtime_mod = importlib.import_module("handler")
            importlib.reload(runtime_mod)
            result = runtime_mod.handler({"session_id": session_id, "user_message": req.message}, None)
            body = json.loads(result["body"])
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return {
        "session_id": session_id,
        "reply": body.get("reply", ""),
        "type": body.get("type", "message"),
        "approval_id": body.get("approval_id"),
    }


@app.post("/approve")
def approve(req: ApprovalRequest):
    item_resp = approvals_table.get_item(Key={"approval_id": req.approval_id})
    item = item_resp.get("Item")
    if not item:
        raise HTTPException(status_code=404, detail="Approval not found")
    if item.get("status") != "pending":
        raise HTTPException(status_code=409, detail="Approval already resolved")

    if not req.approved:
        approvals_table.update_item(
            Key={"approval_id": req.approval_id},
            UpdateExpression="SET #s = :s",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={":s": "rejected"},
        )
        return {"session_id": req.session_id, "reply": "Got it — I've cancelled that action. Let me know if you'd like to try something different."}

    approvals_table.update_item(
        Key={"approval_id": req.approval_id},
        UpdateExpression="SET #s = :s",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":s": "approved"},
    )

    sandbox_arn = os.getenv("SANDBOX_LAMBDA_ARN")
    action = item.get("action", {})

    if sandbox_arn:
        _lambda.invoke(
            FunctionName=sandbox_arn,
            InvocationType="Event",
            Payload=json.dumps({"session_id": req.session_id, "action": action}),
        )
        reply = "Approved! Running the task now. Results will appear here shortly."
    else:
        import sys, os as _os
        sys.path.insert(0, _os.path.join(_os.path.dirname(__file__), "..", "sandbox"))
        from handler import handler as sandbox_handler
        result = sandbox_handler({"session_id": req.session_id, "action": action}, None)
        body = json.loads(result["body"])
        output = body.get("stdout") or body.get("stderr") or "No output."
        success = body.get("success", False)
        reply = f"{'Done!' if success else 'Finished with errors.'}\n\n```\n{output}\n```"

    return {"session_id": req.session_id, "reply": reply}


@app.get("/session/{session_id}")
def get_session(session_id: str):
    resp = sessions_table.get_item(Key={"session_id": session_id})
    item = resp.get("Item")
    if not item:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"session_id": session_id, "messages": item.get("messages", [])}


# AWS Lambda entry point (Mangum wraps FastAPI for API Gateway)
from mangum import Mangum  # noqa: E402
handler = Mangum(app)
