# HERMES ILMA — PHASE 3: LLM INTEGRATION
**Repo:** https://github.com/lokah1945/HermesAgentBridge  
**Precondition:** Phase 1–2 complete. Server, extension, tools, SSE infrastructure all working.

---

## CURRENT STATE

Read these files first before doing anything else:

```
ARCHITECTURE.md         → component map & tech decisions (authoritative)
TEST_REPORT.md          → what works, what's broken
config/hermes.config.json
package.json
server/          → scan all .ts files
runtime/         → scan all .ts files
tools/           → scan all .ts files
```

**Known blocker (from TEST_REPORT):**
> "Fitur LLM saat ini masih memantulkan pseudo-stub data. Belum disambungkan ke Local LLM Engine."

The agent has no brain. Infrastructure exists, LLM call does not.

---

## OBJECTIVE

Wire a real LLM into the agent runtime so that:

1. `POST /v1/agent/run` → calls LLM → returns real plan
2. `POST /v1/chat/completions` → calls LLM → streams real response
3. `POST /v1/tools/execute` → executes, returns real result
4. All three work end-to-end without any external provider

---

## DECISION (ALREADY MADE — DO NOT DEBATE)

**LLM Backend: Ollama (OpenAI-compatible)**

```
Base URL : http://localhost:11434/v1
API Key  : ollama (literal string)
Model    : configurable via hermes.config.json
SDK      : openai (npm package, supports baseURL override)
```

This satisfies self-hosted requirement with zero new architecture.  
The OpenAI SDK just points to Ollama instead of api.openai.com.

---

## IMPLEMENTATION TASKS

Execute in this exact order.

### TASK 1 — Install Dependency

```bash
npm install openai
```

Verify `package.json` now includes `"openai"` in dependencies.

---

### TASK 2 — Update Config

Add `llm` block to `config/hermes.config.json`:

```json
{
  "llm": {
    "baseUrl": "http://localhost:11434/v1",
    "apiKey": "ollama",
    "model": "llama3.2",
    "timeout": 60000
  }
}
```

Do not hardcode these values anywhere else. Always read from config.

---

### TASK 3 — Create LLM Client

Create `server/adapter/llm.ts` (or refactor existing stub):

**Contract:**

```typescript
interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface LLMStreamOptions {
  messages: LLMMessage[];
  onChunk: (delta: string) => void;
  onDone: () => void;
  onError: (err: Error) => void;
}

// Exported functions:
export async function chat(messages: LLMMessage[]): Promise<string>
export async function chatStream(options: LLMStreamOptions): Promise<void>
```

**Implementation requirements:**
- Use `new OpenAI({ baseURL, apiKey })` from config
- `chat()` → non-streaming, returns full string response
- `chatStream()` → SSE-friendly, calls `onChunk` per delta token
- Wrap in try/catch, surface errors via `onError`
- Log model name + token count on completion (console.log is fine)

---

### TASK 4 — Create Planner

Create or replace `runtime/planner.ts`:

**What it does:**
Receives a `task` (string) and `workspace_context` (object), calls LLM, returns a structured plan.

**System prompt for Hermes ILMA** (embed as constant in this file):

```
You are ILMA, a coding agent embedded in the Hermes platform.
You receive a user task and workspace context.
Your response MUST be valid JSON only. No markdown, no explanation.

Response format:
{
  "goal": "one-sentence summary of what will be done",
  "steps": [
    {
      "id": "1",
      "action": "read_file | write_file | run_command | search | explain",
      "target": "file path or command string",
      "description": "what this step does",
      "mode": "auto | review"
    }
  ]
}

Rules:
- read_file and search are always mode: auto
- write_file, run_command are always mode: review
- Maximum 6 steps per plan
- Target paths must be relative to workspace root
- Never include credential exposure or system-level destructive actions
```

**Function signature:**

```typescript
export async function createPlan(
  task: string,
  workspaceContext: WorkspaceContext,
  sessionId: string
): Promise<AgentPlan>
```

Where `AgentPlan` matches the JSON schema above. Parse LLM output as JSON. If parse fails, retry once. If retry fails, return error event via SSE.

---

### TASK 5 — Create Code Generator

Create or replace `runtime/executor.ts`:

For steps with `action: "write_file"`, call LLM to generate actual file content.

**System prompt for code generation** (embed in this file):

```
You are ILMA, a coding agent. You are executing a specific file write step.
Generate the complete file content that fulfills the step description.
Respond with ONLY the file content. No explanation, no markdown fences.
The content will be written directly to the file system.
Use the language/framework inferred from the file extension and workspace context.
```

**Function signature:**

```typescript
export async function executeStep(
  step: AgentStep,
  workspaceContext: WorkspaceContext,
  conversationHistory: LLMMessage[]
): Promise<ExecutionResult>
```

Where `ExecutionResult` is:

```typescript
interface ExecutionResult {
  stepId: string;
  status: 'success' | 'error' | 'pending_approval';
  output?: string;       // generated content or command output
  diff?: Diff;           // for write_file steps
  error?: string;
}
```

---

### TASK 6 — Wire Into Agent Route

Find the existing `POST /v1/agent/run` handler. Replace stub logic with real flow:

```
1. Validate request (session_id, task, workspace)
2. Extract workspace context (call existing workspace tool)
3. Call planner.createPlan(task, context, session_id)
4. Stream plan event: SSE { event: "plan", data: AgentPlan }
5. For each step in plan:
   a. If step.mode === "auto" OR mode param is "auto":
      → executor.executeStep(step, context, history)
      → stream result event
   b. If step.mode === "review":
      → stream diff event: SSE { event: "diff", data: { step, before, after } }
      → stream awaiting_approval event
      → PAUSE and wait for POST /v1/agent/approve/:sessionId/:stepId
6. After all steps done:
   → stream done event
```

Add the approval endpoint if it doesn't exist:

```
POST /v1/agent/approve/:sessionId/:stepId
POST /v1/agent/reject/:sessionId/:stepId
```

These resume or skip the pending step in the session's execution queue.

---

### TASK 7 — Wire Chat Completions

Find the existing `POST /v1/chat/completions` handler. Replace stub with:

```typescript
// If stream: true
await chatStream({
  messages: req.body.messages,
  onChunk: (delta) => res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`),
  onDone: () => { res.write('data: [DONE]\n\n'); res.end(); },
  onError: (err) => { res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`); res.end(); }
});

// If stream: false
const content = await chat(req.body.messages);
res.json({ choices: [{ message: { role: 'assistant', content } }] });
```

---

### TASK 8 — Fix Cross-Platform Search

Find `tools/search.ts`. Replace `grep` command with cross-platform logic:

```typescript
const isWindows = process.platform === 'win32';
const cmd = isWindows
  ? `findstr /s /i /n "${query}" "${path}\\*"`
  : `grep -rn "${query}" "${path}"`;
```

---

## VERIFY

After all tasks complete, run these checks in order:

```bash
# 1. Server starts
npx ts-node server/index.ts
# Expected: "Hermes server running on port 3000"

# 2. Models endpoint
curl http://localhost:3000/v1/models
# Expected: { "data": [{ "id": "hermes-ilma" }] }

# 3. Chat completions (requires Ollama running)
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"hermes-ilma","messages":[{"role":"user","content":"halo"}],"stream":false}'
# Expected: real LLM response, NOT stub

# 4. Agent run (requires Ollama running)
curl -X POST http://localhost:3000/v1/agent/run \
  -H "Content-Type: application/json" \
  -d '{"session_id":"test-001","task":"buat file hello.ts yang print hello world","workspace":{"root":"/tmp/test"},"mode":"auto"}'
# Expected: SSE stream with real plan steps, NOT hardcoded
```

**FAIL criteria:**
- Response contains "stub", "mock", "placeholder", "TODO" → FAIL
- Plan steps are always identical regardless of task input → FAIL  
- LLM error because Ollama not running → EXPECTED, document in KNOWN_ISSUES

---

## DONE DEFINITION

This phase is complete when:

```
✅ npm install openai → openai in package.json
✅ hermes.config.json has llm block
✅ server/adapter/llm.ts exists with real OpenAI client
✅ runtime/planner.ts uses LLM to generate plan from task
✅ runtime/executor.ts uses LLM to generate code for write_file steps
✅ POST /v1/chat/completions streams real LLM output
✅ POST /v1/agent/run returns real plan from LLM
✅ POST /v1/agent/approve and /reject endpoints exist
✅ Cross-platform search fix in tools/search.ts
✅ All 4 curl verify commands pass (with Ollama running)
```

Update `TEST_REPORT.md` Known Issues to reflect actual status after completion.

---

## CONSTRAINTS (CARRY OVER)

- Do not add new npm packages beyond `openai`
- Do not create new database or file storage
- Do not change directory structure
- If existing code is close to target, refactor — do not rewrite from scratch
- Every file write must show diff before applying

---

## OUTPUT FORMAT

For each task completed, report:

```
TASK N — [NAME]
Files modified: [list]
Status: DONE | SKIP (already correct) | BLOCKED (reason)
```

Report BLOCKED immediately. Do not proceed past a blocker without surfacing it.
