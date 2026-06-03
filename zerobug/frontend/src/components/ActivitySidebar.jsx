import { useEffect, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";

// Panel width is user-resizable via the drag handle on the left edge.
// Persisted to localStorage so it survives reloads.
const WIDTH_KEY = "zerobug.activity.width";
const MIN_WIDTH = 260;
const MAX_WIDTH = 720;
const DEFAULT_WIDTH = 360;

function readStoredWidth() {
  if (typeof window === "undefined") return DEFAULT_WIDTH;
  const raw = Number.parseInt(window.localStorage.getItem(WIDTH_KEY) || "", 10);
  if (!Number.isFinite(raw)) return DEFAULT_WIDTH;
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, raw));
}

// ── Icon ──────────────────────────────────────────────────────────────────────

const ICON_MAP = {
  // AI thinking & code-generation events share the brand-purple identity
  // used elsewhere (reasoning chip, "Generated now" agent code chip,
  // header logo). Vendor-specific icons keep their natural brand colours
  // (orange for GitLab, blue for Jira, etc.) — we only re-tint the
  // ZeroBug-native events.
  thinking: { bg: "bg-brand-900/50 border-brand-700/50",   text: "AI",  color: "text-brand-200"  },
  github:   { bg: "bg-gray-700/50 border-gray-600/50",     text: "G",   color: "text-gray-300"   },
  gitlab:   { bg: "bg-orange-900/50 border-orange-700/50", text: "GL",  color: "text-orange-300" },
  jira:     { bg: "bg-blue-900/50 border-blue-700/50",     text: "J",   color: "text-blue-300"   },
  pr:       { bg: "bg-brand-900/50 border-brand-700/50",   text: "PR",  color: "text-brand-200"  },
  // Merging a PR is a distinct, more consequential step than opening one —
  // we surface it with its own badge so the timeline reads naturally:
  // "Opening pull request" (PR) → "Merging PR" (M) → "Deploying" (D).
  merge:    { bg: "bg-brand-900/50 border-brand-700/50",   text: "M",   color: "text-brand-200"  },
  deploy:   { bg: "bg-green-900/50 border-green-700/50",   text: "D",   color: "text-green-300"  },
  code:     { bg: "bg-brand-900/40 border-brand-700/40",   text: ">_",  color: "text-brand-200"  },
  pending:  { bg: "bg-amber-900/50 border-amber-700/50",   text: "…",   color: "text-amber-300"  },
  done:     { bg: "bg-green-900/50 border-green-700/50",   text: "✓",   color: "text-green-300"  },
};

function IconBadge({ icon, status }) {
  const base = "w-7 h-7 rounded-full flex items-center justify-center shrink-0 border";

  if (status === "in_progress") {
    return (
      <div className={`${base} bg-brand-900/50 border-brand-700/50`}>
        <svg className="w-3.5 h-3.5 text-brand-300 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className={`${base} bg-red-900/50 border-red-700/50`}>
        <svg className="w-3.5 h-3.5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </div>
    );
  }
  if (status === "pending") {
    return (
      <div className={`${base} bg-amber-900/50 border-amber-700/50`}>
        <svg className="w-3.5 h-3.5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
    );
  }

  const s = ICON_MAP[icon] || ICON_MAP.code;
  return (
    <div className={`${base} ${s.bg}`}>
      <span className={`font-bold ${s.color}`} style={{ fontSize: "9px" }}>{s.text}</span>
    </div>
  );
}

// ── Timeline item ─────────────────────────────────────────────────────────────

function TimelineItem({ event, isLast }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetail = !!event.detail;

  const labelColor =
    event.status === "error"       ? "text-red-300" :
    event.status === "in_progress" ? "text-brand-200" :
    event.status === "pending"     ? "text-amber-300" :
                                     "text-gray-200";

  return (
    <div className="relative pl-10">
      {/* Vertical connector line — skip for last item */}
      {!isLast && <div className="absolute left-3.5 top-7 bottom-0 w-px bg-gray-700/60" />}

      {/* Icon */}
      <div className="absolute left-0 top-1">
        <IconBadge icon={event.icon} status={event.status} />
      </div>

      <div className="pb-4">
        <button
          onClick={() => hasDetail && setExpanded((v) => !v)}
          className={`flex items-start gap-2 w-full text-left group ${hasDetail ? "cursor-pointer" : "cursor-default"}`}
        >
          <div className="flex-1 min-w-0">
            <p className={`text-sm leading-snug ${labelColor}`}>
              {event.status === "done"        && <span className="text-green-400 mr-1.5">✓</span>}
              {event.status === "error"       && <span className="text-red-400 mr-1.5">✗</span>}
              {event.status === "in_progress" && <span className="text-brand-300 mr-1.5">⟳</span>}
              {event.label}
            </p>
            {event.ts && (
              <p className="text-[11px] text-gray-400 mt-0.5">
                {formatDistanceToNow(new Date(event.ts), { addSuffix: true })}
              </p>
            )}
          </div>
          {hasDetail && (
            <svg
              className={`w-3.5 h-3.5 text-gray-500 group-hover:text-gray-300 shrink-0 mt-0.5 transition-transform ${expanded ? "rotate-90" : ""}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          )}
        </button>

        {expanded && hasDetail && (
          // -ml-10 cancels the icon-column indent so the detail box spans the
          // full panel width — easier to read long stack traces and code
          // snippets than a narrow indented column.
          <div className="mt-2 -ml-10 rounded-lg bg-gray-950 border border-gray-700 overflow-hidden">
            <pre className="px-3 py-2 text-xs font-mono text-gray-300 overflow-x-auto max-h-60 overflow-y-auto whitespace-pre-wrap break-words">
              {event.detail}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ActivitySidebar({ events = [], fetching = false, open, onToggle }) {
  const [width, setWidth] = useState(readStoredWidth);
  const [resizing, setResizing] = useState(false);
  const dragStartRef = useRef({ x: 0, w: 0 });

  // Drag handle on the LEFT edge of the panel — dragging left = widen, right = narrow.
  // Listeners are attached to window for the duration of the drag so the
  // cursor doesn't snag when it briefly leaves the 4-px handle strip.
  useEffect(() => {
    if (!resizing) return;

    const onMove = (e) => {
      const dx = dragStartRef.current.x - e.clientX;
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragStartRef.current.w + dx));
      setWidth(next);
    };
    const onUp = () => {
      setResizing(false);
      try { window.localStorage.setItem(WIDTH_KEY, String(width)); } catch {}
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [resizing, width]);

  const startDrag = (e) => {
    dragStartRef.current = { x: e.clientX, w: width };
    setResizing(true);
    e.preventDefault();
  };

  const onDoubleClickHandle = () => {
    setWidth(DEFAULT_WIDTH);
    try { window.localStorage.setItem(WIDTH_KEY, String(DEFAULT_WIDTH)); } catch {}
  };

  if (!open) return null;

  const hasInProgress = events.some((e) => e.status === "in_progress");

  return (
    <aside
      style={{ width: `${width}px` }}
      className="relative shrink-0 flex flex-col border-l border-surface-border bg-surface-sidebar overflow-hidden"
    >
      {/* Resize handle — 4-px hit zone on the left edge with a 1-px visible line.
          Doubles in opacity on hover and turns brand-coloured while dragging.
          Double-click resets the panel to the default width. */}
      <div
        onMouseDown={startDrag}
        onDoubleClick={onDoubleClickHandle}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize activity panel"
        title="Drag to resize • double-click to reset"
        className={
          "absolute left-0 top-0 bottom-0 w-1 cursor-col-resize z-10 group " +
          (resizing ? "bg-brand-500/60" : "hover:bg-brand-500/40")
        }
      >
        <div
          className={
            "absolute inset-y-0 left-0 w-px " +
            (resizing ? "bg-brand-400" : "bg-transparent group-hover:bg-brand-400/60")
          }
        />
      </div>

      {/* Header — pulse icon matches the main header's Activity button, so
          the same visual identity is used wherever activity is referenced. */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-surface-border h-14">
        <div className="flex items-center gap-2 min-w-0">
          <svg className="w-4 h-4 text-brand-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M3 12h3l2-6 4 12 3-8 2 4h4" />
          </svg>
          <span className="text-sm font-semibold text-white">Activity</span>
          {events.length > 0 && (
            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full bg-surface-input text-[10px] font-semibold text-gray-300">
              {events.length}
            </span>
          )}
          {hasInProgress && (
            <span className="relative flex items-center justify-center ml-0.5">
              <span className="absolute w-2 h-2 rounded-full bg-brand-300/40 animate-ping" />
              <span className="relative w-1.5 h-1.5 rounded-full bg-brand-300" />
            </span>
          )}
        </div>
        <button
          onClick={onToggle}
          title="Hide activity panel"
          aria-label="Hide activity panel"
          className="shrink-0 w-7 h-7 inline-flex items-center justify-center rounded-md text-gray-400 hover:text-white hover:bg-surface-input transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto px-3 py-4">
        {fetching && events.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-8">Loading…</p>
        )}
        {!fetching && events.length === 0 && (
          <div className="text-center py-8 space-y-1">
            <p className="text-xs text-gray-300">No activity yet.</p>
            <p className="text-xs text-gray-500">Steps ZeroBug takes will appear here.</p>
          </div>
        )}
        {events.map((ev, i) => (
          <TimelineItem key={ev.id} event={ev} isLast={i === events.length - 1} />
        ))}
      </div>
    </aside>
  );
}
