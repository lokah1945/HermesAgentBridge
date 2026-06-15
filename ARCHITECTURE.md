# ARCHITECTURE

## Final Directory Structure
```
/hermes
├── /server              # Core HTTP server (Express/Native Node) & routing
├── /runtime             # Agent execution engine (Planner, Executor, Memory)
├── /tools               # Tool implementations (fs, terminal, git, search)
├── /adapter             # Editor compatibility layer (OpenAI, VSCode)
├── /extensions
│   └── /vscode          # Installable .vsix extension (Panel, Inline, Agent)
├── /shared              # Shared types, validation schemas, constants
├── /config              # hermes.config.json parser & defaults
└── /docs                # Documentation (ARCHITECTURE, API, INSTALL)
```
**Justification:** This structure strictly separates the execution engine (`/runtime`) from the transport layer (`/server` and `/adapter`), ensuring the agent logic is not tightly coupled to HTTP. `/shared` prevents code duplication between the extension and the server.

## Component Interface Map

| Component | Input | Output | Description |
|-----------|-------|--------|-------------|
| **Server** | HTTP Requests (REST/SSE) | HTTP Responses / SSE Stream | Acts as the main entry point for the extension. Routes to Adapter or Runtime. |
| **Runtime** | `task`, `workspace_context`, `mode` | `Stream<AgentEvent>` | Orchestrates planning, tool calling, and validation. |
| **Tools** | `tool_name`, `params` | `ExecutionResult` | Executes low-level tasks (read file, run command, git commit). |
| **Adapter** | Standard HTTP JSON | Transformed internal formats | Maps OpenAI API formats or custom VSCode protocol to the internal Runtime. |
| **VSCode Ext** | User Input / Workspace State | HTTP Requests | Manages the UI, sends context to the server, and renders SSE events. |

## Technology Stack

| Layer | Technology | Reason | Existing/New |
|-------|------------|--------|--------------|
| **Server** | Node.js + Express | Lightweight, reliable HTTP & SSE routing without heavy frameworks. | New |
| **Language** | TypeScript | Type safety across client and server (via `/shared`). | New |
| **LLM Client**| OpenAI SDK | Native standard for calling OpenAI-compatible endpoints internally. | New |
| **Extension** | VSCode Extension API + Webview UI | Minimal dependencies for the client side. HTML/CSS/JS for Webview panel. | New |
| **Monorepo** | NPM Workspaces | Simplifies dependency management across server and extension. | New |

## Data Flow Diagrams

### 1. Agent Task Execution (Hybrid Mode)
1. **User (VSCode)** inputs a task via Chat Panel.
2. **VSCode Ext** gathers workspace context (active file, tree) and sends `POST /v1/agent/run` to **Server**.
3. **Server** routes request to **Runtime**.
4. **Runtime (Planner)** deconstructs task -> yields `plan` event (SSE).
5. **VSCode Ext** renders the plan.
6. **Runtime (Executor)** starts executing step 1 -> generates file modifications.
7. **Runtime** yields `diff` event and `awaiting_approval` event (SSE).
8. **User (VSCode)** clicks "Approve".
9. **VSCode Ext** sends approval to **Server**.
10. **Runtime** executes the file change using **Tools (fs)**.
11. Loop continues until `done` event.

### 2. Workspace Context Extraction
1. **VSCode Ext** listens to active editor changes.
2. Periodically, or right before a prompt, it gathers active file path, selected text, and workspace root.
3. Transmits context payload alongside the chat message.

## Decisions & Trade-offs
1. **SSE over WebSockets:** We chose Server-Sent Events (SSE) for streaming agent responses because agent flows are primarily unidirectional (Server -> Client). Approvals are handled via standard POST requests, reducing the complexity of stateful WebSocket management.
2. **NPM Workspaces over Lerna/Turbo:** Keeps the tooling extremely minimal and dependency-free for local development.
3. **No External DB:** Session memory and configurations will be stored in local JSON/SQLite files to respect the "no unnecessary database" hard constraint.
