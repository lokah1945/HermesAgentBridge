# Hermes Agent Bridge 🚀

Hermes Agent Bridge is a self-hosted, autonomous coding agent platform running the **ILMA** profile. It serves as a drop-in execution engine replacing third-party AI agents (like Cursor, Blackbox, or Copilot), ensuring that your reasoning, orchestration, planning, and code generation remain entirely within your own local control and infrastructure.

## 🌟 Key Features

- **Autonomous Agent Execution:** Full Plan -> Diff -> Approve -> Execute cycle natively handled.
- **VSCode Extension Included:** A lightweight, custom-built extension seamlessly integrates Hermes straight into your editor's sidebar via an interactive Chat Panel.
- **No Vendor Lock-in:** Native Node.js & Express server with no unnecessary external database or complex middleware.
- **Real-Time Streaming:** Built with native Server-Sent Events (SSE) for fast, responsive live-streaming of Agent plans and outputs.
- **Safe "Review Mode":** Automatically pauses before modifying any of your workspace files, requiring user validation (Diff Preview).

## 🛠️ Architecture Overview

The system is separated into a core runtime and an editor adapter layer:
- **`/server`:** Express HTTP Server + SSE Event router.
- **`/runtime`:** Core planning and orchestration logic.
- **`/tools`:** Action executors (`filesystem`, `terminal`, `git`, `search`).
- **`/extensions/vscode`:** The Webview + VSCode Extension client.

> Read the full [Architecture Design](ARCHITECTURE.md) for deeper insights.

## 📦 Installation & Setup

Read our comprehensive [Install Guide](INSTALL.md) to set up the Hermes server and compile the VSCode extension.

### Quick Start
1. Clone the repository and install dependencies:
   ```bash
   npm install
   ```
2. Start the core server:
   ```bash
   npm run start
   # or
   npx ts-node server/index.ts
   ```
3. Load the `.vsix` extension into VSCode.

## 📄 Documentation

- [System Audit](SYSTEM_AUDIT.md) - Analysis of the Hermes infrastructure goals.
- [Architecture](ARCHITECTURE.md) - Component map and Data flows.
- [Test Report](TEST_REPORT.md) - E2E Acceptance Test results.
- [Master Prompt](HERMES_ILMA_MASTER_PROMPT.md) - The original blueprint.

---
*Built autonomously using the Hermes ILMA AI Coding Workflow.*
