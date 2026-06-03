# ZeroBug Sandbox — Available Libraries

Every library listed here is pre-installed in the sandbox Lambda layer.
Your generated code can import any of them directly.

## Convention

Always assign your final structured output to a variable named `RESULT`:
```python
RESULT = {"tickets": [...], "status": "ok"}
```
Anything printed with `print()` is captured separately as debug output.

---

## Standard Library (always available)

| Module | Use for |
|---|---|
| `json` | Parse and serialise JSON |
| `re` | Regular expressions |
| `datetime` | Dates, times, timedeltas |
| `collections` | defaultdict, Counter, OrderedDict, namedtuple |
| `itertools` | Chaining, grouping, product, combinations |
| `functools` | reduce, partial, lru_cache |
| `urllib.parse` | URL encoding, query string parsing |
| `base64` | Encode/decode base64 strings |
| `hashlib` | MD5, SHA256 and other hashes |
| `uuid` | Generate UUIDs |
| `math` | Floor, ceil, sqrt, etc. |
| `string` | String constants and templates |
| `io` | StringIO, BytesIO |
| `copy` | Shallow and deep copy |
| `time` | Timestamps, sleep |

---

## HTTP

```python
import requests

response = requests.get(url, headers={"Authorization": f"Bearer {token}"})
data = response.json()
```

`requests` supports GET, POST, PUT, PATCH, DELETE, sessions, and timeouts.

---

## GitHub (`PyGithub`)

```python
from github import Github

g = Github(os.environ["GITHUB_PAT"])
repo = g.get_repo("org/repo")

# List open PRs
prs = repo.get_pulls(state="open")

# Create a PR
pr = repo.create_pull(
    title="Fix: ...",
    body="...",
    head="feature-branch",
    base="main",
)

# Get file contents
content = repo.get_contents("path/to/file.py")
text = content.decoded_content.decode()
```

---

## Jira (`jira`)

```python
from jira import JIRA

jira = JIRA(
    server=os.environ["JIRA_URL"],
    basic_auth=(os.environ["JIRA_EMAIL"], os.environ["JIRA_TOKEN"]),
)

# Search issues
issues = jira.search_issues('project=MYPROJ AND status="In Progress"')
for issue in issues:
    print(issue.key, issue.fields.summary)

# Create issue
new_issue = jira.create_issue(
    project="MYPROJ",
    summary="Bug: ...",
    description="...",
    issuetype={"name": "Bug"},
)

# Transition issue
jira.transition_issue(issue, "Done")
```

---

## GitLab (`python-gitlab`)

```python
import gitlab

gl = gitlab.Gitlab(os.environ["GITLAB_URL"], private_token=os.environ["GITLAB_TOKEN"])
project = gl.projects.get("namespace/project")

# List open MRs
mrs = project.mergerequests.list(state="opened")

# Create MR
mr = project.mergerequests.create({
    "source_branch": "feature",
    "target_branch": "main",
    "title": "Fix: ...",
})
```

---

## AWS S3 (`boto3` — read-only)

```python
import boto3

s3 = boto3.client("s3")
obj = s3.get_object(Bucket=os.environ["ARTIFACTS_BUCKET"], Key="path/to/file")
content = obj["Body"].read().decode()
```

Write access is not granted. Use S3 only to read artifacts placed there by the runtime.

---

## Diff / Patch utilities

```python
import unidiff          # Parse unified diff output
import patch_ng as patch     # Apply patches to files in /tmp

# Parse a diff string
patch_set = unidiff.PatchedFile(diff_text)

# Detect file encoding
import chardet
result = chardet.detect(raw_bytes)
encoding = result["encoding"]
```

---

## Config file parsing

```python
import yaml   # pyyaml
import toml

config = yaml.safe_load(open("/tmp/config.yml"))
config = toml.loads(config_string)
```

---

## Credentials

Credentials injected by the sandbox are available as environment variables:

```python
import os

github_pat   = os.environ.get("GITHUB_PAT", "")
jira_token   = os.environ.get("JIRA_TOKEN", "")
jira_email   = os.environ.get("JIRA_EMAIL", "")
jira_url     = os.environ.get("JIRA_URL", "")
gitlab_token = os.environ.get("GITLAB_TOKEN", "")
gitlab_url   = os.environ.get("GITLAB_URL", "")
```

---

## Restrictions

- No `subprocess`, `os.system`, `socket`, `ctypes`
- No file writes outside `/tmp`
- No access to `169.254.169.254` (AWS metadata)
- No nested `eval(eval(...))` or `exec(exec(...))`
