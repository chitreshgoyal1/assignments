"""
ZeroBug Sandbox Lambda — isolated code execution.
Receives code generated at runtime by the Claude loop,
executes it in a restricted subprocess, captures output,
and writes results back to DynamoDB for the API to surface.
"""
import json
import os
import subprocess
import sys
import tempfile
import uuid
import boto3

dynamodb = boto3.resource("dynamodb", region_name=os.environ["AWS_DEFAULT_REGION"])
results_table = dynamodb.Table(os.environ.get("DYNAMODB_TABLE_RESULTS", "zerobug-results"))
sessions_table = dynamodb.Table(os.environ["DYNAMODB_TABLE_SESSIONS"])

TIMEOUT_SECONDS = int(os.environ.get("SANDBOX_TIMEOUT", "30"))
MAX_OUTPUT_BYTES = 64 * 1024  # 64 KB


def run_python(code: str) -> dict:
    with tempfile.NamedTemporaryFile(suffix=".py", mode="w", delete=False) as f:
        f.write(code)
        tmp_path = f.name

    try:
        _safe_keys = {"PATH", "HOME", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL", "PYTHONDONTWRITEBYTECODE"}
        safe_env = {k: v for k, v in os.environ.items() if k in _safe_keys}
        safe_env["PYTHONDONTWRITEBYTECODE"] = "1"
        result = subprocess.run(
            [sys.executable, tmp_path],
            capture_output=True,
            text=True,
            timeout=TIMEOUT_SECONDS,
            env=safe_env,
        )
        return {
            "exit_code": result.returncode,
            "stdout": result.stdout[:MAX_OUTPUT_BYTES],
            "stderr": result.stderr[:MAX_OUTPUT_BYTES],
            "success": result.returncode == 0,
        }
    except subprocess.TimeoutExpired:
        return {"exit_code": -1, "stdout": "", "stderr": "Execution timed out.", "success": False}
    except Exception as exc:
        return {"exit_code": -1, "stdout": "", "stderr": str(exc), "success": False}
    finally:
        os.unlink(tmp_path)


def run_shell(code: str) -> dict:
    try:
        result = subprocess.run(
            code,
            shell=True,
            capture_output=True,
            text=True,
            timeout=TIMEOUT_SECONDS,
        )
        return {
            "exit_code": result.returncode,
            "stdout": result.stdout[:MAX_OUTPUT_BYTES],
            "stderr": result.stderr[:MAX_OUTPUT_BYTES],
            "success": result.returncode == 0,
        }
    except subprocess.TimeoutExpired:
        return {"exit_code": -1, "stdout": "", "stderr": "Execution timed out.", "success": False}
    except Exception as exc:
        return {"exit_code": -1, "stdout": "", "stderr": str(exc), "success": False}


def handler(event, context):
    body = json.loads(event.get("body", "{}")) if isinstance(event.get("body"), str) else event

    session_id = body.get("session_id", "unknown")
    action = body.get("action", {})
    code = action.get("code", "")
    language = action.get("language", "python").lower()

    if language in ("python", "py"):
        exec_result = run_python(code)
    elif language in ("bash", "shell", "sh"):
        exec_result = run_shell(code)
    else:
        exec_result = {"exit_code": -1, "stdout": "", "stderr": f"Unsupported language: {language}", "success": False}

    result_id = str(uuid.uuid4())
    results_table.put_item(
        Item={
            "result_id": result_id,
            "session_id": session_id,
            "language": language,
            "success": exec_result["success"],
            "stdout": exec_result["stdout"],
            "stderr": exec_result["stderr"],
            "exit_code": exec_result["exit_code"],
        }
    )

    return {
        "statusCode": 200,
        "body": json.dumps({"result_id": result_id, **exec_result}),
    }
