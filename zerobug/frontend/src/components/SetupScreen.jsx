import { useState } from "react";

const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

const TOOLS = [
  {
    id: "github",
    label: "GitHub",
    icon: "G",
    iconBg: "bg-gray-700 border-gray-600",
    iconColor: "text-gray-200",
    fields: [
      { key: "GITHUB_PAT",  label: "Personal Access Token", type: "password", placeholder: "ghp_…", hint: "Needs repo scope" },
      { key: "GITHUB_REPO", label: "Repository URL",        type: "text",     placeholder: "https://github.com/org/repo" },
    ],
  },
  {
    id: "jira",
    label: "Jira",
    icon: "J",
    iconBg: "bg-blue-900/60 border-blue-700/60",
    iconColor: "text-blue-300",
    fields: [
      { key: "JIRA_URL",   label: "Jira URL",       type: "text",     placeholder: "https://your-org.atlassian.net" },
      { key: "JIRA_EMAIL", label: "Account email",  type: "text",     placeholder: "you@example.com" },
      { key: "JIRA_TOKEN", label: "API token",      type: "password", placeholder: "Paste API token", hint: "Create at id.atlassian.com/manage-profile/security/api-tokens" },
    ],
  },
  {
    id: "gitlab",
    label: "GitLab",
    icon: "GL",
    iconBg: "bg-orange-900/60 border-orange-700/60",
    iconColor: "text-orange-300",
    fields: [
      { key: "GITLAB_URL",   label: "GitLab URL",          type: "text",     placeholder: "https://gitlab.com" },
      { key: "GITLAB_TOKEN", label: "Personal Access Token", type: "password", placeholder: "glpat-…", hint: "Needs api scope" },
    ],
  },
];

function ToolCard({ tool, sessionId, onSaved }) {
  const [expanded, setExpanded] = useState(false);
  const [values, setValues]     = useState(() => Object.fromEntries(tool.fields.map((f) => [f.key, ""])));
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);
  const [error, setError]       = useState("");

  async function save() {
    const filled = tool.fields.filter((f) => values[f.key].trim());
    if (!filled.length) return;
    setSaving(true);
    setError("");
    try {
      for (const f of filled) {
        const res = await fetch(`${API}/api/sessions/${sessionId}/credentials`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: f.key, value: values[f.key].trim() }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || "Failed to save");
        }
      }
      setSaved(true);
      onSaved(tool.id, filled.map((f) => f.key));
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`rounded-xl border transition-colors ${
      saved
        ? "border-green-700/50 bg-green-900/10"
        : expanded
        ? "border-surface-border bg-surface-card"
        : "border-surface-border bg-surface-card hover:border-gray-500"
    }`}>
      <button
        onClick={() => !saved && setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
      >
        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border ${tool.iconBg} ${tool.iconColor} shrink-0`}>
          {tool.icon}
        </div>
        <span className="flex-1 text-sm font-medium text-white">{tool.label}</span>
        {saved ? (
          <span className="flex items-center gap-1.5 text-xs text-green-400">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Connected
          </span>
        ) : (
          <svg
            className={`w-4 h-4 text-gray-500 transition-transform ${expanded ? "rotate-90" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        )}
      </button>

      {expanded && !saved && (
        <div className="px-4 pb-4 space-y-3 border-t border-surface-border pt-3">
          {tool.fields.map((f) => (
            <div key={f.key} className="space-y-1">
              <label className="text-xs text-gray-400">{f.label}</label>
              <input
                type={f.type}
                value={values[f.key]}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                className="w-full bg-surface-input text-white text-xs rounded-lg px-3 py-2 border border-surface-border focus:outline-none focus:border-brand-500 placeholder-gray-600"
              />
              {f.hint && <p className="text-xs text-gray-600">{f.hint}</p>}
            </div>
          ))}
          {error && <p className="text-xs text-red-400">{error}</p>}
          <button
            onClick={save}
            disabled={saving || !tool.fields.some((f) => values[f.key].trim())}
            className="w-full py-2 bg-brand-500 hover:bg-brand-600 disabled:opacity-40 rounded-lg text-xs font-semibold transition-colors"
          >
            {saving ? "Saving…" : `Connect ${tool.label}`}
          </button>
        </div>
      )}
    </div>
  );
}

export default function SetupScreen({ sessionId, onComplete }) {
  const [savedTools, setSavedTools] = useState([]);

  function handleSaved(toolId) {
    setSavedTools((prev) => prev.includes(toolId) ? prev : [...prev, toolId]);
  }

  const hasAtLeastOne = savedTools.length > 0;

  return (
    <div className="flex flex-col items-center justify-center flex-1 px-6 py-10 overflow-y-auto">
      <div className="w-full max-w-md space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-xl bg-brand-500 flex items-center justify-center font-bold text-xl mx-auto">
            Z
          </div>
          <h2 className="text-lg font-semibold text-white">Connect your tools</h2>
          <p className="text-sm text-gray-400">
            ZeroBug needs access to your repositories and issue tracker to fix bugs.
            Credentials are encrypted and stored only for this session.
          </p>
        </div>

        {/* Tool cards */}
        <div className="space-y-3">
          {TOOLS.map((tool) => (
            <ToolCard
              key={tool.id}
              tool={tool}
              sessionId={sessionId}
              onSaved={handleSaved}
            />
          ))}
        </div>

        {/* Continue */}
        <div className="space-y-2">
          <button
            onClick={onComplete}
            disabled={!hasAtLeastOne}
            className="w-full py-3 bg-brand-500 hover:bg-brand-600 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-sm font-semibold transition-colors"
          >
            Continue to chat
          </button>
          {!hasAtLeastOne && (
            <p className="text-xs text-gray-500 text-center">
              Connect at least one tool to continue.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
