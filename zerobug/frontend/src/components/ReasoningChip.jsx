import { useEffect, useRef, useState } from "react";

// Cursor-style "Thinking" chip. While the LLM is streaming reasoning the chip
// is expanded by default so the user sees the chain-of-thought grow in real
// time. After the turn finishes the chip collapses (user can re-expand at any
// time). Visually subordinate to the bot bubble — small, greyed, never the
// main attraction.

export default function ReasoningChip({ text, streaming, durationSec }) {
  const [expanded, setExpanded] = useState(streaming);
  const scrollRef = useRef(null);
  const userToggledRef = useRef(false);

  // Auto-collapse when streaming finishes — unless the user has manually
  // expanded/collapsed (we don't want to fight them).
  useEffect(() => {
    if (!userToggledRef.current) {
      setExpanded(streaming);
    }
  }, [streaming]);

  // Auto-scroll the reasoning content to the bottom as new chunks land, so
  // the latest thought is always in view.
  useEffect(() => {
    if (!streaming || !expanded || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [text, streaming, expanded]);

  function toggle() {
    userToggledRef.current = true;
    setExpanded((v) => !v);
  }

  const header = streaming
    ? "Thinking"
    : durationSec
      ? `Thought for ${durationSec}s`
      : "Thoughts";

  return (
    <div
      className={
        "rounded-lg border overflow-hidden transition-colors " +
        (streaming
          ? "border-brand-500/40 bg-brand-900/15"
          : "border-gray-700/60 bg-gray-900/40")
      }
    >
      <button
        onClick={toggle}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-brand-500/5 transition-colors"
      >
        {/* Sparkle icon — gently pulses while streaming so the user sees the
            chip is "live". Brand-tinted so the AI thinking moment shares a
            visual identity with other brand accents (file glyphs, generated-
            now chip, etc.). */}
        <svg
          className={
            "w-3.5 h-3.5 shrink-0 text-brand-300 " +
            (streaming ? "animate-pulse" : "")
          }
          fill="currentColor"
          viewBox="0 0 24 24"
        >
          <path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8L12 2zm6 10l.9 2.6L21.5 15.5l-2.6.9L18 19l-.9-2.6L14.5 15.5l2.6-.9L18 12zM6 14l.6 1.8L8.4 16.4l-1.8.6L6 18.8l-.6-1.8L3.6 16.4l1.8-.6L6 14z" />
        </svg>
        <span className={"text-xs font-medium " + (streaming ? "text-brand-200" : "text-gray-300")}>{header}</span>
        {streaming && (
          <span className="flex items-center gap-0.5 ml-0.5">
            <span className="w-1 h-1 rounded-full bg-brand-300 animate-bounce [animation-delay:0ms]" />
            <span className="w-1 h-1 rounded-full bg-brand-300 animate-bounce [animation-delay:150ms]" />
            <span className="w-1 h-1 rounded-full bg-brand-300 animate-bounce [animation-delay:300ms]" />
          </span>
        )}
        <svg
          className={`w-3 h-3 ml-auto text-gray-500 transition-transform ${expanded ? "rotate-90" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>

      {expanded && (
        <div
          ref={scrollRef}
          className="px-3 pb-2.5 pt-1 text-xs text-gray-300 leading-relaxed max-h-64 overflow-y-auto whitespace-pre-wrap font-mono border-t border-gray-700/40"
        >
          {text || (streaming ? <span className="text-gray-500 italic">Thinking…</span> : <span className="text-gray-500 italic">No reasoning available.</span>)}
        </div>
      )}
    </div>
  );
}
