import { useState } from "react";
import { Highlight, themes } from "prism-react-renderer";

// Tool-agnostic on-fly agent code preview. Renders each Python block Claude
// generated and ran during the turn as a collapsed chip; expand to see the
// code, the one-line result summary, and a "Comment on this" affordance that
// puts a quoted reference into the chat input so the user's next message has
// context without leaving the conversation.

function StatusDot({ status }) {
  const cls =
    status === "error" ? "bg-red-400"
    : status === "running" ? "bg-brand-300 animate-pulse"
    : "bg-green-400";
  return <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cls}`} />;
}

function CodeView({ code, language = "python" }) {
  return (
    <Highlight code={code} language={language} theme={themes.vsDark}>
      {({ className, style, tokens, getLineProps, getTokenProps }) => (
        <pre
          className={`${className} text-xs leading-relaxed overflow-x-auto rounded-lg px-3 py-2.5 max-h-72 overflow-y-auto border border-gray-800`}
          style={{ ...style, background: "#0b1020" }}
        >
          {tokens.map((line, i) => (
            <div key={i} {...getLineProps({ line })}>
              <span className="select-none text-gray-600 pr-3 inline-block w-6 text-right">
                {i + 1}
              </span>
              {line.map((token, key) => (
                <span key={key} {...getTokenProps({ token })} />
              ))}
            </div>
          ))}
        </pre>
      )}
    </Highlight>
  );
}

function AgentCodeBlock({ block, onComment }) {
  const [expanded, setExpanded] = useState(false);
  const lineCount = (block.code || "").split("\n").length;
  const purpose = block.purpose || "Running code";
  const status = block.status || "done";

  const statusLabel =
    status === "error" ? "failed"
    : status === "running" ? "running"
    : "done";

  return (
    <div className="rounded-xl border border-brand-500/40 bg-brand-500/[0.07] overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-brand-500/10 transition-colors"
      >
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-brand-200 uppercase tracking-wider shrink-0">
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8L12 2z" />
          </svg>
          Generated&nbsp;now
        </span>
        <StatusDot status={status} />
        <span className="text-sm text-gray-100 truncate flex-1">{purpose}</span>
        <span className="text-[10px] text-gray-500 shrink-0">
          {block.language || "python"} · {lineCount} {lineCount === 1 ? "line" : "lines"} · {statusLabel}
        </span>
        <svg
          className={`w-3.5 h-3.5 text-gray-500 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>

      {expanded && (
        <div className="px-3 pb-3 pt-1 space-y-2 border-t border-brand-500/25">
          <CodeView code={block.code || ""} language={block.language || "python"} />

          {block.result_summary && (
            <div className="flex items-start gap-2 text-xs text-gray-300 pt-1">
              <span className="text-brand-300 font-semibold uppercase tracking-wider text-[10px] mt-0.5 shrink-0">
                Result
              </span>
              <span className="leading-snug">{block.result_summary}</span>
            </div>
          )}

          <button
            onClick={() => onComment?.(block)}
            className="flex items-center gap-1.5 text-xs text-brand-300 hover:text-brand-200 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            Comment on this code
          </button>
        </div>
      )}
    </div>
  );
}

export default function AgentCodeBlocks({ blocks, onComment }) {
  if (!Array.isArray(blocks) || blocks.length === 0) return null;
  return (
    <div className="mt-3 space-y-2">
      {blocks.map((block) => (
        <AgentCodeBlock key={block.id} block={block} onComment={onComment} />
      ))}
    </div>
  );
}
