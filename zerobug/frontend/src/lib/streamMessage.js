// SSE stream parser for /sessions/{id}/message/stream. EventSource doesn't
// support POST, so we read the response body as a stream and parse SSE
// frames manually.
//
// Each frame is two newlines apart. Lines inside a frame look like:
//   event: <kind>
//   data: <json string>
//
// Calls onEvent(kind, data) for every frame. Returns the final `done`
// payload on success, throws on network/parse errors.

const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

function parseSseFrame(frame) {
  // Single frame body. Multiple `data:` lines are joined with \n per the SSE spec.
  let event = "message";
  const dataLines = [];
  for (const rawLine of frame.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^ /, ""));
    }
  }
  const dataStr = dataLines.join("\n");
  let data = null;
  if (dataStr) {
    try {
      data = JSON.parse(dataStr);
    } catch {
      data = { raw: dataStr };
    }
  }
  return { event, data };
}

/**
 * Send a chat message and stream Claude's response.
 *
 * @param {object} args
 * @param {string} args.sessionId
 * @param {string} args.message
 * @param {(kind: string, data: any) => void} args.onEvent
 * @param {AbortSignal} [args.signal]
 * @returns {Promise<{ ok: boolean, status: number, final: any | null }>}
 */
export async function streamMessage({ sessionId, message, onEvent, signal }) {
  const res = await fetch(`${API}/api/sessions/${sessionId}/message/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
    signal,
  });

  // Server tells us to fall back (e.g. prod Lambda mode)
  if (res.status === 501) {
    return { ok: false, status: 501, final: null };
  }

  if (!res.ok || !res.body) {
    return { ok: false, status: res.status, final: null };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let final = null;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let frameEnd;
      while ((frameEnd = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, frameEnd);
        buffer = buffer.slice(frameEnd + 2);
        if (!frame.trim()) continue;
        const { event, data } = parseSseFrame(frame);
        onEvent(event, data);
        if (event === "done" || event === "error") {
          final = data;
        }
      }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }

  return { ok: true, status: 200, final };
}
