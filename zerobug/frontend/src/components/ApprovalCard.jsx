import { useState, useEffect } from "react";
import DiffViewer from "./DiffViewer";

const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

// ── Helpers ───────────────────────────────────────────────────────────────────

const SEVERITY_STYLES = {
  critical: "bg-red-900/50 text-red-300 border border-red-700/50",
  high:     "bg-orange-900/50 text-orange-300 border border-orange-700/50",
  medium:   "bg-yellow-900/50 text-yellow-300 border border-yellow-700/50",
  low:      "bg-gray-700/50 text-gray-300 border border-gray-600/50",
};

function severityStyle(sev) {
  return SEVERITY_STYLES[(sev || "").toLowerCase()] || SEVERITY_STYLES.low;
}

function DiffPreview({ diff }) {
  const [expanded, setExpanded] = useState(false);
  if (!diff) return null;
  const lines = diff.split("\n");
  const preview = lines.slice(0, 20);
  const hasMore = lines.length > 20;

  function lineColor(line) {
    if (line.startsWith("+")) return "text-green-400";
    if (line.startsWith("-")) return "text-red-400";
    if (line.startsWith("@@")) return "text-blue-400";
    return "text-gray-400";
  }

  const shown = expanded ? lines : preview;

  return (
    <div className="mt-2 rounded-lg bg-gray-950 border border-gray-700 overflow-hidden">
      <div className="px-3 py-1.5 border-b border-gray-700 flex items-center justify-between">
        <span className="text-xs text-gray-500 font-mono">diff</span>
        {hasMore && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-xs text-brand-500 hover:text-brand-400 transition-colors"
          >
            {expanded ? "Show less" : `Show full diff (${lines.length} lines)`}
          </button>
        )}
      </div>
      <pre className="px-3 py-2 text-xs font-mono overflow-x-auto max-h-64 overflow-y-auto">
        {shown.map((line, i) => (
          <div key={i} className={lineColor(line)}>
            {line || " "}
          </div>
        ))}
      </pre>
    </div>
  );
}

function FixItem({ item, mode, onApprove, onReject, onCommentOnFile, isActive }) {
  const [open, setOpen] = useState(isActive);

  useEffect(() => {
    if (isActive) setOpen(true);
  }, [isActive]);

  return (
    <div className={`rounded-xl border transition-colors ${
      open ? "border-gray-600 bg-gray-800/60" : "border-gray-700 bg-gray-800/30"
    }`}>
      {/* Summary row — always visible */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
      >
        <svg
          className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="flex-1 text-sm font-medium text-white truncate">
          {item.title || "Untitled fix"}
        </span>
        {item.severity && (
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${severityStyle(item.severity)}`}>
            {item.severity}
          </span>
        )}
      </button>

      {/* Expanded body */}
      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-gray-700/50 pt-3">
          {/* Ticket + test env links */}
          <div className="flex flex-wrap gap-2">
            {item.ticket_id && (
              <a
                href={item.jira_url || "#"}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg bg-blue-900/40 text-blue-300 border border-blue-700/40 hover:bg-blue-900/60 transition-colors"
              >
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.248l-5.5 5.5a.75.75 0 01-1.062 0l-2.5-2.5a.75.75 0 011.06-1.06l1.97 1.97 4.97-4.97a.75.75 0 011.062 1.06z"/>
                </svg>
                {item.ticket_id}
              </a>
            )}
            {item.test_env_url && (
              <a
                href={item.test_env_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg bg-green-900/40 text-green-300 border border-green-700/40 hover:bg-green-900/60 transition-colors"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                Test environment
              </a>
            )}
            {item.pr_url && (
              <a
                href={item.pr_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg bg-brand-900/40 text-brand-200 border border-brand-700/40 hover:bg-brand-900/60 transition-colors"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                </svg>
                Pull request
              </a>
            )}
          </div>

          {/* Explanation */}
          {item.explanation && (
            <p className="text-sm text-gray-300 leading-relaxed">{item.explanation}</p>
          )}

          {/* Diff — prefer the rich Monaco viewer when per-file before/after
              content is available; fall back to the unified-diff text
              renderer for backwards compatibility with older payloads. */}
          {Array.isArray(item.files) && item.files.length > 0 ? (
            <DiffViewer
              files={item.files}
              onCommentOnFile={(file) => onCommentOnFile?.(item, file)}
            />
          ) : (
            <DiffPreview diff={item.diff} />
          )}

          {/* Per-item approve/reject in individual review mode */}
          {mode === "individual" && (
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => onApprove(item)}
                className="px-4 py-1.5 bg-green-600 hover:bg-green-500 rounded-lg text-xs font-semibold transition-colors"
              >
                Approve this fix
              </button>
              <button
                onClick={() => onReject(item)}
                className="px-4 py-1.5 bg-red-700 hover:bg-red-600 rounded-lg text-xs font-semibold transition-colors"
              >
                Reject
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ApprovalCard({ sessionId, approvalItems = [], onApproved, onFeedback, onCommentOnFile }) {
  const [mode, setMode] = useState("all");        // "all" | "individual" | "feedback"
  const [activeIdx, setActiveIdx] = useState(0);
  const [feedback, setFeedback] = useState("");
  // "idle" | "merging" | "error". We deliberately drop the old "polling" /
  // "done" states — clicking Approve only authorises the *merge*. Whether
  // anything gets deployed afterwards is a separate decision the bot
  // explicitly asks about (system_prompt steps 10–12), so we hand the
  // bot's reply back to the chat instead of overlaying a "Deploying…"
  // splash that hides the ask.
  const [state, setState] = useState("idle");
  const [errorMsg, setErrorMsg] = useState("");

  // ── Approve all ────────────────────────────────────────────────────────────
  async function approveAll() {
    setState("merging");
    try {
      const res = await fetch(`${API}/api/sessions/${sessionId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved: true }),
      });
      if (!res.ok) {
        throw new Error((await res.json().catch(() => ({}))).detail || "Approval failed");
      }
      const data = await res.json();
      // Hand the runtime's reply back to the chat. The bot will typically
      // be asking "Want me to deploy now? What target?" at this point —
      // we want that question rendered as a normal bot bubble, not buried
      // under a "Deploying…" overlay.
      onApproved?.(data);
    } catch (e) {
      setErrorMsg(e.message);
      setState("error");
    }
  }

  // ── Individual approve ─────────────────────────────────────────────────────
  function handleIndividualApprove(item) {
    if (activeIdx < approvalItems.length - 1) {
      setActiveIdx((i) => i + 1);
    } else {
      approveAll();
    }
  }

  function handleIndividualReject(item) {
    const msg = `Please revise the fix for "${item.title || item.ticket_id || "this item"}". It was not approved.`;
    onFeedback?.(msg);
  }

  // ── Send feedback ──────────────────────────────────────────────────────────
  function sendFeedback() {
    if (!feedback.trim()) return;
    onFeedback?.(feedback.trim());
  }

  // ── Merging state ──────────────────────────────────────────────────────────
  // Approval only authorises the merge step. The progress copy explicitly
  // calls out merge (not deploy) so the user knows what's happening, and
  // hints that the next question — deployment — will come up afterwards in
  // chat. No polling: once the API returns, we hand the bot's reply back to
  // Chat.jsx and unmount.
  if (state === "merging") {
    return (
      <div className="rounded-xl border border-gray-700 bg-gray-800/60 p-5 space-y-3">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-brand-400 animate-pulse" />
          <span className="text-sm font-semibold text-white">Merging PRs…</span>
        </div>
        <p className="text-xs text-gray-400">
          Merging the pull requests and closing the linked tickets. ZeroBug will
          ask about deployment next.
        </p>
        <div className="h-1.5 w-full bg-gray-700 rounded-full overflow-hidden">
          <div className="h-full bg-brand-500 rounded-full animate-pulse w-2/3" />
        </div>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="rounded-xl border border-red-700/50 bg-red-900/20 p-4 text-sm text-red-300">
        Merge failed: {errorMsg}
      </div>
    );
  }

  // ── Feedback input ─────────────────────────────────────────────────────────
  if (mode === "feedback") {
    return (
      <div className="rounded-xl border border-gray-700 bg-gray-800/60 p-4 space-y-3">
        <p className="text-sm font-semibold text-white">What needs to change?</p>
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="Describe what you'd like revised..."
          rows={3}
          className="w-full bg-gray-900 text-white text-sm rounded-xl px-3 py-2 border border-gray-700 focus:outline-none focus:border-brand-500 resize-none"
        />
        <div className="flex gap-2">
          <button
            onClick={sendFeedback}
            disabled={!feedback.trim()}
            className="px-4 py-1.5 bg-brand-500 hover:bg-brand-600 disabled:opacity-40 rounded-lg text-xs font-semibold transition-colors"
          >
            Send feedback
          </button>
          <button
            onClick={() => setMode("all")}
            className="px-4 py-1.5 text-gray-400 hover:text-white rounded-lg text-xs transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // ── Main card ──────────────────────────────────────────────────────────────
  return (
    <div className="rounded-xl border border-amber-700/40 bg-amber-900/10 p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
        <div>
          <p className="text-sm font-semibold text-white">Ready for your review</p>
          <p className="text-xs text-gray-400">
            {approvalItems.length} {approvalItems.length === 1 ? "fix" : "fixes"} ready to deploy
          </p>
        </div>
      </div>

      {/* Fix items */}
      <div className="space-y-2">
        {approvalItems.map((item, i) => (
          <FixItem
            key={i}
            item={item}
            mode={mode}
            isActive={mode === "individual" && i === activeIdx}
            onApprove={handleIndividualApprove}
            onReject={handleIndividualReject}
            onCommentOnFile={onCommentOnFile}
          />
        ))}
      </div>

      {/* Actions — Approve only merges. Deployment is asked about separately
          (see system_prompt steps 10–12), so the CTA must not promise a deploy. */}
      {mode === "all" && (
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            onClick={approveAll}
            className="px-5 py-2 bg-green-600 hover:bg-green-500 rounded-xl text-sm font-semibold transition-colors"
          >
            Approve and merge
          </button>
          <button
            onClick={() => { setMode("individual"); setActiveIdx(0); }}
            className="px-5 py-2 border border-gray-600 hover:border-gray-400 rounded-xl text-sm font-semibold text-gray-300 hover:text-white transition-colors"
          >
            Review individually
          </button>
          <button
            onClick={() => setMode("feedback")}
            className="px-5 py-2 text-gray-400 hover:text-white rounded-xl text-sm font-semibold transition-colors"
          >
            Request changes
          </button>
        </div>
      )}

      {mode === "individual" && (
        <p className="text-xs text-gray-500">
          Reviewing {activeIdx + 1} of {approvalItems.length} — approve or reject each fix individually
        </p>
      )}
    </div>
  );
}
