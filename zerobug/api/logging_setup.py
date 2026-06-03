"""
Centralised logging for the ZeroBug API.

Three sinks:
- console        — human-readable, what you already see from uvicorn
- logs/zerobug.log    — rotating text log (5 MB x 5 files), human-readable
- logs/events.jsonl   — one JSON object per line, machine-friendly,
                        used for high-signal product events (session created,
                        message received, runtime invoked, approval decision, ...).

Use it like this from any module:

    from logging_setup import get_logger, log_event
    log = get_logger(__name__)

    log.info("plain text line")
    log_event("message.received", session_id=sid, text=msg)
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any

# ── paths ─────────────────────────────────────────────────────────────────────
# logs/ lives at the repo root (one level up from api/)
_LOG_DIR = Path(__file__).resolve().parent.parent / "logs"
_LOG_DIR.mkdir(parents=True, exist_ok=True)

_TEXT_LOG_PATH  = _LOG_DIR / "zerobug.log"
_EVENT_LOG_PATH = _LOG_DIR / "events.jsonl"

# ── formatters ────────────────────────────────────────────────────────────────
_TEXT_FORMAT = "%(asctime)s %(levelname)-5s [%(name)s] %(message)s"
_TEXT_DATEFMT = "%Y-%m-%d %H:%M:%S"


class _JsonLineFormatter(logging.Formatter):
    """Renders a LogRecord as a single JSON line."""

    def format(self, record: logging.LogRecord) -> str:  # noqa: D401
        payload: dict[str, Any] = {
            "ts":      datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level":   record.levelname,
            "logger":  record.name,
            "message": record.getMessage(),
        }
        # Anything passed via `extra={...}` lands on the record as attributes.
        # Promote our own structured fields if present.
        for key in ("event", "session_id", "fields"):
            if hasattr(record, key):
                payload[key] = getattr(record, key)
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str, ensure_ascii=False)


class _ActivityPollFilter(logging.Filter):
    """
    Drop uvicorn access-log lines for GET /api/sessions/.../activity.
    The frontend polls that endpoint every ~1s which otherwise drowns the log.
    """

    def filter(self, record: logging.LogRecord) -> bool:  # noqa: D401
        msg = record.getMessage()
        return "/activity" not in msg or "GET" not in msg


# ── setup ─────────────────────────────────────────────────────────────────────
_INITIALISED = False


def setup_logging(level: str | int = "INFO") -> None:
    """Configure root + uvicorn loggers. Safe to call more than once."""
    global _INITIALISED
    if _INITIALISED:
        return
    _INITIALISED = True

    text_formatter = logging.Formatter(_TEXT_FORMAT, datefmt=_TEXT_DATEFMT)
    json_formatter = _JsonLineFormatter()

    # Root logger — text format on console + rotating file
    root = logging.getLogger()
    root.setLevel(level)

    console = logging.StreamHandler()
    console.setFormatter(text_formatter)
    root.addHandler(console)

    text_file = RotatingFileHandler(
        _TEXT_LOG_PATH, maxBytes=5 * 1024 * 1024, backupCount=5, encoding="utf-8"
    )
    text_file.setFormatter(text_formatter)
    root.addHandler(text_file)

    # Dedicated "events" logger — owns the JSONL sink. Propagates up to root so
    # the same lines also land in the console + rotating text log (in their
    # human-readable formatting).
    events = logging.getLogger("zerobug.events")
    events.setLevel(logging.INFO)
    events.propagate = True
    events_handler = RotatingFileHandler(
        _EVENT_LOG_PATH, maxBytes=10 * 1024 * 1024, backupCount=5, encoding="utf-8"
    )
    events_handler.setFormatter(json_formatter)
    events.addHandler(events_handler)

    # Tame uvicorn's noisy /activity polling on the access logger
    uv_access = logging.getLogger("uvicorn.access")
    uv_access.addFilter(_ActivityPollFilter())

    logging.getLogger(__name__).info(
        "logging initialised → console + %s + %s", _TEXT_LOG_PATH, _EVENT_LOG_PATH
    )


def get_logger(name: str) -> logging.Logger:
    """Convenience wrapper so callers don't import `logging` themselves."""
    return logging.getLogger(name)


def log_event(event: str, *, session_id: str | None = None, **fields: Any) -> None:
    """
    Emit a structured product event.

    The line ends up in logs/events.jsonl as JSON, and is also mirrored to the
    console in a readable form.
    """
    logger = logging.getLogger("zerobug.events")
    # Build a short human-readable message for the console mirror.
    parts = [event]
    if session_id:
        parts.append(f"session={session_id[:8]}")
    for k, v in fields.items():
        rendered = _short(v)
        parts.append(f"{k}={rendered}")
    logger.info(
        " ".join(parts),
        extra={"event": event, "session_id": session_id, "fields": fields},
    )


def _short(value: Any, limit: int = 200) -> str:
    """Truncate long values for the human console mirror (full value still in JSON)."""
    if isinstance(value, str):
        s = value.replace("\n", " ").strip()
    else:
        try:
            s = json.dumps(value, default=str, ensure_ascii=False)
        except (TypeError, ValueError):
            s = str(value)
    if len(s) > limit:
        s = s[: limit - 1] + "…"
    if any(ch.isspace() for ch in s):
        s = f'"{s}"'
    return s
