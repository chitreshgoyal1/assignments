import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { formatDistanceToNow } from "date-fns";
import ApprovalCard from "../components/ApprovalCard";
import ActivitySidebar from "../components/ActivitySidebar";
import AgentCodeBlocks from "../components/AgentCodeBlocks";
import ReasoningChip from "../components/ReasoningChip";
import useActivity from "../hooks/useActivity";
import { streamMessage } from "../lib/streamMessage";

const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

// ── Constants ─────────────────────────────────────────────────────────────────

const PROGRESS_MESSAGES = [
  "Connecting to your systems...",
  "Reading the codebase...",
  "Analysing the issues...",
  "Writing a fix...",
  "Verifying the patch...",
  "Opening a pull request...",
  "Running tests...",
  "Almost done...",
];

// We accept any `<SYSTEM>_<SUFFIX>` env-var name where the suffix looks like a
// credential or connection detail. Claude is prompted to literally name the
// env var (e.g. "I'll store it as `JENKINS_URL`") when it needs one. The
// suffix list intentionally avoids ambiguous tails like `_ID` or `_NAME` so
// casual ALL_CAPS mentions don't trigger the form.
//
// Tool-agnostic: works for GitHub, Jira, GitLab, Jenkins, Confluence, Datadog,
// PagerDuty, AWS, Slack, Linear, ServiceNow — anything that follows the
// `SYSTEM_SUFFIX` convention.
const CRED_SUFFIXES =
  "ACCESS_KEY|SECRET_KEY|API_KEY|APP_KEY|API_TOKEN|BASE_URL|API_BASE|PAT|TOKEN|KEY|SECRET|PASSWORD|PWD|URL|ENDPOINT|HOST|EMAIL|USERNAME|USER|REPO|REGION|BUCKET|ARN|WEBHOOK";
const ENV_VAR_REGEX = new RegExp(
  String.raw`\b([A-Z][A-Z0-9]{1,30}_(?:${CRED_SUFFIXES}))\b`,
  "g",
);

const NON_SECRET_SUFFIX =
  /_(URL|ENDPOINT|HOST|BASE_URL|API_BASE|REPO|EMAIL|USERNAME|USER|REGION|BUCKET|ARN)$/;

const RE_ASK_REGEX = /\b(didn'?t work|not working|isn'?t working|invalid|rejected|expired|failed|try again|recheck|wrong)\b/i;

// Vocabulary that signals "the bot is asking for a credential" even when it
// failed to name an env var literally. Tool-agnostic — no system names baked
// in, just credential-shaped words. Used as a safety net so the form still
// shows up when Claude is sloppy about naming `GITHUB_PAT` / `JIRA_TOKEN`/etc.
const CRED_ASK_REGEX =
  /\b(personal\s*access\s*token|api\s*key|api\s*token|access\s*key|private\s*key|bearer\s*token|webhook|oauth|credential|password|passwd|secret|\bPAT\b|\btoken\b)\b/i;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Pull literal env-var tokens out of the bot's reply. The active request is
 * the LAST one mentioned — that's the credential the bot is currently asking
 * for in messages like "I'll store it as `GITHUB_PAT`."
 *
 * When the bot fails to literally name an env var but its message is clearly
 * asking for a credential (token / API key / password / personal access / …),
 * fall back to a non-literal request with an empty key — the form still
 * appears, the user names the env var themselves. Tool-agnostic: vocabulary
 * only, no system names baked in.
 *
 * Returns null when no credential is being requested.
 */
// Small, opinionated list of system names we know how to compose an env-var
// name for in the fallback path. Keeping it short and lowercase makes the
// regex cheap; the user can always edit the suggested name before saving so
// false positives are harmless. Tool-agnostic by design — any system not in
// the list just gets an empty suggestion and the user types one themselves.
const KNOWN_SYSTEMS = [
  "github", "gitlab", "bitbucket",
  "jira", "linear", "asana", "trello", "monday", "notion", "confluence",
  "jenkins", "circleci", "travisci", "buildkite", "argo", "argocd", "spinnaker",
  "aws", "gcp", "azure", "digitalocean", "linode",
  "vercel", "netlify", "cloudflare",
  "slack", "pagerduty",
  "datadog", "sentry", "newrelic", "splunk", "grafana",
  "snowflake", "databricks", "stripe",
];

/**
 * Suggest an env-var name when the LLM forgot to name one but is clearly
 * asking for a credential. Stays vocabulary-based so it's not tied to any
 * specific tool — extracts the first known system mention and pairs it with
 * a suffix derived from what kind of credential is being asked.
 *
 * Returns "" when we can't infer a reasonable default; the user just types
 * one in (same fallback as before).
 */
function inferSuggestedKey(botText) {
  if (!botText) return "";
  let system = "";
  for (const sys of KNOWN_SYSTEMS) {
    if (new RegExp(`\\b${sys}\\b`, "i").test(botText)) {
      system = sys.toUpperCase();
      break;
    }
  }
  if (!system) return "";

  if (/personal access token|\bPAT\b/i.test(botText)) return `${system}_PAT`;
  if (/api key/i.test(botText))                       return `${system}_API_KEY`;
  if (/secret key/i.test(botText))                    return `${system}_SECRET_KEY`;
  if (/access key/i.test(botText))                    return `${system}_ACCESS_KEY`;
  if (/\bwebhook\b/i.test(botText))                   return `${system}_WEBHOOK`;
  if (/\bemail\b/i.test(botText))                     return `${system}_EMAIL`;
  if (/\busername\b/i.test(botText))                  return `${system}_USERNAME`;
  if (/\burl\b|endpoint|host\b/i.test(botText))       return `${system}_URL`;
  return `${system}_TOKEN`;
}

function inferCredentialRequest(botText) {
  if (!botText) return null;
  const matches = [...botText.matchAll(ENV_VAR_REGEX)].map((m) => m[1]);
  if (matches.length > 0) {
    return { key: matches[matches.length - 1], isLiteral: true, suggestedKey: "" };
  }
  if (CRED_ASK_REGEX.test(botText)) {
    // The LLM didn't name an env var. Don't give up — try to suggest one
    // from context so the user just confirms instead of typing it. Without
    // this the Save button stays disabled until they fill the key field,
    // which is non-obvious and the previously-reported "Save doesn't work"
    // symptom.
    return { key: "", isLiteral: false, suggestedKey: inferSuggestedKey(botText) };
  }
  return null;
}

/**
 * Did the bot just tell us a previously-stored credential failed? We use this
 * to force the form to re-appear so the user can replace the bad value.
 */
function isReAsk(botText, key) {
  if (!botText || !key) return false;
  if (!botText.toLowerCase().includes(key.toLowerCase())) return false;
  return RE_ASK_REGEX.test(botText);
}

/**
 * Best-effort pre-fill: if the user has already typed the value in plain chat
 * (a URL, an email, a repo path, an AWS region), surface it as the form's
 * initial value so the user only confirms instead of re-typing. Suffix-based
 * so it works for any tool — Jenkins, Confluence, Datadog, etc. — not just
 * GitHub/Jira/GitLab.
 *
 * Tokens, keys, secrets, and passwords are never pre-filled.
 */
function extractValueForKey(key, userText) {
  if (!userText || !key) return "";

  // Repo path: prefer hosted-VCS form (github.com/<owner>/<repo>, gitlab,
  // bitbucket) so we don't accidentally match generic "path/file.py" strings.
  if (/_REPO$/.test(key)) {
    const m = userText.match(
      /(?:github|gitlab|bitbucket)\.[\w.-]+\/([\w.-]+\/[\w.-]+?)(?:[/\s?#]|\.git\b|$)/i,
    );
    return m ? m[1].replace(/\.git$/i, "") : "";
  }

  // Any URL-shaped key (URL / ENDPOINT / HOST / BASE_URL / API_BASE / WEBHOOK).
  if (/_(URL|ENDPOINT|HOST|BASE_URL|API_BASE|WEBHOOK)$/.test(key)) {
    const m = userText.match(/https?:\/\/[^\s)]+/i);
    return m ? m[0].replace(/[.,;)\]]+$/, "") : "";
  }

  if (/_EMAIL$/.test(key)) {
    const m = userText.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    return m ? m[0] : "";
  }

  // AWS-style region (us-east-1, eu-west-2, ap-south-1).
  if (/_REGION$/.test(key)) {
    const m = userText.match(/\b([a-z]{2,3}-[a-z]+-\d+)\b/);
    return m ? m[1] : "";
  }

  // Username: only when the user message explicitly labels it.
  if (/_(USER|USERNAME)$/.test(key)) {
    const m = userText.match(/\b(?:user|username)\s*[:=]?\s*([\w.@+-]+)/i);
    return m ? m[1] : "";
  }

  // Tokens, keys, secrets, passwords — never auto-extract.
  return "";
}

function timestamp(iso) {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return "";
  }
}

function formatBytes(n) {
  if (!n && n !== 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// Per-extension icon picker. We don't render real file previews — just a
// 1–2 letter glyph that hints at the format. Tool-agnostic by design: anything
// we don't recognise falls back to a generic paperclip glyph.
function fileGlyph(file) {
  const name = (file?.name || "").toLowerCase();
  const ct = (file?.content_type || file?.type || "").toLowerCase();
  if (ct.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg|bmp)$/.test(name)) return "IMG";
  if (ct === "application/pdf" || name.endsWith(".pdf")) return "PDF";
  if (/\.(csv|xlsx?|tsv)$/.test(name)) return "XLS";
  if (/\.(zip|tar|gz|tgz|rar|7z)$/.test(name)) return "ZIP";
  if (/\.(json|ya?ml|toml|xml)$/.test(name)) return "CFG";
  if (/\.(md|markdown)$/.test(name)) return "MD";
  if (/\.(txt|log|out|err)$/.test(name)) return "TXT";
  if (/\.(py|js|jsx|ts|tsx|go|java|rb|rs|cpp|c|h|cs|kt|swift|sh)$/.test(name)) return "CODE";
  return "FILE";
}

// ── Sub-components ────────────────────────────────────────────────────────────

// Compact chip for an uploaded attachment shown above the composer and inside
// user bubbles. The X button calls onRemove if provided; otherwise the chip is
// read-only (e.g. inside a sent user message).
function FileChip({ file, onRemove, compact = false }) {
  return (
    <div
      className={
        "inline-flex items-center gap-2 rounded-lg border border-surface-border bg-surface-input " +
        (compact ? "px-2 py-1 text-[11px]" : "px-2.5 py-1.5 text-xs")
      }
    >
      <span className="text-[9px] font-semibold tracking-wide text-brand-300 bg-brand-900/40 rounded px-1.5 py-0.5 shrink-0">
        {fileGlyph(file)}
      </span>
      <span className="text-gray-100 max-w-[180px] truncate">{file.name}</span>
      {file.size != null && (
        <span className="text-gray-500 shrink-0">{formatBytes(file.size)}</span>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="text-gray-500 hover:text-red-400 transition-colors leading-none shrink-0"
          aria-label={`Remove ${file.name}`}
          title="Remove"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

function UploadingChip({ name }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-lg border border-surface-border bg-surface-input px-2.5 py-1.5 text-xs">
      <span className="w-3 h-3 rounded-full border-2 border-gray-500 border-t-brand-400 animate-spin shrink-0" />
      <span className="text-gray-400 max-w-[180px] truncate">Uploading {name}…</span>
    </div>
  );
}

// Tiny hover-only row of message-level actions (Copy, Quote). Designed to
// sit absolutely inside the top-right of a message bubble — invisible until
// the parent ".group" is hovered. Pro-chat pattern: no static clutter, full
// action affordance on demand.
function BubbleActions({ text, onQuote, tone = "dark", side = "right" }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text || "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1300);
    } catch {
      // clipboard blocked — silently no-op; not worth surfacing
    }
  };
  // Light tone is used on the brand-coloured user bubble where the dark chip
  // would be invisible. Dark tone is used on the surface-card bot bubble.
  // Backdrop-blur keeps chips legible even when they overlay bubble content
  // momentarily (e.g. between bubbles in tight threads).
  const chip =
    tone === "light"
      ? "bg-brand-700/80 backdrop-blur-sm border-white/20 text-white/95 hover:bg-brand-600 shadow-md"
      : "bg-surface-input/95 backdrop-blur-sm border-surface-border text-gray-200 hover:text-white hover:border-brand-400 shadow-md";
  // Anchor to the top-right (bot) or top-left (user) edge of the bubble and
  // hover *above* it. Negative top lifts the chip outside the bubble bounds
  // so short messages aren't padded out to reserve action space.
  const positionCls =
    side === "left"
      ? "-top-3.5 left-2"
      : "-top-3.5 right-2";
  return (
    <div className={`absolute ${positionCls} flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-150 pointer-events-none z-10`}>
      <button
        type="button"
        onClick={handleCopy}
        title="Copy message"
        aria-label="Copy message"
        className={`pointer-events-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-medium transition-colors ${chip}`}
      >
        {copied ? (
          <>
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
            Copied
          </>
        ) : (
          <>
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            Copy
          </>
        )}
      </button>
      {onQuote && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onQuote(); }}
          title="Quote this message in your reply"
          aria-label="Quote message"
          className={`pointer-events-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-medium transition-colors ${chip}`}
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M7 8h6m-6 4h4m5 4l-4-4h-3a3 3 0 01-3-3V7a3 3 0 013-3h6a3 3 0 013 3v9z" />
          </svg>
          Quote
        </button>
      )}
    </div>
  );
}

// Hover-revealed timestamp. Static timestamps on every line clutter long
// threads; revealing on hover keeps the bubble clean while still letting the
// user verify timing when they care.
function HoverTimestamp({ iso, tone = "dark" }) {
  if (!iso) return null;
  const tint = tone === "light" ? "text-white/70" : "text-gray-500";
  return (
    <p
      className={`text-[10px] mt-1 ${tint} opacity-0 group-hover:opacity-100 transition-opacity duration-150`}
      title={new Date(iso).toLocaleString()}
    >
      {timestamp(iso)}
    </p>
  );
}

// Empty-state starter prompts shown only when the conversation has not
// started yet (just the welcome bubble in the messages list). Tool-agnostic
// wording — none of these chips mention GitHub / Jira / Jenkins specifically
// so they work for any tool the user has, and they hint at the breadth of
// what ZeroBug can do without needing a marketing tour.
const STARTER_PROMPTS = [
  {
    label: "Triage bugs from a CSV or PDF I upload",
    prompt: "I'd like you to triage a bunch of bugs. I'll upload a CSV/PDF — group them by severity and recommend what to fix first.",
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
  {
    label: "Scan a repo for bugs and open PRs for the fixes",
    prompt: "Scan a code repository for bugs and open pull requests for each fix you find. Ask me for the connection details when you're ready.",
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
      </svg>
    ),
  },
  {
    label: "Show me critical issues from my tracker",
    prompt: "Connect to my issue tracker and show me only the critical / blocker issues that are still open.",
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    label: "Review my open PRs and tell me what's risky",
    prompt: "Look at my open pull requests and rank them by risk — diff size, files touched, missing tests, anything else you find concerning.",
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
      </svg>
    ),
  },
];

function WelcomeStarters({ onPick }) {
  // pl-11 aligns the strip with the bot bubble (w-8 avatar + gap-3 = 44 px).
  // The chip grid itself is capped at max-w-3xl so each chip stays a
  // comfortable reading width even when the surrounding column is wide
  // (max-w-screen-2xl). Otherwise each chip would stretch to ~700 px and
  // look mostly empty on big monitors.
  return (
    <div className="pl-11 mt-2 space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
        Try one of these
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-3xl">
        {STARTER_PROMPTS.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => onPick(s.prompt)}
            className="group flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-surface-border bg-surface-card/50 hover:border-brand-500/50 hover:bg-surface-card transition-colors text-left"
          >
            <span className="w-4 h-4 shrink-0 text-brand-300 group-hover:text-brand-200 transition-colors">
              {s.icon}
            </span>
            <span className="text-xs text-gray-300 group-hover:text-white leading-snug">
              {s.label}
            </span>
            <svg
              className="w-3 h-3 ml-auto shrink-0 text-gray-600 group-hover:text-brand-300 transition-colors"
              fill="none" viewBox="0 0 24 24" stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
}

// Generic kebab (⋯) menu for header overflow actions — Clear session,
// future Export, Settings, etc. Auto-closes on outside click and Escape so
// the user is never stuck in an open menu.
function KebabMenu({ items }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More actions"
        className={
          "shrink-0 w-9 h-9 inline-flex items-center justify-center rounded-lg border transition-colors " +
          (open
            ? "bg-surface-input border-gray-500 text-white"
            : "bg-transparent border-surface-border text-gray-400 hover:text-white hover:border-gray-500")
        }
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <circle cx="5"  cy="12" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="19" cy="12" r="1.6" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1.5 min-w-[180px] rounded-lg border border-surface-border bg-surface-card/95 backdrop-blur shadow-xl py-1 z-300"
        >
          {items.map((it, idx) =>
            it.divider ? (
              <div key={`d${idx}`} className="my-1 border-t border-surface-border" />
            ) : (
              <button
                key={it.label}
                type="button"
                role="menuitem"
                onClick={() => { setOpen(false); it.onClick?.(); }}
                className={
                  "w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors " +
                  (it.danger
                    ? "text-red-300 hover:bg-red-500/10"
                    : "text-gray-200 hover:bg-surface-input")
                }
              >
                {it.icon && (
                  <span className={"w-3.5 h-3.5 shrink-0 " + (it.danger ? "text-red-400" : "text-gray-400")}>
                    {it.icon}
                  </span>
                )}
                <span className="flex-1">{it.label}</span>
                {it.kbd && <kbd className="text-[10px] font-mono text-gray-500">{it.kbd}</kbd>}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}

// Compact session-id chip with click-to-copy. Sits in the header — exposes
// the session id (useful for support / log search) without the chunky
// "Session: b71791…" footer line we used before.
function SessionChip({ sessionId }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(sessionId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1300);
    } catch {
      // clipboard blocked — leave silent
    }
  };
  return (
    <button
      type="button"
      onClick={handleCopy}
      title={`Click to copy session id\n${sessionId}`}
      className="hidden md:inline-flex items-center gap-1.5 h-9 px-2.5 rounded-lg border border-surface-border bg-transparent text-[11px] font-mono text-gray-400 hover:text-white hover:border-gray-500 transition-colors"
    >
      {copied ? (
        <>
          <svg className="w-3 h-3 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
          <span>Copied</span>
        </>
      ) : (
        <>
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          <span className="truncate max-w-[80px]">{sessionId.slice(0, 8)}…</span>
        </>
      )}
    </button>
  );
}

function TypingIndicator() {
  return (
    <div className="flex gap-3 items-end">
      <Avatar />
      <div className="bg-gray-800 rounded-xl rounded-tl-sm px-4 py-3">
        <div className="flex gap-1 items-center h-4">
          <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:0ms]" />
          <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:150ms]" />
          <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:300ms]" />
        </div>
      </div>
    </div>
  );
}

function ActivityFeedItem({ event }) {
  const status = event.status || "in_progress";
  const isActive = status === "in_progress";
  const isError = status === "error";

  const indicator = isActive ? (
    <span className="inline-block w-3 text-brand-400">
      <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
    </span>
  ) : isError ? (
    <span className="inline-block w-3 text-red-400 text-center">✗</span>
  ) : (
    <span className="inline-block w-3 text-green-500/80 text-center">✓</span>
  );

  return (
    <div
      className={`flex gap-2 items-start ${
        isError ? "text-red-300" : isActive ? "text-brand-300" : "text-gray-500"
      }`}
    >
      <span className="shrink-0 mt-0.5">{indicator}</span>
      <span className={`leading-snug ${isActive ? "italic" : ""}`}>{event.label}</span>
    </div>
  );
}

function InlineActivityFeed({ events }) {
  // "thinking" events are already surfaced by the in-bubble ReasoningChip
  // (which shows the live extended-thinking stream). Repeating them here
  // produces a visual duplicate — see the user-reported "Thinking appeared
  // twice" bug. The full Activity sidebar still shows them for the canonical
  // timeline; the inline feed below the bubble only carries non-thinking
  // steps (Running code, Opening PR, etc.).
  const visible = events.filter((ev) => ev.icon !== "thinking");
  if (!visible.length) return null;
  return (
    <div className="pl-11 mt-1 space-y-1 text-xs font-mono">
      {visible.map((ev) => (
        <ActivityFeedItem key={ev.id} event={ev} />
      ))}
    </div>
  );
}

function ProgressBar({ visible }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => setIdx((i) => (i + 1) % PROGRESS_MESSAGES.length), 3000);
    return () => clearInterval(id);
  }, [visible]);
  if (!visible) return null;
  return (
    <div className="flex items-center gap-2 mt-2 text-xs text-brand-500">
      <span className="w-2 h-2 rounded-full bg-brand-500 animate-pulse shrink-0" />
      {PROGRESS_MESSAGES[idx]}
    </div>
  );
}

function Avatar() {
  return (
    <div className="w-8 h-8 rounded-full bg-gray-600 flex items-center justify-center text-[11px] font-bold text-white shrink-0 tracking-tight">
      ZB
    </div>
  );
}

function CredentialForm({ sessionId, credentialRequest, initialValue, onSaved }) {
  // In the literal-key case `credentialRequest.key` is set; in the fallback
  // case we fall back to the inferred suggestion (e.g. GITHUB_PAT) so the
  // Save button can immediately become active once the user pastes a value.
  // Previously the suggestion didn't exist and the fallback form started
  // with an empty key, leaving the button permanently disabled until the
  // user noticed the key field above — that's what the "Save doesn't work"
  // report was hitting.
  const [key, setKey] = useState(
    credentialRequest.key || credentialRequest.suggestedKey || "",
  );
  const [value, setValue] = useState(initialValue || "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const keyInputRef = useRef(null);
  const valueInputRef = useRef(null);

  const keyLocked = credentialRequest.isLiteral;

  // Auto-focus whichever field is empty so the user can type immediately.
  // Pre-filled key + empty value → focus value. Pre-filled both → focus
  // value (most common case is the user just confirming a pasted token).
  // Empty key → focus the key field so the user knows it needs filling.
  useEffect(() => {
    if (!key) keyInputRef.current?.focus();
    else valueInputRef.current?.focus();
    // Run once on mount — re-focusing on every keystroke would steal focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Non-secret keys (repo refs, URLs, hosts, emails, usernames, regions, ARNs,
  // buckets) are shown as text so the pre-filled value is visible and
  // confirmable. Tokens, keys, secrets, passwords stay masked. While the key
  // is empty (fallback path), default to masked.
  const isSecret = !key.trim() || !NON_SECRET_SUFFIX.test(key);

  const trimmedKey = key.trim();
  const trimmedValue = value.trim();
  const canSave = !!trimmedKey && !!trimmedValue && !saving;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`${API}/api/sessions/${sessionId}/credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: trimmedKey, value: trimmedValue }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to save");
      }
      setSaved(true);
      setTimeout(() => onSaved(trimmedKey), 600);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (saved) {
    return (
      <div className="mt-3 flex items-center gap-2 text-green-400 text-sm">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
        Saved securely
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-gray-700 bg-gray-900 p-3 space-y-2">
      <p className="text-xs text-gray-400">
        {keyLocked
          ? "Enter credential securely"
          : "ZeroBug didn't specify an env-var name — pick one"}
      </p>
      <div className="space-y-1">
        <input
          ref={keyInputRef}
          className={`w-full text-white text-xs rounded-lg px-3 py-1.5 border focus:outline-none ${
            keyLocked
              ? "bg-gray-800/60 border-gray-800 text-gray-300 cursor-not-allowed"
              : "bg-gray-800 border-gray-700 focus:border-brand-500"
          }`}
          value={key}
          onChange={(e) => setKey(e.target.value.toUpperCase())}
          placeholder="Key name (e.g. GITHUB_PAT, JIRA_TOKEN, JENKINS_URL)"
          readOnly={keyLocked}
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
        />
        <p className="text-[10px] text-gray-500 pl-1">
          {keyLocked
            ? "from ZeroBug's request"
            : credentialRequest.suggestedKey
              ? "suggested from the message — edit if you use a different name"
              : "format: SYSTEM_SUFFIX — TOKEN / PAT / API_KEY / URL / EMAIL / USERNAME / WEBHOOK / …"}
        </p>
      </div>
      <input
        ref={valueInputRef}
        type={isSecret ? "password" : "text"}
        className="w-full bg-gray-800 text-white text-xs rounded-lg px-3 py-1.5 border border-gray-700 focus:outline-none focus:border-brand-500"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={initialValue ? "Confirm or edit the value" : "Paste value here"}
        onKeyDown={(e) => e.key === "Enter" && handleSave()}
      />
      {initialValue && (
        <p className="text-[10px] text-gray-500 pl-1">pre-filled from your message</p>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
      <button
        onClick={handleSave}
        disabled={!canSave}
        className="w-full py-1.5 bg-brand-500 hover:bg-brand-600 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-xs font-semibold transition-colors"
      >
        {saving ? "Saving..." : "Save securely"}
      </button>
      {/* Explain why Save is dim, otherwise users click it, nothing happens,
          and it feels broken (this was the "Save button doesn't work" bug). */}
      {!canSave && !saving && (
        <p className="text-[10px] text-amber-400/80 pl-1">
          {!trimmedKey && !trimmedValue
            ? "Enter a key name and a value to enable Save."
            : !trimmedKey
              ? "Enter a key name to enable Save."
              : "Paste the value to enable Save."}
        </p>
      )}
    </div>
  );
}


function Message({ msg, sessionId, executing, onCredentialSaved, onApprovalResult, onCommentOnCode, onCommentOnFile, onQuote }) {
  const isUser = msg.role === "user";

  if (isUser) {
    // items-start (not items-end) matches the bot side — both avatars now
    // sit at the top of the bubble for a symmetric, modern chat layout.
    return (
      <div className="group flex gap-3 flex-row-reverse items-start">
        <div className="w-8 h-8 rounded-full bg-brand-500 flex items-center justify-center text-xs font-bold text-white shrink-0 ring-1 ring-brand-400/30">
          U
        </div>
        <div className="relative max-w-[75%] bg-brand-500 text-white rounded-xl rounded-tr-sm px-4 py-3 text-sm leading-relaxed shadow-sm">
          {/* Actions float at the top-LEFT corner of the user bubble so they
              don't collide with the U avatar on the right side. */}
          <BubbleActions text={msg.content || ""} tone="light" side="left" />
          {msg.content && <p className="whitespace-pre-wrap break-words">{msg.content}</p>}
          {msg.attachments?.length > 0 && (
            <div className={"flex flex-wrap gap-1.5 " + (msg.content ? "mt-2" : "")}>
              {msg.attachments.map((f) => (
                <FileChip key={f.id || f.name} file={f} compact />
              ))}
            </div>
          )}
          <HoverTimestamp iso={msg.ts} tone="light" />
        </div>
      </div>
    );
  }

  const hasReasoning = !!msg.reasoning || msg.streaming;
  const bubbleText = msg.content || "";

  return (
    <div className="group flex gap-3 items-start">
      <Avatar />
      {/* No flex-1 — let the bubble column shrink to content. Otherwise a
          short greeting like "What do you want to fix today?" stretches to
          75 % of the chat column and looks padded out. */}
      <div className="max-w-[75%] space-y-2 min-w-0">
        {hasReasoning && (
          <ReasoningChip
            text={msg.reasoning || ""}
            streaming={!!msg.streaming}
            durationSec={msg.reasoningDurationSec}
          />
        )}
        <div className="relative bg-surface-card text-gray-100 rounded-xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed shadow-sm border border-surface-border/40 hover:border-brand-500/30 transition-colors">
          {bubbleText && (
            <BubbleActions
              text={bubbleText}
              onQuote={onQuote ? () => onQuote(bubbleText) : null}
            />
          )}
          {msg.content
            ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
            : msg.streaming
              ? <span className="text-gray-400 italic text-xs">Composing reply…</span>
              : null}
          {msg.content && <HoverTimestamp iso={msg.ts} />}

          {msg.agentCodeBlocks?.length > 0 && (
            <AgentCodeBlocks
              blocks={msg.agentCodeBlocks}
              onComment={(block) => onCommentOnCode(block)}
            />
          )}

          {msg.credentialRequest && (
            <CredentialForm
              sessionId={sessionId}
              credentialRequest={msg.credentialRequest}
              initialValue={msg.prefillValue || ""}
              onSaved={(key) => onCredentialSaved(key)}
            />
          )}

          {msg.approvalItems?.length > 0 && (
            <div className="mt-3">
              <ApprovalCard
                sessionId={sessionId}
                approvalItems={msg.approvalItems}
                onApproved={onApprovalResult}
                onFeedback={(text) => onApprovalResult(text, true)}
                onCommentOnFile={onCommentOnFile}
              />
            </div>
          )}
        </div>
        <ProgressBar visible={executing && msg.isLatestBot} />
      </div>
    </div>
  );
}

// ── Main Chat component ───────────────────────────────────────────────────────

export default function Chat() {
  const [sessionId, setSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [initError, setInitError] = useState("");
  const [activityOpen, setActivityOpen] = useState(false);
  const [slowWarning, setSlowWarning] = useState(false);
  const [lastFailedMsg, setLastFailedMsg] = useState(null);
  const [storedKeys, setStoredKeys] = useState(() => new Set());
  const [autoAckedKeys, setAutoAckedKeys] = useState(() => new Set());
  // Attached files queued for the next send. Each item is the metadata the
  // backend returned: {id, name, size, content_type}. After Send these clear,
  // but the files remain accessible to the runtime via ZEROBUG_FILES.
  const [pendingFiles, setPendingFiles] = useState([]);
  const [uploadingNames, setUploadingNames] = useState([]);
  const [uploadError, setUploadError] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const slowTimerRef = useRef(null);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const dragCounterRef = useRef(0);
  const lastUserTextRef = useRef("");
  // Snapped when the user hits Send. Used to slice the activity feed down to
  // events that belong to the in-flight turn, so the inline chat feed reads
  // like a running commentary rather than the whole session history.
  const turnStartTimeRef = useRef(0);

  // SSE-pushed activity events for the current turn — merged with the polled
  // events from useActivity so the feed updates instantly instead of waiting
  // for the next 1s poll. Keyed by event id (same id the backend uses).
  const [liveActivityById, setLiveActivityById] = useState({});

  // Shared activity polling — sidebar still gets the full session history,
  // and SSE provides the live signal inline. Polling rate is irrelevant when
  // SSE is streaming, but it stays alive as a fallback.
  const { events: activityEvents, fetching: activityFetching } =
    useActivity(sessionId, loading);

  // Merge SSE live events with polled events, live wins on id collision.
  const mergedActivityEvents = useMemo(() => {
    const byId = {};
    for (const ev of activityEvents) byId[ev.id] = ev;
    for (const [id, ev] of Object.entries(liveActivityById)) byId[id] = ev;
    return Object.values(byId).sort(
      (a, b) => new Date(a.ts || 0).getTime() - new Date(b.ts || 0).getTime(),
    );
  }, [activityEvents, liveActivityById]);

  // Events that have arrived since the user's last Send. Small grace window
  // covers clock skew between the frontend and the runtime.
  const currentTurnEvents = mergedActivityEvents.filter(
    (ev) => new Date(ev.ts || 0).getTime() >= turnStartTimeRef.current - 500,
  );

  // True whenever there's a live in-progress event somewhere in the session.
  // Drives the brand-coloured pulse dot on the header Activity button so the
  // user notices work even when the sidebar is closed.
  const hasLiveActivity = mergedActivityEvents.some((ev) => ev.status === "in_progress");

  // ── Init session ────────────────────────────────────────────────────────────
  useEffect(() => {
    async function init() {
      try {
        const res = await fetch(`${API}/api/sessions`, { method: "POST" });
        if (!res.ok) throw new Error("Failed to create session");
        const data = await res.json();
        setSessionId(data.session_id);
        setMessages([
          {
            id: "welcome",
            role: "bot",
            content: "Hi, I'm ZeroBug. What do you want to fix today?",
            ts: new Date().toISOString(),
            isLatestBot: true,
          },
        ]);
      } catch (e) {
        setInitError("Could not connect to the API. Is it running?");
      }
    }
    init();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Auto-grow the composer textarea up to the CSS-defined max-height. We
  // reset to "auto" first so the element can shrink when lines are deleted,
  // then snap to scrollHeight (capped by max-height via overflow). Re-runs on
  // every keystroke since `input` is the dependency.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    const max = 200; // ~10 lines at 20px line-height
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  }, [input]);

  // ── Finalise a completed turn ──────────────────────────────────────────────
  // Used by both the streaming path and the sync fallback so we have one
  // place that handles credential inference + auto-ack + message assembly.
  const finaliseTurn = useCallback(
    ({ payload, reasoningText, reasoningDurationSec, streamingMsgId }) => {
      const reply = payload?.message || payload?.reply || "";
      const credentialRequest = inferCredentialRequest(reply);

      let attachedCredentialRequest = null;
      let prefillValue = "";
      let pendingAutoAckKey = null;

      if (credentialRequest) {
        const reAsk = isReAsk(reply, credentialRequest.key);
        const alreadyStored = storedKeys.has(credentialRequest.key);
        const alreadyAcked = autoAckedKeys.has(credentialRequest.key);

        if (alreadyStored && !reAsk && !alreadyAcked) {
          pendingAutoAckKey = credentialRequest.key;
        } else if (alreadyStored && !reAsk && alreadyAcked) {
          // Already acked once this session — don't loop.
        } else {
          attachedCredentialRequest = credentialRequest;
          prefillValue = extractValueForKey(credentialRequest.key, lastUserTextRef.current);
          if (reAsk) {
            setAutoAckedKeys((prev) => {
              if (!prev.has(credentialRequest.key)) return prev;
              const next = new Set(prev);
              next.delete(credentialRequest.key);
              return next;
            });
          }
        }
      }

      const finalFields = {
        content: reply,
        credentialRequest: attachedCredentialRequest,
        prefillValue,
        approvalItems: payload?.approval_items || [],
        agentCodeBlocks: payload?.agent_code_blocks || [],
        reasoning: reasoningText || null,
        reasoningDurationSec,
        streaming: false,
      };

      if (streamingMsgId != null) {
        setMessages((prev) =>
          prev.map((m) => (m.id === streamingMsgId ? { ...m, ...finalFields } : m)),
        );
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now() + 1,
            role: "bot",
            ts: new Date().toISOString(),
            isLatestBot: true,
            ...finalFields,
          },
        ]);
      }

      return pendingAutoAckKey;
    },
    [storedKeys, autoAckedKeys],
  );

  // ── File uploads ────────────────────────────────────────────────────────────
  // Tool-agnostic: accept anything (bug reports, screenshots, logs, CSVs,
  // source code). The backend persists bytes; the runtime exposes paths via
  // ZEROBUG_FILES and Claude reads them on the fly with whatever Python
  // library fits the format.
  const uploadFiles = useCallback(
    async (filesList) => {
      if (!sessionId) return;
      const fileArray = Array.from(filesList || []);
      if (fileArray.length === 0) return;

      const names = fileArray.map((f) => f.name);
      setUploadingNames((prev) => [...prev, ...names]);
      setUploadError("");

      try {
        const formData = new FormData();
        fileArray.forEach((f) => formData.append("files", f, f.name));

        const resp = await fetch(`${API}/api/sessions/${sessionId}/files`, {
          method: "POST",
          body: formData,
        });
        if (!resp.ok) {
          const body = await resp.json().catch(() => ({}));
          throw new Error(body.detail || `Upload failed (${resp.status})`);
        }
        const data = await resp.json();
        setPendingFiles((prev) => [...prev, ...(data.files || [])]);
      } catch (e) {
        setUploadError(e.message || "Upload failed");
      } finally {
        setUploadingNames((prev) => prev.filter((n) => !names.includes(n)));
      }
    },
    [sessionId],
  );

  const removeFile = useCallback(
    async (fileId) => {
      setPendingFiles((prev) => prev.filter((f) => f.id !== fileId));
      try {
        await fetch(`${API}/api/sessions/${sessionId}/files/${fileId}`, {
          method: "DELETE",
        });
      } catch {
        // best-effort — UI is the source of truth for the next send
      }
    },
    [sessionId],
  );

  const onPickFiles = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const onFileInputChange = useCallback(
    (e) => {
      uploadFiles(e.target.files);
      e.target.value = ""; // allow re-selecting the same file
    },
    [uploadFiles],
  );

  // Drag-drop on the chat surface. We use a counter so nested elements don't
  // cause spurious dragenter/dragleave toggles.
  const onDragEnter = useCallback(
    (e) => {
      if (!sessionId) return;
      if (!e.dataTransfer?.types?.includes("Files")) return;
      e.preventDefault();
      dragCounterRef.current += 1;
      setIsDragging(true);
    },
    [sessionId],
  );
  const onDragLeave = useCallback((e) => {
    e.preventDefault();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setIsDragging(false);
  }, []);
  const onDragOver = useCallback((e) => {
    if (!e.dataTransfer?.types?.includes("Files")) return;
    e.preventDefault(); // required to allow drop
  }, []);
  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      dragCounterRef.current = 0;
      setIsDragging(false);
      if (!sessionId) return;
      const files = e.dataTransfer?.files;
      if (files && files.length) uploadFiles(files);
    },
    [sessionId, uploadFiles],
  );

  // Paste an image from the clipboard (screenshots) directly into the chat.
  const onPaste = useCallback(
    (e) => {
      const items = e.clipboardData?.items;
      if (!items || !sessionId) return;
      const files = [];
      for (const item of items) {
        if (item.kind === "file") {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length) {
        e.preventDefault();
        uploadFiles(files);
      }
    },
    [sessionId, uploadFiles],
  );

  // ── Send message ────────────────────────────────────────────────────────────
  const sendMessage = useCallback(
    async (text) => {
      if ((!text.trim() && pendingFiles.length === 0) || loading || !sessionId) return;
      const attachments = pendingFiles.map((f) => ({
        id: f.id, name: f.name, size: f.size, content_type: f.content_type,
      }));
      const userMsg = {
        id: Date.now(),
        role: "user",
        content: text,
        attachments,
        ts: new Date().toISOString(),
      };
      lastUserTextRef.current = text;
      turnStartTimeRef.current = Date.now();
      setMessages((prev) => [
        ...prev.map((m) => ({ ...m, isLatestBot: false, approvalItems: [] })),
        userMsg,
      ]);
      setInput("");
      // Clear the composer chips so the next message starts clean. The files
      // themselves stay on the session — Claude can re-open them anytime via
      // ZEROBUG_FILES — so this is a visual reset only.
      setPendingFiles([]);
      setUploadError("");
      setLoading(true);
      setExecuting(false);
      setSlowWarning(false);
      setLastFailedMsg(null);
      setLiveActivityById({}); // reset live events for the new turn

      // Tell Claude which files belong to *this turn* so it knows what to
      // focus on (ZEROBUG_FILES carries all session uploads — sticky — but a
      // line in the prompt anchors attention to the freshly attached set).
      const effectiveText = attachments.length
        ? `${text}\n\n[Attached this turn: ${attachments.map((a) => a.name).join(", ")}]`
        : text;

      // Show "still working" warning after 30s
      slowTimerRef.current = setTimeout(() => setSlowWarning(true), 30000);

      // Insert a streaming placeholder bot bubble — it'll be filled by SSE
      // events as Claude thinks and runs code, then committed on `done`.
      const streamingMsgId = Date.now() + 1;
      const reasoningStartedAt = Date.now();
      setMessages((prev) => [
        ...prev,
        {
          id: streamingMsgId,
          role: "bot",
          content: "",
          ts: new Date().toISOString(),
          isLatestBot: true,
          streaming: true,
          reasoning: "",
          agentCodeBlocks: [],
        },
      ]);

      // Accumulators — refs so we don't depend on stale state inside the
      // SSE event handler closure.
      const reasoningRef = { current: "" };
      const agentBlocksRef = { current: [] };

      function handleEvent(kind, data) {
        if (!data) return;
        if (kind === "reasoning_delta") {
          reasoningRef.current += data.text || "";
          const snapshot = reasoningRef.current;
          setMessages((prev) =>
            prev.map((m) => (m.id === streamingMsgId ? { ...m, reasoning: snapshot } : m)),
          );
        } else if (kind === "text_delta") {
          // Visible reply text streams in — but raw text may contain XML tags
          // (<execute>, <ask>, …) that we strip server-side on `done`. To avoid
          // showing raw tags mid-stream we render the final reply on `done`.
        } else if (kind === "agent_code") {
          const block = data;
          // Upsert by id so re-emitted blocks update in place
          const existing = agentBlocksRef.current.filter((b) => b.id !== block.id);
          agentBlocksRef.current = [...existing, block];
          const snapshot = agentBlocksRef.current;
          setMessages((prev) =>
            prev.map((m) => (m.id === streamingMsgId ? { ...m, agentCodeBlocks: snapshot } : m)),
          );
        } else if (kind === "activity_start" || kind === "activity_done") {
          const ev = { ...data, ts: data.ts || new Date().toISOString() };
          setLiveActivityById((prev) => ({ ...prev, [ev.id]: ev }));
        }
      }

      let pendingAutoAckKey = null;
      let usedFallback = false;
      let succeeded = false;

      try {
        const result = await streamMessage({
          sessionId,
          message: effectiveText,
          onEvent: handleEvent,
        });

        if (result.ok && result.final) {
          const isError = !!result.final?.error || result.status >= 400;
          if (isError) {
            throw new Error(result.final?.message || "Stream failed");
          }
          const reasoningDurationSec = Math.max(
            1,
            Math.round((Date.now() - reasoningStartedAt) / 1000),
          );
          pendingAutoAckKey = finaliseTurn({
            payload: result.final,
            reasoningText: reasoningRef.current,
            reasoningDurationSec,
            streamingMsgId,
          });
          succeeded = true;
        } else if (result.status === 501) {
          // Prod Lambda mode — fall back to the synchronous endpoint.
          usedFallback = true;
        } else {
          throw new Error(`Stream HTTP ${result.status}`);
        }
      } catch (streamErr) {
        // Network blip or runtime error — try the non-streaming path so the
        // user still gets a reply.
        usedFallback = true;
        // eslint-disable-next-line no-console
        console.warn("[zerobug] stream failed, falling back to /message:", streamErr);
      }

      if (!succeeded && usedFallback) {
        try {
          const res = await fetch(`${API}/api/sessions/${sessionId}/message`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: effectiveText }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || "Request failed");
          }
          const data = await res.json();
          setExecuting(data.status === "executing");
          pendingAutoAckKey = finaliseTurn({
            payload: data,
            reasoningText: reasoningRef.current,
            reasoningDurationSec: 0,
            streamingMsgId,
          });
          succeeded = true;
        } catch (err) {
          setLastFailedMsg(text);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === streamingMsgId
                ? {
                    ...m,
                    streaming: false,
                    content: "Something went wrong. Try sending your message again.",
                    isError: true,
                  }
                : m,
            ),
          );
        }
      }

      clearTimeout(slowTimerRef.current);
      setSlowWarning(false);
      setLoading(false);
      setExecuting(false);
      inputRef.current?.focus();

      if (pendingAutoAckKey) {
        setAutoAckedKeys((prev) => new Set(prev).add(pendingAutoAckKey));
        setTimeout(() => {
          sendMessage(`I've provided the ${pendingAutoAckKey}`);
        }, 500);
      }
    },
    [sessionId, loading, finaliseTurn, pendingFiles],
  );

  // ── Credential saved ────────────────────────────────────────────────────────
  function handleCredentialSaved(key) {
    setStoredKeys((prev) => new Set(prev).add(key));
    setAutoAckedKeys((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    setMessages((prev) =>
      prev.map((m) => (m.isLatestBot ? { ...m, credentialRequest: null } : m))
    );
    sendMessage(`I've provided the ${key}`);
  }

  // ── Quote a bot message into the composer ──────────────────────────────────
  // Standard pro-chat affordance: clicking "Quote" in a bubble's hover row
  // drops a "> " prefixed snippet (first 280 chars) into the input. Lets the
  // user reply to a specific point without retyping context.
  function handleQuoteMessage(text) {
    if (!text) return;
    const snippet = text.length > 280 ? `${text.slice(0, 280)}…` : text;
    const quoted = snippet.split("\n").map((line) => `> ${line}`).join("\n");
    setInput((prev) => (prev?.trim() ? `${quoted}\n\n${prev}` : `${quoted}\n\n`));
    inputRef.current?.focus();
  }

  // ── Comment on a generated agent code block ─────────────────────────────────
  // Drops a quoted reference into the input so the user's next message has the
  // context. The bot reads the ref and adjusts the next on-fly agent.
  function handleCommentOnCode(block) {
    const purpose = block?.purpose || "code";
    const quote = `> Re: agent code — ${purpose}\n`;
    setInput((prev) => (prev?.trim() ? `${quote}${prev}` : quote));
    inputRef.current?.focus();
  }

  // ── Comment on a diff file (Slice 5 — Monaco DiffViewer) ────────────────────
  // Same pattern as code comments — drops a quoted reference into the input
  // so the user's next message tells Claude exactly which file in which PR
  // they want changed, without leaving the chat.
  function handleCommentOnFile(item, file) {
    const prRef = item?.pr_url || item?.title || "the change";
    const path = file?.path || "this file";
    const quote = `> Re: ${prRef} — ${path}\n`;
    setInput((prev) => (prev?.trim() ? `${quote}${prev}` : quote));
    inputRef.current?.focus();
  }

  // ── Approval result / feedback ───────────────────────────────────────────────
  // Two callers feed this:
  //   1) ApprovalCard:onApproved — passes the raw POST /approve response.
  //      The bot's reply (typically "Merged. Want me to deploy? What target?")
  //      lives in data.message and must surface as a new bot bubble — not
  //      hidden behind a "Deploying…" overlay (the old behaviour).
  //   2) ApprovalCard:onFeedback — passes a string + isFeedback=true. We
  //      route that back through sendMessage() so it kicks a new Claude turn.
  function handleApprovalResult(payload, isFeedback = false) {
    // Clear approval items from the prior bubble so the review card unmounts.
    setMessages((prev) =>
      prev.map((m) => ({ ...m, isLatestBot: false, approvalItems: [] }))
    );

    if (isFeedback) {
      sendMessage(payload);
      return;
    }

    // Object payload from /approve: { message, status, agent_code_blocks,
    //   approval_items?, session_id, approved }. We pin agent_code_blocks
    //   AND any new approval_items (the bot may emit another <approval_needed>
    //   right after merge, e.g. confirming a destructive deploy target) so
    //   the new bot bubble renders the full result of the merge turn.
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      const message = payload.message || payload.reply || "";
      const agentCodeBlocks = payload.agent_code_blocks || [];
      const approvalItems = payload.approval_items || [];
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now(),
          role: "bot",
          content: message,
          ts: new Date().toISOString(),
          isLatestBot: true,
          agentCodeBlocks,
          approvalItems,
        },
      ]);
      return;
    }

    // Plain-string fallback (legacy onDone path) — keep for safety.
    setMessages((prev) => [
      ...prev,
      {
        id: Date.now(),
        role: "bot",
        content: String(payload || ""),
        ts: new Date().toISOString(),
        isLatestBot: true,
      },
    ]);
  }

  // ── Clear session ───────────────────────────────────────────────────────────
  async function clearSession() {
    if (!sessionId) return;
    await fetch(`${API}/api/sessions/${sessionId}`, { method: "DELETE" }).catch(() => {});
    window.location.reload();
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  if (initError) {
    return (
      <div className="flex items-center justify-center h-screen bg-surface-page text-red-400 text-sm">
        {initError}
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-surface-page text-white overflow-hidden">
      {/* Main chat column */}
      <div
        className="flex flex-col flex-1 min-w-0 relative"
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {/* Drag-drop overlay */}
        {isDragging && (
          <div className="absolute inset-0 z-20 pointer-events-none flex items-center justify-center bg-brand-900/40 backdrop-blur-sm">
            <div className="rounded-xl border-2 border-dashed border-brand-300 bg-surface-page/80 px-8 py-6 text-center shadow-xl">
              <div className="text-2xl font-semibold text-brand-200">Drop files to attach</div>
              <div className="text-xs text-gray-400 mt-1">
                PDFs, screenshots, logs, CSVs, source code — anything Claude can read.
              </div>
            </div>
          </div>
        )}
        {/* Header — status, model, icon-actions. The border + backdrop span
            the full width of the chat column for visual continuity, but the
            content inside is capped at max-w-screen-2xl so it aligns with
            the messages list and composer below. */}
        <header className="border-b border-surface-border shrink-0 h-14 bg-surface-page/70 backdrop-blur z-10 relative">
         <div className="max-w-screen-2xl mx-auto h-full flex items-center gap-3 px-6">
          {/* Header logo — brand-tinted to match the rest of the theme. The
              in-chat `Avatar()` stays grey so the assistant identity reads
              as neutral inside conversation, while the header marks the
              product. */}
          <div className="w-8 h-8 rounded-lg bg-brand-900/60 border border-brand-700/60 flex items-center justify-center font-bold text-[13px] text-brand-200 shrink-0 tracking-tight shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            ZB
          </div>
          <div className="flex flex-col min-w-0">
            {/* Wordmark — gradient from pure white through brand mid-tones.
                bg-clip-text + text-transparent lets the gradient paint
                through the glyphs. Tight tracking + bolder weight gives
                it a "logotype" feel rather than "default h1 text". */}
            <h1
              className="font-extrabold leading-tight tracking-tight text-lg bg-gradient-to-br from-white via-brand-100 to-brand-300 bg-clip-text text-transparent select-none"
              style={{ WebkitBackgroundClip: "text" }}
            >
              ZeroBug
            </h1>
            <div className="flex items-center gap-1.5 text-[11px] text-gray-400 leading-tight">
              <span className="relative flex items-center justify-center">
                <span className="absolute w-2 h-2 rounded-full bg-emerald-400/40 animate-ping" />
                <span className="relative w-1.5 h-1.5 rounded-full bg-emerald-400" />
              </span>
              <span>Online</span>
              <span className="text-gray-600">·</span>
              <span className="truncate">Claude Sonnet 4.5</span>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            {sessionId && <SessionChip sessionId={sessionId} />}
            {sessionId && (
              <>
                {/* Pulse / heartbeat SVG — universal "activity" iconography
                    (monitoring tools, fitness apps, etc.). Reads as
                    "live signal" rather than "clipboard with check". */}
                <button
                  type="button"
                  onClick={() => setActivityOpen((v) => !v)}
                  title={activityOpen ? "Hide activity timeline" : "Show activity timeline"}
                  aria-label="Toggle activity timeline"
                  aria-pressed={activityOpen}
                  className={
                    "relative shrink-0 inline-flex items-center gap-1.5 h-9 px-2.5 rounded-lg border text-[11px] font-medium transition-colors " +
                    (activityOpen
                      ? "bg-brand-500/25 border-brand-400/70 text-brand-100 shadow-[inset_0_0_0_1px_rgba(170,126,198,0.15)]"
                      : "bg-transparent border-surface-border text-gray-300 hover:text-white hover:bg-surface-input hover:border-gray-500")
                  }
                >
                  <svg
                    className={"w-4 h-4 " + (activityOpen ? "text-brand-200" : "text-gray-400")}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M3 12h3l2-6 4 12 3-8 2 4h4" />
                  </svg>
                  <span className="hidden sm:inline">Activity</span>
                  {/* Live-work pulse dot — visible whenever there's an
                      in-progress event, regardless of whether the panel is
                      open. Pulls the user's attention to live work even
                      when the sidebar is collapsed. */}
                  {hasLiveActivity && (
                    <span className="absolute -top-1 -right-1 flex items-center justify-center">
                      <span className="absolute w-2.5 h-2.5 rounded-full bg-brand-400/50 animate-ping" />
                      <span className="relative w-2 h-2 rounded-full bg-brand-400 border border-surface-page" />
                    </span>
                  )}
                </button>
                <KebabMenu
                  items={[
                    {
                      label: "Copy session id",
                      icon: (
                        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      ),
                      onClick: () => {
                        try { navigator.clipboard.writeText(sessionId); } catch {}
                      },
                    },
                    { divider: true },
                    {
                      label: "Clear session",
                      danger: true,
                      icon: (
                        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
                        </svg>
                      ),
                      onClick: clearSession,
                    },
                  ]}
                />
              </>
            )}
          </div>
         </div>
        </header>

        {/* Messages — subtle brand-tinted radial backdrop anchored top-left
            adds depth without competing with content. Inner wrapper caps the
            message column at max-w-screen-2xl and centres it, so on wide
            displays
            bubbles don't sprawl across 70 % of the viewport. */}
        <main
          className="flex-1 overflow-y-auto px-6 py-6 relative"
          style={{
            backgroundImage:
              "radial-gradient(ellipse 1100px 600px at 0% 0%, rgba(102, 46, 130, 0.10), transparent 60%), radial-gradient(ellipse 900px 500px at 100% 100%, rgba(102, 46, 130, 0.06), transparent 55%)",
          }}
        >
          <div className="max-w-screen-2xl mx-auto space-y-5">
          {messages.map((msg) => (
            <Message
              key={msg.id}
              msg={msg}
              sessionId={sessionId}
              executing={executing}
              onCredentialSaved={handleCredentialSaved}
              onApprovalResult={handleApprovalResult}
              onCommentOnCode={handleCommentOnCode}
              onCommentOnFile={handleCommentOnFile}
              onQuote={handleQuoteMessage}
            />
          ))}
          {/* Welcome-state starter prompts — visible only on a fresh
              session before the user has sent anything. Tool-agnostic
              wording so the chips work for any backing system. */}
          {messages.length === 1 && messages[0]?.id === "welcome" && !loading && (
            <WelcomeStarters
              onPick={(text) => {
                setInput(text);
                setTimeout(() => inputRef.current?.focus(), 0);
              }}
            />
          )}
          {/* The streaming bot bubble (reasoning chip + agent code) acts as
              the live "now thinking" surface. We only show the standalone
              feed below it for the step-by-step status line — it stays
              compact and complements the reasoning chip. */}
          {loading && <InlineActivityFeed events={currentTurnEvents} />}
          {loading && slowWarning && (
            <div className="flex gap-2 items-center text-xs text-gray-400 pl-11">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
              Still working, this might take a moment...
            </div>
          )}
          {lastFailedMsg && (
            <div className="flex justify-center">
              <button
                onClick={() => { setLastFailedMsg(null); sendMessage(lastFailedMsg); }}
                className="flex items-center gap-2 px-4 py-2 rounded-xl border border-surface-border text-xs text-gray-300 hover:text-white hover:border-gray-400 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Retry
              </button>
            </div>
          )}
            <div ref={bottomRef} />
          </div>
        </main>

        {/* Composer — paperclip + textarea + send wrapped as a single card.
            The card gets a brand-tinted ring when the textarea has focus.
            Matches the max-w-screen-2xl cap on the messages column so the
            composer + thread line up at the same width. */}
        <div className="px-6 py-4 shrink-0">
         <div className="max-w-screen-2xl mx-auto">
          {/* Attached file chips */}
          {(pendingFiles.length > 0 || uploadingNames.length > 0 || uploadError) && (
            <div className="flex flex-wrap items-center gap-2 mb-2 px-1">
              {pendingFiles.map((f) => (
                <FileChip key={f.id} file={f} onRemove={() => removeFile(f.id)} />
              ))}
              {uploadingNames.map((name) => (
                <UploadingChip key={name} name={name} />
              ))}
              {uploadError && (
                <span className="inline-flex items-center gap-1 text-xs text-red-400">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M4.93 19h14.14a1.5 1.5 0 001.32-2.22l-7.07-12.7a1.5 1.5 0 00-2.64 0l-7.07 12.7A1.5 1.5 0 004.93 19z" />
                  </svg>
                  {uploadError}
                  <button
                    type="button"
                    onClick={() => setUploadError("")}
                    className="ml-1 text-gray-500 hover:text-gray-200"
                    aria-label="Dismiss error"
                  >
                    ×
                  </button>
                </span>
              )}
            </div>
          )}

          <div className="flex items-end gap-2 rounded-2xl border border-surface-border bg-surface-card/60 px-2 py-1.5 focus-within:border-brand-500/60 focus-within:bg-surface-card/80 focus-within:shadow-[0_0_0_3px_rgba(102,46,130,0.18)] transition-all">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={onFileInputChange}
              className="hidden"
              aria-hidden="true"
            />
            <button
              type="button"
              onClick={onPickFiles}
              disabled={!sessionId || loading}
              title="Attach files (PDFs, screenshots, logs, CSVs — anything)"
              aria-label="Attach files"
              className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg text-gray-400 hover:text-white hover:bg-surface-input disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 10-5.656-5.656l-6.586 6.586a6 6 0 008.486 8.486L20.5 13" />
              </svg>
            </button>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={onPaste}
              placeholder={
                pendingFiles.length > 0
                  ? "Add a note about the attachment(s) — or hit Send."
                  : "Describe what you want done…"
              }
              rows={1}
              disabled={loading || !sessionId}
              className="flex-1 resize-none bg-transparent text-white placeholder-gray-500 px-1 py-2 text-sm leading-5 focus:outline-none disabled:opacity-50 max-h-[200px] overflow-y-auto"
            />
            <span className="hidden md:inline-flex items-center gap-1 text-[10px] text-gray-500 select-none mb-2 mr-1 shrink-0">
              <kbd className="px-1 py-0.5 rounded border border-surface-border bg-surface-input/60 text-gray-400 font-mono text-[9px]">↵</kbd>
              send
              <span className="text-gray-700">·</span>
              <kbd className="px-1 py-0.5 rounded border border-surface-border bg-surface-input/60 text-gray-400 font-mono text-[9px]">⇧↵</kbd>
              newline
            </span>
            <button
              onClick={() => sendMessage(input)}
              disabled={loading || !sessionId || (!input.trim() && pendingFiles.length === 0)}
              title="Send message"
              aria-label="Send message"
              className="shrink-0 w-9 h-9 flex items-center justify-center bg-brand-500 hover:bg-brand-600 disabled:opacity-40 disabled:hover:bg-brand-500 disabled:cursor-not-allowed rounded-lg text-white transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 12h14m-6-6l6 6-6 6" />
              </svg>
            </button>
          </div>
         </div>
        </div>
      </div>

      {/* Activity sidebar — right panel */}
      {sessionId && (
        <ActivitySidebar
          events={activityEvents}
          fetching={activityFetching}
          open={activityOpen}
          onToggle={() => setActivityOpen((v) => !v)}
        />
      )}
    </div>
  );
}
