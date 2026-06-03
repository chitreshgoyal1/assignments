"""
ZeroBug Sandbox — local test harness.
Runs 5 test cases directly against executor.lambda_handler.

Usage:
    cd zerobug
    python sandbox/test_harness.py

Required .env keys for live tests:
    JIRA_URL, JIRA_EMAIL, JIRA_TOKEN   (Test 1)
    GITHUB_PAT, GITHUB_REPO            (Test 2)
"""
import os
import sys
import time

# Allow running from repo root or from sandbox/
sys.path.insert(0, os.path.join(os.path.dirname(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from executor import lambda_handler  # noqa: E402

# ── Helpers ───────────────────────────────────────────────────────────────────

GREEN = "\033[92m"
RED   = "\033[91m"
YELLOW = "\033[93m"
RESET = "\033[0m"
BOLD  = "\033[1m"

passed = 0
failed = 0


def run_test(name: str, event: dict, expect_error: str | None = None, skip_reason: str | None = None):
    global passed, failed

    if skip_reason:
        print(f"  {YELLOW}SKIP{RESET}  {name} — {skip_reason}")
        return

    print(f"\n{BOLD}{'─'*60}{RESET}")
    print(f"  Running: {name}")
    start = time.time()
    result = lambda_handler(event, None)
    elapsed = time.time() - start

    error = result.get("error")
    detail = result.get("detail", "")
    output = result.get("output", "").strip()
    res = result.get("result")

    if expect_error:
        if error == expect_error:
            print(f"  {GREEN}PASS{RESET}  ({elapsed:.2f}s) — got expected error: {error!r}")
            if detail:
                print(f"         detail: {detail}")
            passed += 1
        else:
            print(f"  {RED}FAIL{RESET}  ({elapsed:.2f}s) — expected error={expect_error!r}, got error={error!r}")
            if detail:
                print(f"         detail: {detail}")
            if output:
                print(f"         output: {output}")
            failed += 1
    else:
        if error:
            print(f"  {RED}FAIL{RESET}  ({elapsed:.2f}s) — unexpected error: {error}: {detail}")
            if output:
                print(f"         output: {output}")
            failed += 1
        else:
            print(f"  {GREEN}PASS{RESET}  ({elapsed:.2f}s)")
            if res is not None:
                print(f"         RESULT: {res}")
            if output:
                print(f"         stdout: {output}")
            passed += 1


# ── Test 1 — Jira fetch ───────────────────────────────────────────────────────

jira_url   = os.getenv("JIRA_URL", "")
jira_email = os.getenv("JIRA_EMAIL", "")
jira_token = os.getenv("JIRA_TOKEN", "")

jira_skip = None
if not all([jira_url, jira_email, jira_token]):
    jira_skip = "JIRA_URL / JIRA_EMAIL / JIRA_TOKEN not set in .env"

run_test(
    name="Test 1 — Jira fetch (Critical issues)",
    skip_reason=jira_skip,
    event={
        "session_id": "test-001",
        "timeout_seconds": 30,
        "credentials": {
            "JIRA_URL":   jira_url,
            "JIRA_EMAIL": jira_email,
            "JIRA_TOKEN": jira_token,
        },
        "code": """
from jira import JIRA
import os

jira = JIRA(
    server=os.environ['JIRA_URL'],
    basic_auth=(os.environ['JIRA_EMAIL'], os.environ['JIRA_TOKEN']),
)
issues = jira.search_issues('project=DEMO AND priority=Critical', maxResults=5)
RESULT = [
    {
        'id': i.key,
        'summary': i.fields.summary,
        'priority': i.fields.priority.name,
    }
    for i in issues
]
print(f"Found {len(RESULT)} issues")
""",
    },
)

# ── Test 2 — GitHub repo info ─────────────────────────────────────────────────

github_pat  = os.getenv("GITHUB_PAT", "")
github_repo = os.getenv("GITHUB_REPO", "")

github_skip = None
if not all([github_pat, github_repo]):
    github_skip = "GITHUB_PAT / GITHUB_REPO not set in .env"

run_test(
    name="Test 2 — GitHub repo info (read-only)",
    skip_reason=github_skip,
    event={
        "session_id": "test-002",
        "timeout_seconds": 30,
        "credentials": {
            "GITHUB_PAT":  github_pat,
            "GITHUB_REPO": github_repo,
        },
        "code": """
from github import Github
import os

g = Github(os.environ['GITHUB_PAT'])
repo_ref = os.environ['GITHUB_REPO']
# Strip full URL if provided — PyGithub needs "owner/repo" only
if repo_ref.startswith("http"):
    repo_ref = repo_ref.rstrip("/").split("github.com/")[-1]
repo = g.get_repo(repo_ref)
RESULT = {
    'name': repo.name,
    'default_branch': repo.default_branch,
    'open_issues': repo.open_issues_count,
}
print(f"Repo: {RESULT['name']} (branch: {RESULT['default_branch']})")
""",
    },
)

# ── Test 3 — Blocked operation ────────────────────────────────────────────────

run_test(
    name="Test 3 — Blocked operation (subprocess)",
    expect_error="blocked_operation",
    event={
        "session_id": "test-003",
        "timeout_seconds": 10,
        "credentials": {},
        "code": "import subprocess; subprocess.run(['ls']); RESULT = 'pwned'",
    },
)

# ── Test 4 — Timeout ──────────────────────────────────────────────────────────

run_test(
    name="Test 4 — Timeout (sleep 60s with 3s limit)",
    expect_error="timeout",
    event={
        "session_id": "test-004",
        "timeout_seconds": 3,
        "credentials": {},
        "code": "import time; time.sleep(60); RESULT = 'done'",
    },
)

# ── Test 5 — Diff / patch application ────────────────────────────────────────

ORIGINAL_CODE = "def hello():\n    print('hello')\n"
DIFF_TEXT = (
    "--- a/hello.py\n"
    "+++ b/hello.py\n"
    "@@ -1,2 +1,2 @@\n"
    " def hello():\n"
    "-    print('hello')\n"
    "+    print('hello world')\n"
)

run_test(
    name="Test 5 — Diff parsing with patch-ng",
    event={
        "session_id": "test-005",
        "timeout_seconds": 10,
        "credentials": {
            "DIFF":          DIFF_TEXT,
            "ORIGINAL_CODE": ORIGINAL_CODE,
        },
        "code": """
import patch_ng as patch
import os

diff_text    = os.environ['DIFF']
original     = os.environ['ORIGINAL_CODE']

pset = patch.fromstring(diff_text.encode())
hunks = sum(len(p.hunks) for p in pset.items)
RESULT = {'parsed': True, 'files': len(pset.items), 'hunks': hunks}
print(f"Parsed {RESULT['files']} file(s), {RESULT['hunks']} hunk(s)")
""",
    },
)

# ── Summary ───────────────────────────────────────────────────────────────────

total = passed + failed
print(f"\n{'─'*60}")
print(f"{BOLD}Results: {GREEN}{passed} passed{RESET}{BOLD}, {RED}{failed} failed{RESET}{BOLD} / {total} run{RESET}")
print()

if failed:
    sys.exit(1)
