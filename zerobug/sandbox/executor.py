"""
ZeroBug Sandbox Lambda — safe execution of Claude-generated Python code.

Convention: Claude always assigns its final structured output to RESULT.
The sandbox returns exec_globals["RESULT"] alongside captured stdout.
"""
import io
import json
import os
import re
import sys
import threading

import requests

# ── Blocklist patterns ────────────────────────────────────────────────────────

_BLOCKED_PATTERNS = [
    # Subprocess / shell execution
    (r"\bsubprocess\b", "subprocess module is not allowed"),
    (r"\bos\.system\s*\(", "os.system() is not allowed"),
    (r"\bos\.popen\s*\(", "os.popen() is not allowed"),
    (r"\bos\.spawn", "os.spawn* is not allowed"),
    (r"\bos\.exec", "os.exec* is not allowed"),
    # Nested eval/exec
    (r"\beval\s*\(\s*eval\b", "nested eval is not allowed"),
    (r"\bexec\s*\(\s*exec\b", "nested exec is not allowed"),
    # Dangerous imports
    (r"\bimport\s+subprocess\b", "subprocess import is not allowed"),
    (r"\bimport\s+ctypes\b", "ctypes import is not allowed"),
    (r"\bfrom\s+ctypes\b", "ctypes import is not allowed"),
    (r"\bimport\s+socket\b", "raw socket import is not allowed"),
    (r"\bfrom\s+socket\b", "raw socket import is not allowed"),
    (r"\b__import__\s*\(\s*['\"]subprocess", "subprocess import is not allowed"),
    # File system writes outside /tmp
    (r"open\s*\([^)]*['\"][^'\"]*(?<!\/tmp\/)[^'\"]*['\"][^)]*,\s*['\"][^'\"]*w", "file writes outside /tmp are not allowed"),
    # AWS metadata endpoint
    (r"169\.254\.169\.254", "access to AWS metadata endpoint is not allowed"),
    # importlib bypass attempts
    (r"importlib.*subprocess", "subprocess import via importlib is not allowed"),
]

_COMPILED_BLOCKLIST = [(re.compile(p, re.IGNORECASE), msg) for p, msg in _BLOCKED_PATTERNS]


def _validate(code: str) -> tuple[bool, str]:
    for pattern, message in _COMPILED_BLOCKLIST:
        if pattern.search(code):
            return False, message
    return True, ""


# ── Safe builtins ─────────────────────────────────────────────────────────────

_SAFE_BUILTINS = {
    "print": print,
    "len": len,
    "range": range,
    "enumerate": enumerate,
    "zip": zip,
    "map": map,
    "filter": filter,
    "sorted": sorted,
    "reversed": reversed,
    "min": min,
    "max": max,
    "sum": sum,
    "abs": abs,
    "round": round,
    "isinstance": isinstance,
    "issubclass": issubclass,
    "hasattr": hasattr,
    "getattr": getattr,
    "setattr": setattr,
    "dict": dict,
    "list": list,
    "tuple": tuple,
    "set": set,
    "str": str,
    "int": int,
    "float": float,
    "bool": bool,
    "bytes": bytes,
    "type": type,
    "repr": repr,
    "format": format,
    "vars": vars,
    "dir": dir,
    "None": None,
    "True": True,
    "False": False,
    "Exception": Exception,
    "ValueError": ValueError,
    "KeyError": KeyError,
    "TypeError": TypeError,
    "IndexError": IndexError,
    "RuntimeError": RuntimeError,
    "__build_class__": __build_class__,
    "__name__": "__main__",
    # Allow import statements inside exec'd code; dangerous imports are
    # caught by the blocklist before execution reaches this point.
    "__import__": __import__,
}


# ── Execution ─────────────────────────────────────────────────────────────────

class _TimeoutError(Exception):
    pass


def _exec_with_timeout(code: str, exec_globals: dict, timeout: int) -> None:
    """Run exec() in a daemon thread; raise _TimeoutError if it exceeds timeout."""
    exc_holder: list = []

    def _run():
        try:
            exec(code, exec_globals)  # noqa: S102
        except Exception as e:
            exc_holder.append(e)

    t = threading.Thread(target=_run, daemon=True)
    t.start()
    t.join(timeout=timeout)

    if t.is_alive():
        raise _TimeoutError(f"Execution exceeded {timeout}s timeout")

    if exc_holder:
        raise exc_holder[0]


# ── Lambda handler ────────────────────────────────────────────────────────────

def lambda_handler(event, context):
    session_id = event.get("session_id", "unknown")
    code = event.get("code", "")
    credentials = event.get("credentials") or {}
    timeout_seconds = int(event.get("timeout_seconds", 30))

    # 1. Validate
    ok, reason = _validate(code)
    if not ok:
        return {
            "session_id": session_id,
            "output": "",
            "result": None,
            "error": "blocked_operation",
            "detail": reason,
        }

    # 2. Inject credentials as env vars (scoped to this process — Lambda is single-tenant)
    original_env = {}
    for key, value in credentials.items():
        original_env[key] = os.environ.get(key)
        os.environ[key] = str(value)

    # 3. Build safe execution namespace
    # os is included but writes are blocked by the blocklist;
    # os.environ is readable so code can access injected credentials.
    exec_globals: dict = {
        "__builtins__": _SAFE_BUILTINS,
        "requests": requests,
        "json": json,
        "os": os,
    }

    # 4. Redirect stdout
    captured = io.StringIO()
    original_stdout = sys.stdout
    sys.stdout = captured

    result = None
    error = None
    detail = None

    try:
        # 5. Execute with timeout
        _exec_with_timeout(code, exec_globals, timeout_seconds)
        # 6. Extract RESULT
        result = exec_globals.get("RESULT")

    except _TimeoutError as e:
        error = "timeout"
        detail = str(e)

    except ModuleNotFoundError as e:
        error = "library_not_available"
        detail = str(e)

    except Exception as e:
        # Classify common network/API errors for Claude to act on
        err_str = str(e).lower()
        if any(k in err_str for k in ("timed out", "timeout", "read timed out")):
            error = "network_timeout"
            detail = str(e)
        elif any(k in err_str for k in ("connection", "refused", "unreachable", "name or service not known")):
            error = "network_error"
            detail = str(e)
        elif any(k in err_str for k in ("401", "403", "unauthorized", "forbidden")):
            error = "auth_error"
            detail = str(e)
        elif any(k in err_str for k in ("404", "not found")):
            error = "not_found"
            detail = str(e)
        else:
            error = type(e).__name__
            detail = str(e)

    finally:
        sys.stdout = original_stdout
        # Restore env vars to avoid leaking credentials across warm Lambda invocations
        for key, original_value in original_env.items():
            if original_value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = original_value

    output = captured.getvalue()

    return {
        "session_id": session_id,
        "output": output,
        "result": result,
        "error": error,
        "detail": detail,
    }


# Keep backward-compatible alias used by sandbox/handler.py callers
handler = lambda_handler
