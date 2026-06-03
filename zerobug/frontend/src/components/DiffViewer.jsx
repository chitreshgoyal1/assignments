import { Suspense, lazy, useState } from "react";

// Monaco is heavy (~3 MB incl. workers) so we lazy-load. We also call
// setupMonaco() to register the locally-bundled monaco-editor package
// instead of the default @monaco-editor/react CDN loader — keeps the demo
// fully self-hosted and offline-safe. Workers ship as separate chunks via
// Vite's ?worker imports; nothing of this lands in the main bundle until
// the user opens a DiffViewer for the first time.
const MonacoDiffEditor = lazy(async () => {
  const [{ DiffEditor }, { default: setupMonaco }] = await Promise.all([
    import("@monaco-editor/react"),
    import("../lib/setupMonaco"),
  ]);
  setupMonaco();
  return { default: DiffEditor };
});

// Tool-agnostic. We don't bake in per-tool path conventions; just map
// common file extensions to monaco language ids. Anything unknown falls
// back to plaintext, which still gets clean +/- highlighting.
const LANGUAGE_BY_EXT = {
  ts: "typescript", tsx: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  py: "python", rb: "ruby", go: "go", rs: "rust",
  java: "java", kt: "kotlin", scala: "scala",
  cs: "csharp", c: "c", h: "c", cpp: "cpp", hpp: "cpp", cc: "cpp",
  php: "php", swift: "swift",
  html: "html", htm: "html",
  css: "css", scss: "scss", less: "less",
  json: "json", yaml: "yaml", yml: "yaml",
  toml: "ini", ini: "ini",
  md: "markdown", mdx: "markdown",
  sh: "shell", bash: "shell", zsh: "shell", fish: "shell",
  sql: "sql", xml: "xml", graphql: "graphql", gql: "graphql",
  dockerfile: "dockerfile",
  vue: "html", svelte: "html",
  tf: "hcl", hcl: "hcl",
};

function detectLanguage(path = "", explicit) {
  if (explicit) return explicit;
  const name = path.split("/").pop() || "";
  const lower = name.toLowerCase();
  if (lower === "dockerfile" || lower.startsWith("dockerfile.")) return "dockerfile";
  const ext = lower.includes(".") ? lower.split(".").pop() : "";
  return LANGUAGE_BY_EXT[ext] || "plaintext";
}

function fileChangeKind(file) {
  const beforeEmpty = !file.before || file.before.length === 0;
  const afterEmpty = !file.after || file.after.length === 0;
  if (beforeEmpty && !afterEmpty) return "new";
  if (!beforeEmpty && afterEmpty) return "deleted";
  return "modified";
}

const CHANGE_BADGE = {
  new:      "bg-green-500/20 text-green-300 border-green-500/30",
  deleted:  "bg-red-500/20 text-red-300 border-red-500/30",
  modified: "bg-amber-500/20 text-amber-300 border-amber-500/30",
};

function FileTab({ file, active, onClick }) {
  const kind = fileChangeKind(file);
  return (
    <button
      onClick={onClick}
      className={`group flex items-center gap-2 px-2.5 py-1.5 text-xs rounded-lg border transition-colors max-w-full ${
        active
          ? "bg-brand-500/20 text-white border-brand-500/50"
          : "bg-gray-900/40 text-gray-400 border-gray-800 hover:text-white hover:border-gray-600"
      }`}
      title={file.path}
    >
      <span className="font-mono truncate">{file.path}</span>
      <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider border ${CHANGE_BADGE[kind]}`}>
        {kind === "new" ? "new" : kind === "deleted" ? "deleted" : "edit"}
      </span>
    </button>
  );
}

function MonacoLoading() {
  return (
    <div className="h-full flex items-center justify-center gap-2 text-xs text-gray-500">
      <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
      Loading editor…
    </div>
  );
}

/**
 * In-chat side-by-side diff viewer. Renders one Monaco DiffEditor at a time
 * for the active file; switching files keeps the editor instance alive so
 * Monaco doesn't re-init.
 *
 * Tool-agnostic by design — accepts a generic `files: [{path, language?,
 * before, after}]` array. Whatever generates the diff (GitHub PR, GitLab
 * MR, Bitbucket, a local patch from a fix agent) just produces this shape.
 *
 * @param {object} props
 * @param {Array<{path: string, language?: string, before?: string, after?: string}>} props.files
 * @param {(file) => void} [props.onCommentOnFile] — called when the user
 *   clicks "Suggest a change" on the active file. Receives the file object
 *   so the parent can drop a quoted reference into the chat input.
 * @param {boolean} [props.defaultExpanded=true]
 */
export default function DiffViewer({ files, onCommentOnFile, defaultExpanded = true }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [activeIdx, setActiveIdx] = useState(0);
  const [layout, setLayout] = useState("side"); // "side" | "inline"

  if (!Array.isArray(files) || files.length === 0) return null;
  const safeIdx = Math.min(activeIdx, files.length - 1);
  const active = files[safeIdx];

  return (
    <div className="rounded-xl border border-brand-500/30 bg-brand-500/[0.04] overflow-hidden">
      {/* Collapsible header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-brand-500/10 transition-colors text-left"
      >
        <span className="text-xs font-semibold text-brand-200 uppercase tracking-wider shrink-0">
          Review&nbsp;changes
        </span>
        <span className="text-sm text-gray-100 flex-1 truncate">
          {files.length} file{files.length !== 1 ? "s" : ""} changed
        </span>
        <span className="text-[10px] text-gray-500 shrink-0">
          {files.filter((f) => fileChangeKind(f) === "new").length} new ·{" "}
          {files.filter((f) => fileChangeKind(f) === "modified").length} edited ·{" "}
          {files.filter((f) => fileChangeKind(f) === "deleted").length} deleted
        </span>
        <svg
          className={`w-3.5 h-3.5 text-gray-500 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>

      {expanded && (
        <div className="px-3 pb-3 pt-1 space-y-2 border-t border-brand-500/20">
          {/* File tabs */}
          <div className="flex gap-1.5 flex-wrap pt-1">
            {files.map((file, i) => (
              <FileTab
                key={file.path + i}
                file={file}
                active={i === safeIdx}
                onClick={() => setActiveIdx(i)}
              />
            ))}
          </div>

          {/* Layout toggle */}
          <div className="flex items-center justify-between text-[10px] text-gray-500">
            <span className="font-mono truncate">{active?.path}</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setLayout("side")}
                className={`px-2 py-0.5 rounded ${layout === "side" ? "bg-gray-700 text-gray-200" : "text-gray-500 hover:text-gray-300"}`}
              >
                Side&#8209;by&#8209;side
              </button>
              <button
                onClick={() => setLayout("inline")}
                className={`px-2 py-0.5 rounded ${layout === "inline" ? "bg-gray-700 text-gray-200" : "text-gray-500 hover:text-gray-300"}`}
              >
                Inline
              </button>
            </div>
          </div>

          {/* Monaco diff */}
          <div className="rounded-lg overflow-hidden border border-gray-800" style={{ height: 380 }}>
            <Suspense fallback={<MonacoLoading />}>
              <MonacoDiffEditor
                key={active.path}
                original={active.before || ""}
                modified={active.after || ""}
                language={detectLanguage(active.path, active.language)}
                theme="vs-dark"
                options={{
                  readOnly: true,
                  renderSideBySide: layout === "side",
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  fontSize: 12,
                  lineNumbers: "on",
                  folding: true,
                  renderWhitespace: "selection",
                  diffWordWrap: "on",
                  ignoreTrimWhitespace: false,
                }}
              />
            </Suspense>
          </div>

          {/* Per-file comment affordance */}
          <div className="flex items-center justify-between pt-1">
            <button
              onClick={() => onCommentOnFile?.(active)}
              className="flex items-center gap-1.5 text-xs text-brand-300 hover:text-brand-200 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              Suggest a change in this file
            </button>
            <span className="text-[10px] text-gray-600">read-only preview</span>
          </div>
        </div>
      )}
    </div>
  );
}
