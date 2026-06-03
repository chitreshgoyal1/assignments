# ZeroBug — Product Build Roadmap (Conversational Architecture)

> The user talks. Claude listens, understands, builds what it needs, and gets it done.
> No pre-built agents. No hardcoded connectors. Everything created at runtime.

---

## What We Are Actually Building

A conversation-first AI system. The user opens a chat, describes what they want in plain
English, and ZeroBug handles everything else — asking only what it needs, building connectors
on the fly, executing the work, and returning for human approval at the end.

```
User: "I want to fix security vulnerabilities in my project"

ZeroBug: "Sure. Are these from a scanner report or a Jira backlog?
          Can you share your Jira URL and API token so I can connect?"

User: "Jira. Here's the URL and token: ..."

ZeroBug: "Got it. I can see 14 open security bugs. Want me to start
          with the 3 critical ones? I'll fix, open PRs, and ask you
          before anything merges."

User: "Yes, start with critical."

ZeroBug: [writes Jira connector code at runtime]
         [fetches tickets, reads codebase, writes fixes, opens PRs]
         [deploys to test env]

ZeroBug: "Done. Here are the 3 PRs with diffs and test env links.
          Ready to approve?"

User: "Approve all."

ZeroBug: [merges, deploys to prod, closes Jira tickets]

ZeroBug: "All 3 fixes are live. Jira tickets closed."
```

**That is the entire product.** Everything else is infrastructure to make that conversation work.

---

## Architecture — Three Things Only

```
┌─────────────────────────────────────────────────────────┐
│                    CHAT INTERFACE                        │
│              React frontend — user talks here            │
│   Shows conversation, progress updates, approval cards  │
└────────────────────────┬────────────────────────────────┘
                         │ WebSocket / HTTP
                         ▼
┌─────────────────────────────────────────────────────────┐
│                  CLAUDE RUNTIME                          │
│         One Lambda. Claude runs the conversation.        │
│                                                          │
│  Receives message → reasons → decides next action:       │
│    • Ask user a question                                 │
│    • Write code to connect to a system (this we call agent-on-fly)│
│    • Execute that code in the sandbox                    │
│    • Use the result to continue reasoning                │
│    • Report back to user / ask for approval              │
└────────────────────────┬────────────────────────────────┘
                         │ Invoke
                         ▼
┌─────────────────────────────────────────────────────────┐
│               CODE EXECUTION SANDBOX                     │
│    Lambda where Claude's generated code actually runs    │
│                                                          │
│  Claude writes: "fetch all Jira tickets with label=bug"  │
│  Sandbox executes it, returns the data                   │
│  Claude writes: "find the vulnerable line in auth.py"    │
│  Sandbox executes it, returns the code context           │
│  Claude writes: "open a PR with this diff"               │
│  Sandbox executes it, returns the PR URL                 │
└─────────────────────────────────────────────────────────┘
```

**Nothing else. No pre-built agents. No hardcoded tool library.**
The sandbox is the only tool Claude has. Everything it needs to do, it writes and runs there.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + Vite + Tailwind |
| Backend / API | Python FastAPI |
| Claude runtime | Amazon Bedrock — Claude Sonnet 4.6 (Converse API) |
| Code execution | AWS Lambda (sandboxed Python executor) |
| Session storage | Amazon DynamoDB (conversation history + session state) |
| Credentials vault | AWS Secrets Manager (user-provided tokens stored per session) |
| File/artifact store | Amazon S3 (generated diffs, reports, PR artifacts) |
| Notifications | Amazon SNS (approval alerts) |
| Infra | AWS CDK (Python) |

---

## Phase Overview

| Phase | Focus | Time |
|-------|-------|------|
| Phase 1 | Foundation — scaffold, infra, session DB | ~0.5 day |
| Phase 2 | Code execution sandbox — the engine room | ~1.5 days |
| Phase 3 | Claude runtime — the brain and conversation loop | ~2 days |
| Phase 4 | Chat interface — the product face | ~1.5 days |
| Phase 5 | Approval flow — the human gate | ~0.5 day |
| Phase 6 | Demo prep and hardening | ~0.5 day |
| **Total** | | **~6.5 days** |

---

## Phase 1 — Foundation (~0.5 day)

### Task 1.1 — Project scaffold

**Copilot Prompt:**
```
Create a monorepo scaffold for ZeroBug — a conversational AI system.

Structure:
  /frontend          → React + Vite + Tailwind chat interface
  /runtime           → Claude conversation loop Lambda
  /sandbox           → Code execution Lambda
  /api               → FastAPI (session management, approval endpoints)
  /infra             → AWS CDK (Python)
  /demo-data         → Sample inputs for demo

Root files:
- .gitignore (Python + Node + CDK)
- requirements.txt: fastapi, boto3, python-dotenv, requests, PyGithub
- /frontend/package.json: React, Vite, Tailwind, react-markdown, date-fns
- docker-compose.yml: FastAPI + DynamoDB local for local dev
- .env.example: all required env vars, values blank

Do not create any agent files, tool files, or connector files.
There are no pre-built integrations. Everything is generated at runtime.
```

---

### Task 1.2 — DynamoDB session schema

**What:** Stores conversation history and session state per user. Claude needs full
conversation history on every turn — DynamoDB holds it.

**Copilot Prompt:**
```
Write /api/db/session.py using boto3 DynamoDB.

Table: zerobug_sessions
  session_id        String (partition key)
  created_at        String (ISO timestamp)
  updated_at        String (ISO timestamp)
  status            String (active | awaiting_approval | completed | failed)
  conversation      String (JSON array of {role, content} message objects)
  credentials       String (JSON — user-provided tokens, encrypted at rest via KMS)
  context           String (JSON — what Claude has figured out so far:
                             {goal, systems_identified, tickets_found,
                              prs_opened, fixes_applied})
  approval_items    String (JSON array of PRs awaiting human approval)

Functions to write:
  create_session(session_id) -> None
  get_session(session_id) -> dict
  append_message(session_id, role, content) -> None
    (appends to conversation array atomically)
  update_session(session_id, **fields) -> None
  store_credential(session_id, key, value) -> None
    (stores in credentials dict, values encrypted via AWS KMS before storage)
  get_credential(session_id, key) -> str
    (decrypts on retrieval)

Use boto3 resource API. Handle ConditionalCheckFailedException gracefully.
```

---

### Task 1.3 — CDK infra

**Copilot Prompt:**
```
Write /infra/zerobug_stack.py using AWS CDK (Python).

Create:

1. DynamoDB table: ZeroBugSessions
   - Partition key: session_id (String)
   - TTL attribute: expires_at (auto-delete sessions after 24h)
   - Billing: PAY_PER_REQUEST

2. Lambda: RuntimeLambda
   - Source: /runtime/handler.py
   - Timeout: 15 minutes
   - Memory: 1024 MB
   - Environment: BEDROCK_REGION, SANDBOX_LAMBDA_NAME, SESSIONS_TABLE

3. Lambda: SandboxLambda
   - Source: /sandbox/executor.py
   - Timeout: 5 minutes
   - Memory: 512 MB
   - NO outbound internet access except specific allowed domains
     (Jira, GitHub, api.osv.dev) via VPC + NAT gateway
   - Environment: ALLOWED_DOMAINS list

4. FastAPI Lambda: ApiLambda (via Mangum adapter)
   - Source: /api/main.py
   - Timeout: 30 seconds

5. API Gateway: REST API routing to ApiLambda

6. SNS Topic: ZeroBugApprovals
   (runtime publishes here when approval is needed)

7. KMS Key for credential encryption in DynamoDB

8. IAM roles — least privilege:
   - RuntimeLambda: invoke SandboxLambda, call Bedrock, read/write DynamoDB,
                    publish SNS, read/write S3
   - SandboxLambda: read S3 only (no AWS service calls — code runs in isolation)
   - ApiLambda: read/write DynamoDB, publish SNS

Output: API Gateway URL, RuntimeLambda ARN
```

---

## Phase 2 — Code Execution Sandbox (~1.5 days)

> This is the engine room. Claude writes Python code as a string.
> The sandbox receives that string, executes it safely, and returns the result.
> The sandbox is the ONLY way Claude interacts with external systems.
> Claude never calls Jira, GitHub, or anything else directly.
> It writes code that does it, and the sandbox runs it.

### Task 2.1 — Sandbox executor core

**Copilot Prompt:**
```
Write /sandbox/executor.py — a Lambda function that safely executes
Python code strings generated by Claude.

lambda_handler(event, context):
  Input event:
  {
    "session_id": "uuid",
    "code": "import requests\nresponse = requests.get(...)\nprint(response.json())",
    "credentials": {"JIRA_TOKEN": "...", "GITHUB_PAT": "..."},
    "timeout_seconds": 30
  }

Steps:
1. Validate the code string against a BLOCKLIST of forbidden operations:
   - No file system writes outside /tmp
   - No subprocess calls
   - No os.system, eval of eval, exec of exec
   - No imports of: subprocess, os.system, socket (raw), ctypes
   - No access to AWS metadata endpoint (169.254.169.254)
   If any blocked pattern found: return {error: "blocked_operation", detail: "..."}

2. Inject credentials as environment variables into the execution context:
   os.environ["JIRA_TOKEN"] = credentials.get("JIRA_TOKEN", "")
   os.environ["GITHUB_PAT"] = credentials.get("GITHUB_PAT", "")
   etc.

3. Set up a safe execution namespace:
   allowed_builtins = {safe subset: print, len, range, enumerate, zip,
                       dict, list, str, int, float, bool, None, True, False,
                       json, requests, os.environ (read-only)}
   exec_globals = {"__builtins__": allowed_builtins,
                   "requests": requests, "json": json, "os": os}

4. Capture stdout using io.StringIO redirect

5. Execute with timeout using threading.Timer:
   exec(code, exec_globals)
   If timeout exceeded: kill thread, return {error: "timeout"}

6. Return:
   {
     "output": captured_stdout,
     "result": exec_globals.get("RESULT"),  # Claude sets RESULT = {...} in its code
     "error": None
   }

7. On any exception: return {error: type(e).__name__, detail: str(e), output: captured}

Key convention: Claude always assigns its final output to a variable called RESULT.
The sandbox returns exec_globals["RESULT"] as the structured result.
Everything else printed goes to "output" for debugging.
```

---

### Task 2.2 — Sandbox available libraries

**Copilot Prompt:**
```
Configure the SandboxLambda Lambda layer with these pre-installed libraries
that Claude's generated code can import:

Core:
  requests, json, re, datetime, collections, itertools, functools,
  urllib.parse, base64, hashlib, uuid

Integrations Claude might need:
  PyGithub           → GitHub API
  jira               → Jira REST API (python-jira library)
  python-gitlab      → GitLab API
  boto3              → AWS services (read-only S3)

Utilities:
  patch              → Apply unified diffs
  unidiff            → Parse unified diffs
  chardet            → Detect file encoding
  pyyaml             → Parse YAML configs
  toml               → Parse TOML files

Write a Lambda Layer CDK construct in /infra/zerobug_stack.py that:
1. Installs all libraries into a /python directory
2. Creates a Lambda LayerVersion from that directory
3. Attaches the layer to SandboxLambda

Also write /sandbox/available_libs.md documenting every library Claude
can use in its generated code — this file is injected into Claude's
system prompt so it knows what it has available.
```

---

### Task 2.3 — Sandbox test harness

**What:** A local test script so you can verify the sandbox works before wiring Claude to it.

**Copilot Prompt:**
```
Write /sandbox/test_harness.py — a local test script (not a Lambda).

It simulates the sandbox Lambda locally for testing.

Include 5 test cases:

Test 1 — Jira fetch:
  code = """
  from jira import JIRA
  import os
  jira = JIRA(server=os.environ['JIRA_URL'],
              basic_auth=(os.environ['JIRA_EMAIL'], os.environ['JIRA_TOKEN']))
  issues = jira.search_issues('project=DEMO AND priority=Critical', maxResults=5)
  RESULT = [{'id': i.key, 'summary': i.fields.summary,
             'priority': i.fields.priority.name} for i in issues]
  """
  credentials = {JIRA_URL, JIRA_EMAIL, JIRA_TOKEN from .env}
  Expected: list of Jira issues returned in RESULT

Test 2 — GitHub PR creation:
  code = """
  from github import Github
  import os
  g = Github(os.environ['GITHUB_PAT'])
  repo = g.get_repo(os.environ['GITHUB_REPO'])
  # Just read repo info for the test, don't actually create PR
  RESULT = {'name': repo.name, 'default_branch': repo.default_branch}
  """

Test 3 — Blocked operation (should fail safely):
  code = "import subprocess; subprocess.run(['ls']); RESULT = 'pwned'"
  Expected: {error: "blocked_operation"}

Test 4 — Timeout (should fail gracefully):
  code = "import time; time.sleep(60); RESULT = 'done'"
  Expected: {error: "timeout"}

Test 5 — Diff application:
  code = """
  import patch, io
  diff_text = os.environ['DIFF']
  original = os.environ['ORIGINAL_CODE']
  pset = patch.fromstring(diff_text.encode())
  RESULT = {'applied': True}
  """

Print pass/fail for each test with timing.
```

---

## Phase 3 — Claude Runtime — The Brain (~2 days)

> This is the most important phase.
> One Lambda. Claude runs the full conversation here.
> It receives a user message, thinks about what to do,
> optionally writes and runs code in the sandbox,
> and returns its next message to the user.
> This loop is the product.

### Task 3.1 — System prompt (Claude's instructions)

**Copilot Prompt:**
```
Write /runtime/system_prompt.py containing one large string constant:
ZEROBUG_SYSTEM_PROMPT

This is Claude's operating manual. Write it in full. Include:

IDENTITY:
"You are ZeroBug, a conversational AI system that fixes software bugs and
security vulnerabilities autonomously. You talk to engineers, understand their
problem, connect to their systems, and get the work done."

HOW YOU WORK:
"You have exactly one capability: you can write Python code and execute it in
a secure sandbox. The sandbox has these libraries available: {AVAILABLE_LIBS}.
To connect to Jira, GitHub, or any other system — you write Python code that
does it, execute it, and use the result to continue.
You never call APIs directly. You write code that calls them."

CONVERSATION FLOW:
"Follow this flow naturally:
1. Understand what the user wants. Ask one clarifying question at a time.
   Do not ask everything at once. Be conversational.
2. Identify what systems you need to connect to.
3. Ask for credentials for those systems only — not upfront, when you need them.
   Say exactly what you need and why: 'I need your Jira API token to fetch tickets.'
4. Write code to connect and gather context. Execute it. Show the user a brief
   summary of what you found — not a data dump.
5. Write code to fix the issues. Execute it to verify your fix applies cleanly.
6. Write code to open PRs. Execute it.
7. Write code to deploy to test environment. Execute it.
8. Present results to the user and ask for approval.
9. On approval — write code to merge and deploy to production."

HOW TO WRITE SANDBOX CODE:
"When you write code for the sandbox:
- Always assign your final result to a variable called RESULT
- RESULT must be a plain dict or list — always JSON-serialisable
- Use os.environ to read credentials (they are injected automatically)
- Write clean, readable code — it will be shown to the user if they ask
- Handle exceptions inside your code and put the error in RESULT
- Never print sensitive data like tokens or passwords"

SIGNALLING TO THE SYSTEM:
"Use these special tags in your response so the system knows what to do:
<execute>your python code here</execute>
  → The system will run this in the sandbox and give you the result.
    Write one <execute> block at a time. Wait for the result before continuing.

<ask>your question to the user</ask>
  → Pause and wait for the user's response. Use this when you need information
    only the user can provide.

<approval_needed>JSON summary of what needs approval</approval_needed>
  → Triggers the approval UI. Use when PRs are ready and test env is live.

<done>final summary message</done>
  → Signals the task is complete.

Everything outside these tags is shown to the user as your message."

TONE:
"Be direct and conversational. One thought at a time. No bullet point walls.
Sound like a capable colleague, not a robot reading a script.
When something works: say so briefly. When something fails: say what you'll
try instead. Always keep the user informed of progress."
```

---

### Task 3.2 — Runtime Lambda — the conversation loop

**Copilot Prompt:**
```
Write /runtime/handler.py — the core Lambda that runs ZeroBug's brain.

lambda_handler(event, context):
  Input event:
  {
    "session_id": "uuid",
    "user_message": "I want to fix my Jira bugs"
  }

Steps:

1. Load session from DynamoDB (create if new)
2. Append user_message to conversation history
3. Load ZEROBUG_SYSTEM_PROMPT from system_prompt.py
   Inject {AVAILABLE_LIBS} from /sandbox/available_libs.md content

4. Call Bedrock Converse API:
   response = bedrock.converse(
     modelId="claude-sonnet-4-6",
     system=[{"text": ZEROBUG_SYSTEM_PROMPT}],
     messages=session["conversation"],  # full history every time
   )
   assistant_text = response["output"]["message"]["content"][0]["text"]

5. Append assistant response to conversation history

6. Parse special tags from assistant_text using regex:
   execute_blocks  = re.findall(r'<execute>(.*?)</execute>', text, re.DOTALL)
   ask_blocks      = re.findall(r'<ask>(.*?)</ask>', text, re.DOTALL)
   approval_blocks = re.findall(r'<approval_needed>(.*?)</approval_needed>', text, re.DOTALL)
   done_blocks     = re.findall(r'<done>(.*?)</done>', text, re.DOTALL)

7. If execute_blocks:
   For each code block:
     a. Retrieve credentials for this session from DynamoDB
     b. Invoke SandboxLambda synchronously:
        result = lambda_client.invoke(
          FunctionName=SANDBOX_LAMBDA_NAME,
          Payload=json.dumps({
            "session_id": session_id,
            "code": code_block,
            "credentials": session_credentials,
            "timeout_seconds": 30
          })
        )
     c. Parse sandbox result
     d. Append a "tool_result" message to conversation:
        {"role": "user", "content": [{"text":
          f"Sandbox result:\n{json.dumps(sandbox_result, indent=2)}"}]}
     e. Call Bedrock again with updated conversation (Claude continues reasoning)
     f. Repeat until no more <execute> blocks in latest response

8. If approval_blocks:
   Parse JSON from block, store in session.approval_items
   Update session status = "awaiting_approval"
   Publish to SNS ZeroBugApprovals topic
   update_session(session_id, status="awaiting_approval",
                  approval_items=approval_items)

9. If done_blocks:
   update_session(session_id, status="completed")

10. Strip all special tags from final assistant_text before returning to user
    (tags are for the system, not for the user to see)

11. Save updated conversation to DynamoDB

12. Return:
    {
      "session_id": session_id,
      "message": cleaned_assistant_text,
      "status": session["status"],
      "approval_items": session.get("approval_items", [])
    }
```

---

### Task 3.3 — Credential collection handler

**What:** When Claude asks for credentials, the frontend shows a secure input form.
This module stores them safely.

**Copilot Prompt:**
```
Write /api/routes/credentials.py — FastAPI endpoint for storing user-provided credentials.

POST /api/sessions/{session_id}/credentials
Body: {"key": "JIRA_TOKEN", "value": "user-provided-token"}

Steps:
1. Validate session exists and is active
2. Encrypt value using AWS KMS:
   kms_client.encrypt(KeyId=KMS_KEY_ID, Plaintext=value.encode())
3. Store encrypted value in DynamoDB session.credentials dict:
   {key: base64(encrypted_blob)}
4. Return: {"stored": true, "key": key}
   Never echo the value back.

GET /api/sessions/{session_id}/credentials/keys
Returns only the KEY NAMES stored for this session (not values):
{"keys": ["JIRA_TOKEN", "JIRA_URL", "GITHUB_PAT"]}
Used by the frontend to show which credentials have been provided.

DELETE /api/sessions/{session_id}
Deletes the entire session including all credentials from DynamoDB.
Hard delete — no soft delete.
User can trigger this to revoke everything.
```

---

### Task 3.4 — FastAPI session and message endpoints

**Copilot Prompt:**
```
Write /api/routes/chat.py — FastAPI endpoints for the chat interface.

POST /api/sessions
Creates a new session. Returns {session_id: uuid, status: "active"}

POST /api/sessions/{session_id}/message
Body: {"message": "I want to fix Jira bugs"}
Steps:
1. Validate session exists
2. Invoke RuntimeLambda asynchronously via boto3:
   lambda_client.invoke(
     FunctionName=RUNTIME_LAMBDA_NAME,
     InvocationType="RequestResponse",  # synchronous — wait for Claude's response
     Payload=json.dumps({session_id, user_message: message})
   )
3. Return Lambda response: {message, status, approval_items}

GET /api/sessions/{session_id}
Returns: {session_id, status, approval_items, created_at}
(Does NOT return full conversation history — frontend polls this for status)

GET /api/sessions/{session_id}/messages
Returns: full conversation as list of {role, content, timestamp}
Frontend calls this to render the chat history.

POST /api/sessions/{session_id}/approve
Body: {"approved": true, "note": "optional reviewer note"}
Steps:
1. Fetch session, get approval_items
2. Invoke RuntimeLambda with a synthetic user message:
   "User approved all items. Note: {note}. Proceed with merge and production deploy."
3. Return runtime response
```

---

## Phase 4 — Chat Interface (~1.5 days)

### Task 4.1 — Chat UI core

**Copilot Prompt:**
```
Create /frontend/src/pages/Chat.jsx — the main ZeroBug chat interface.

On load:
  POST /api/sessions → get session_id, store in React state
  Show welcome message: "Hi, I'm ZeroBug. What do you want to fix today?"

Message input:
  Text input at bottom. Send on Enter or click.
  On send: POST /api/sessions/{session_id}/message
  Show a typing indicator while waiting for response (ZeroBug is thinking...)
  Display response when it arrives.

Message rendering:
  User messages: right-aligned, purple bubble
  ZeroBug messages: left-aligned, white card with ZeroBug avatar
  ZeroBug messages render as markdown (use react-markdown)
  Show timestamp in small grey text under each message

Credential request detection:
  If ZeroBug's message contains a request for credentials
  (detect phrases like "API token", "URL", "credentials", "token"),
  show an inline credential input form below the message:
    - Label auto-extracted from message context
    - Password-type input (hidden text)
    - "Save securely" button → POST /api/sessions/{session_id}/credentials
    - On save: show green "Saved" checkmark, resume conversation automatically
      by sending a confirmation message: "I've provided the {key}"

Progress updates:
  When ZeroBug is executing (status = "executing"),
  show a live activity bar under its avatar with text like
  "Connecting to Jira...", "Reading codebase...", "Writing fix..."
  Cycle through these every 3 seconds while waiting.

Session controls:
  Top right: "Clear session" button → DELETE /api/sessions/{session_id}
  then reload page.
```

---

### Task 4.2 — Approval card component

**What:** When ZeroBug has PRs ready, it surfaces an interactive approval card
inside the chat — not a separate page.

**Copilot Prompt:**
```
Create /frontend/src/components/ApprovalCard.jsx

Props: {sessionId, approvalItems: [{pr_url, diff, title, test_env_url,
        severity, explanation, ticket_id}]}

Renders an approval card inline in the chat:

Header:
  "Ready for your review" with amber dot indicator
  "{N} fixes ready to deploy"

For each item (expandable card):
  - Title and severity badge
  - Ticket ID linked to Jira
  - Agent explanation (2-3 sentences)
  - Test environment link (prominent button)
  - Diff preview: first 20 lines of unified diff in monospace
  - "Show full diff" toggle

Bottom actions:
  "Approve all and deploy" button (green, prominent)
  "Review individually" button (outline) — shows one at a time with approve/reject per item
  "Request changes" button (ghost) — opens text input, sends feedback back to ZeroBug

On "Approve all":
  POST /api/sessions/{session_id}/approve {approved: true}
  Replace card with: "Deploying to production..."
  Poll GET /api/sessions/{session_id} until status = "completed"
  Show: "All fixes deployed. Jira tickets closed." with green checkmark

On "Request changes":
  Send the feedback as a user message back into the conversation
  ZeroBug picks it up and revises the fixes
  The card disappears and the conversation resumes
```

---

### Task 4.3 — Activity sidebar

**What:** Shows what ZeroBug has done so far in this session — the transparency layer.

**Copilot Prompt:**
```
Create /frontend/src/components/ActivitySidebar.jsx

A collapsible right sidebar showing the session activity log.

Fetches GET /api/sessions/{session_id}/messages and filters for
messages that contain execution results (sandbox outputs).

Shows a timeline of actions Claude took:
  Each item: icon + action label + status + timestamp
  Examples:
    ✓ Connected to Jira (14 critical bugs found)
    ✓ Read codebase (auth.py, 342 lines)
    ✓ Wrote fix for JIRA-441 (SQL injection)
    ✓ Opened PR #87
    ✓ Deployed to staging (env URL)
    ⟳ Awaiting approval

Click any item to expand: shows the actual code Claude wrote and the result.
This is the proof that ZeroBug is doing real work, not faking it.

Toggle with a sidebar button. Collapsed by default on mobile, open on desktop.
```

---

## Phase 5 — Approval Flow (~0.5 day)

### Task 5.1 — Approval notification and email

**Copilot Prompt:**
```
Write /api/routes/approval.py and the SNS approval flow.

When RuntimeLambda publishes to ZeroBugApprovals SNS topic,
it includes:
{
  session_id, pr_urls: [...], test_env_url,
  summary: "3 critical security fixes ready",
  approval_url: "{API_BASE_URL}/sessions/{session_id}"
}

1. Configure SNS to send email to APPROVAL_EMAIL env var:
   Add email subscription to ZeroBugApprovals topic in CDK

2. Email content (plain text):
   Subject: "[ZeroBug] {N} fixes ready for your approval"
   Body: summary + approval_url
   "Click here to review and approve: {approval_url}"

3. The approval_url opens the chat interface, scrolled to the approval card.
   The user reviews inline and approves.
   No separate approval page — everything happens in the chat.

Also write a webhook option:
POST /api/webhooks/approve
Body: {"session_id": "...", "approved": true, "token": "webhook_secret"}
Validates webhook_secret against WEBHOOK_SECRET env var.
Calls the same approval logic as the chat UI.
Useful for: Slack bot integration, programmatic approval.
```

---

## Phase 6 — Demo Prep (~0.5 day)

### Task 6.1 — Demo conversation scripts

**Copilot Prompt:**
```
Create /demo-data/demo_conversations.md

Write 3 complete demo conversation scripts showing ZeroBug in action.
Format each as a realistic back-and-forth chat transcript.

Demo 1 — Jira bug fix:
  User opens chat, says "fix my critical Jira bugs"
  ZeroBug asks for Jira URL and token (one question at a time)
  ZeroBug reports what it found (3 critical bugs)
  ZeroBug fixes them, opens PRs, deploys to staging
  ZeroBug presents approval card
  User approves
  ZeroBug confirms deployment

Demo 2 — SAST report upload:
  User says "I have a SAST report, can you fix these?"
  ZeroBug asks for the report file and GitHub access
  User provides both
  ZeroBug reads the report, finds 2 SQL injection issues
  Fixes, PRs, staging, approval, done

Demo 3 — Mixed sources:
  User says "I have both Jira tickets and a security scan to fix"
  ZeroBug handles both in one session
  Show it creating different code for each source type at runtime

Include: talking points for each demo, what to highlight to judges,
timing estimates, and fallback plan if something fails live.
```

---

### Task 6.2 — Demo target setup

**Copilot Prompt:**
```
Create /demo-data/demo_setup.md

Step-by-step instructions to set up the demo environment:

1. Target repo setup:
   - Fork https://github.com/OWASP/WebGoat as the demo codebase
   - The repo has real, known vulnerabilities — perfect demo target
   - Set GITHUB_REPO env var to the forked repo

2. Jira demo project:
   - Create a free Jira Cloud account at atlassian.net
   - Create project: DEMO
   - Create 3 issues manually:
     DEMO-1: "SQL injection in login endpoint" (Critical)
     DEMO-2: "Hardcoded API key in config.py" (High)
     DEMO-3: "Missing auth check on /admin endpoint" (Critical)

3. Pre-demo checklist (run 30 minutes before):
   □ Lambda functions deployed and warm (invoke once each)
   □ DynamoDB table empty (clear any stale sessions)
   □ Jira project has the 3 demo tickets open
   □ GitHub fork is clean (no open PRs from previous runs)
   □ Staging environment is up and accessible
   □ Open the chat interface and do one full dry run
   □ Have credentials ready to paste (not in your head)

4. What to say to judges at each moment:
   - When ZeroBug asks for Jira URL: "Notice it only asks for what it needs, when it needs it"
   - When code appears in sidebar: "This is the code ZeroBug wrote at runtime — not pre-built"
   - When PR opens: "That's a real PR on GitHub — opened in the last 60 seconds"
   - When staging deploys: "Real environment, not a mock"
   - When approval card appears: "This is the only moment a human is involved"
```

---

### Task 6.3 — Error handling and resilience

**Copilot Prompt:**
```
Add resilience across the system for demo stability:

1. In /runtime/handler.py:
   - Wrap entire handler in try/except
   - On any unhandled error: append a recovery message to conversation:
     "I ran into an issue: {error}. Let me try a different approach."
     Then retry with a simplified version of what it was attempting.
   - Never surface raw stack traces to the user
   - Max 3 retries on sandbox execution failures before telling user

2. In /sandbox/executor.py:
   - On import errors (library not available):
     return {error: "library_not_available", detail: "requests not found"}
     Claude will see this and rewrite using a different approach
   - On network timeout to external APIs:
     return {error: "network_timeout", detail: "Jira API did not respond in 30s"}

3. In /frontend/src/pages/Chat.jsx:
   - If POST /message takes >30s: show "Still working, this might take a moment..."
   - If response fails: show "Something went wrong. Try sending your message again."
     with a retry button that re-sends the last message
   - Never show a blank screen or silent failure

4. Add a /api/health endpoint:
   Returns {status: "ok", bedrock: "ok", dynamodb: "ok", sandbox: "ok"}
   Check each service with a lightweight ping.
   Include in pre-demo checklist.
```

---

## How to Pitch the Evolution to Judges

When judges say "your submission showed a fixed pipeline, this is different":

> "You're right. We submitted a pipeline architecture. Then we asked ourselves
> a harder question: why are we pre-building connectors that an AI should figure
> out itself? So we rebuilt it. Same goal — fix bugs autonomously. Different
> architecture — Claude creates whatever connectors it needs at runtime.
>
> The result is a system that works for any bug source, any issue tracker,
> any codebase — without a single line of integration code written in advance.
> That's not a deviation from our submission. That's the submission taken
> to its logical conclusion."

**Lead the demo with the chat.** Don't explain the architecture first.
Let the judge watch ZeroBug have a conversation, ask for a Jira token,
write code, open a PR, and ask for approval — and then explain what just happened.
Show first. Explain second.

---

## Copilot Usage Tips

Always append to prompts:
> "Use the existing project structure. Load credentials via the session's
> credential store, not hardcoded values or env vars directly.
> The sandbox is the only way to call external APIs — never call them
> directly from the runtime or API Lambda.
> Follow patterns already established in the codebase."

When building the runtime loop, paste the system prompt content into context:
> "Here is the system prompt Claude uses: {paste ZEROBUG_SYSTEM_PROMPT}.
> Make sure the handler correctly parses all special tags Claude uses."

After Phase 3 is working end-to-end (even with a simple test message),
freeze that code and don't touch it while building the frontend.
The runtime loop is the foundation — don't iterate on it while the UI is in flux.

---

## Team Split

| Person | Owns |
|--------|------|
| Dev 1 | Phase 1 (infra + CDK + DynamoDB) + Phase 5 (approval flow) |
| Dev 2 | Phase 2 (sandbox executor — all tasks) |
| Dev 3 | Phase 3 (Claude runtime loop — all tasks) |
| Dev 4 | Phase 4 (chat interface + approval card + sidebar) |
| Dev 2 + Dev 3 | Integration: wire sandbox into runtime loop (pair program) |
| All | Phase 6 (demo prep + dry run together) |

> **The sandbox and runtime must be integrated and tested together before
> anyone builds UI on top of them.** Dev 2 and Dev 3 need to
> deliver a working end-to-end terminal test (no UI) by end of day 3.
> Everything else depends on it.

---

*The user talks. ZeroBug builds what it needs. The work gets done.*
