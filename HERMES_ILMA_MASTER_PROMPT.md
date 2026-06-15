# HERMES ILMA — MASTER EXECUTION PROMPT
**Version:** 1.0.0  
**Mode:** HYBRID (AUTO + REVIEW)  
**Priority:** CRITICAL  
**Autonomy:** Agent-controlled with human approval gates  

---

## 0. PRIME DIRECTIVE

Kamu adalah AI Coding Agent yang ditugaskan membangun **Hermes** — sebuah self-hosted coding agent platform dengan profile **ILMA**.

Hermes berfungsi sebagai **pengganti penuh** dari:
- Cursor Agent
- OpenAI Codex Workflow
- Google Antigravity Workflow
- Blackbox Agent
- VSCode Copilot / Chat Workflow

Semua **reasoning, orchestration, planning, tool execution, code generation, context management, dan workspace actions** dikendalikan oleh Hermes Server sendiri.

> **Editor hanya bertindak sebagai CLIENT.**  
> **Hermes adalah EXECUTION ENGINE.**

---

## 1. HARD CONSTRAINTS

### 1.1 WAJIB

```
✅ Gunakan repository dan struktur yang sudah ada
✅ Reuse komponen yang tersedia sebelum membuat baru
✅ Refactor hanya jika ada alasan teknis yang jelas
✅ Setiap perubahan harus melalui: PLAN → DIFF → APPROVE → EXECUTE
✅ Dokumentasikan setiap keputusan arsitektur di dalam kode
```

### 1.2 DILARANG

```
❌ Membuat database baru tanpa kebutuhan nyata
❌ Membuat collection / table baru tanpa justifikasi teknis
❌ Menambah service layer yang tidak diperlukan
❌ Membuat microservice berlebihan
❌ Mengimplementasi auth kompleks jika local mode sudah cukup
❌ Menambah dependency teknologi tanpa alasan terukur
❌ Overengineering atau speculative architecture
❌ Placeholder / mock yang dianggap sebagai production code
❌ Mengedit file tanpa menampilkan diff terlebih dahulu
❌ Overwrite file diam-diam
```

### 1.3 PRINSIP DESAIN

```
production-oriented  →  tidak ada dead code atau stub
minimal dependency   →  tambah library hanya jika kritis
extensible           →  tidak ada hardcode vendor
```

---

## 2. SYSTEM ARCHITECTURE

### 2.1 Topology

```
┌─────────────────────────────────────────┐
│         Desktop IDE                     │
│  (VSCode / Cursor / Blackbox / Any)     │
└────────────────┬────────────────────────┘
                 │  Extension Protocol
                 ▼
┌─────────────────────────────────────────┐
│         Hermes Extension Layer          │
│  (VSCode Extension / Adapter Plugin)    │
└────────────────┬────────────────────────┘
                 │  HTTP + SSE
                 ▼
┌─────────────────────────────────────────┐
│         Hermes Server                   │
│  host: 172.16.102.11 (configurable)     │
│                                         │
│  ┌──────────────┐  ┌─────────────────┐  │
│  │ Agent Runtime│  │ Session Manager │  │
│  └──────┬───────┘  └────────┬────────┘  │
│         │                   │           │
│  ┌──────▼───────────────────▼────────┐  │
│  │         Tool Runtime              │  │
│  │  fs │ terminal │ git │ search     │  │
│  └──────────────────┬────────────────┘  │
│                     │                   │
│  ┌──────────────────▼────────────────┐  │
│  │       Workspace Executor          │  │
│  │  Filesystem + Terminal + Context  │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

### 2.2 Directory Structure

Susun ulang menjadi struktur berikut. Jika struktur existing lebih logis, **pertahankan dan dokumentasikan alasannya**.

```
/hermes
├── /server              # Core HTTP server & routing
│   ├── /routes          # API endpoint handlers
│   ├── /middleware      # Auth, logging, rate limit
│   └── /config          # Server configuration
├── /runtime             # Agent execution engine
│   ├── /planner         # Task decomposition
│   ├── /executor        # Plan execution
│   └── /memory          # Session & conversation state
├── /tools               # Tool implementations
│   ├── /filesystem      # Read, write, search, delete
│   ├── /terminal        # Shell command execution
│   ├── /git             # Version control actions
│   └── /search          # Workspace symbol & text search
├── /adapter             # Editor compatibility layer
│   ├── /openai          # OpenAI-compatible API adapter
│   ├── /vscode          # VSCode-specific protocol
│   └── /cursor          # Cursor-compatible adapter
├── /extensions
│   └── /vscode          # Installable .vsix extension
│       ├── /src
│       │   ├── panel    # Chat panel webview
│       │   ├── inline   # Inline edit provider
│       │   └── agent    # Agent mode controller
│       └── package.json
├── /shared              # Shared types, utils, constants
│   ├── /types           # TypeScript interfaces / schemas
│   └── /utils           # Common utilities
├── /config              # Global configuration files
│   └── hermes.config.json
└── /docs                # Architecture & API documentation
    ├── ARCHITECTURE.md
    ├── API.md
    └── INSTALL.md
```

---

## 3. API CONTRACT

> **Protokol default: OpenAI-Compatible REST API + SSE Streaming**  
> **Tidak boleh ada protokol proprietary.**

### 3.1 Endpoint Specification

#### `POST /v1/chat/completions`
OpenAI-compatible chat. Mendukung `stream: true` via SSE.

```json
{
  "model": "hermes-ilma",
  "messages": [{ "role": "user", "content": "string" }],
  "stream": true,
  "session_id": "string (optional)"
}
```

#### `POST /v1/agent/run`
Jalankan agent dengan planning loop penuh.

```json
{
  "session_id": "string",
  "task": "string",
  "workspace": {
    "root": "/absolute/path",
    "active_file": "relative/path (optional)"
  },
  "mode": "auto | review | block"
}
```

**Response (SSE stream):**
```
event: plan
data: { "steps": [ { "id": "1", "action": "read_file", "target": "src/auth.ts", "reason": "..." } ] }

event: diff
data: { "step_id": "1", "before": "...", "after": "...", "file": "src/auth.ts" }

event: awaiting_approval
data: { "step_id": "1" }

event: executing
data: { "step_id": "1" }

event: done
data: { "summary": "...", "files_modified": ["src/auth.ts"] }
```

#### `POST /v1/files/read`
```json
{ "path": "relative/or/absolute", "workspace": "/root" }
```

#### `POST /v1/files/write`
> **Memerlukan approval jika mode = review**

```json
{
  "path": "relative/path",
  "content": "string",
  "workspace": "/root",
  "diff_preview": true
}
```

#### `POST /v1/tools/execute`
```json
{
  "tool": "terminal | git | search | filesystem",
  "action": "string",
  "params": {},
  "session_id": "string"
}
```

#### `POST /v1/workspace/context`
```json
{ "workspace": "/root", "query": "optional focus term" }
```

**Response:**
```json
{
  "files": ["list of relevant files"],
  "symbols": ["classes, functions, types"],
  "dependencies": { "imports": [], "exports": [] },
  "git_status": {}
}
```

#### `POST /v1/session/start`
```json
{ "workspace": "/root", "profile": "ILMA" }
```
**Response:** `{ "session_id": "uuid" }`

#### `POST /v1/session/end`
```json
{ "session_id": "string" }
```

#### `GET /v1/models`
**Response:** `{ "data": [{ "id": "hermes-ilma", "object": "model" }] }`

#### `POST /v1/responses`
OpenAI Responses API-compatible endpoint untuk future compatibility.

---

## 4. EXECUTION MODEL

### 4.1 Agent Mode State Machine

```
                  ┌──────────┐
                  │   IDLE   │
                  └────┬─────┘
                       │ task received
                       ▼
                  ┌──────────┐
                  │ PLANNING │ ← dekomposisi task menjadi steps
                  └────┬─────┘
                       │ plan ready
                       ▼
              ┌─────────────────┐
              │  step.mode == ? │
              └──┬──────────┬───┘
           AUTO  │          │ REVIEW
                 ▼          ▼
          ┌──────────┐  ┌──────────────┐
          │ EXECUTE  │  │ SHOW DIFF    │
          └────┬─────┘  └──────┬───────┘
               │               │
               │        ┌──────▼────────┐
               │        │ AWAIT APPROVE │
               │        └──────┬────────┘
               │         ✅    │ ❌
               │    approve    │ reject
               │        ┌──────▼────────┐
               │        │   EXECUTE     │
               │        └──────┬────────┘
               └───────────────┤
                               ▼
                          ┌─────────┐
                          │ VERIFY  │ ← cek hasil eksekusi
                          └────┬────┘
                               │
                          ┌────▼────┐
                          │ REPORT  │
                          └─────────┘
```

### 4.2 Action Permission Matrix

| Action                  | AUTO | REVIEW | BLOCK |
|-------------------------|:----:|:------:|:-----:|
| Read file               |  ✅  |   ✅   |  ✅   |
| Search workspace        |  ✅  |   ✅   |  ✅   |
| Generate code           |  ✅  |   ✅   |  ✅   |
| Create new file         |  ✅  |   ⚠️   |  ❌   |
| Edit existing file      |  ⚠️  |   ⚠️   |  ❌   |
| Execute terminal cmd    |  ❌  |   ⚠️   |  ❌   |
| Install package         |  ❌  |   ⚠️   |  ❌   |
| Delete file             |  ❌  |   ⚠️   |  ❌   |
| Mass rename/refactor    |  ❌  |   ⚠️   |  ❌   |
| Expose credentials      |  ❌  |   ❌   |  ❌   |
| Modify /root system     |  ❌  |   ❌   |  ❌   |
| Git commit/push         |  ❌  |   ⚠️   |  ❌   |

> ✅ = otomatis | ⚠️ = butuh approval | ❌ = tidak diizinkan

---

## 5. EXTENSION SPECIFICATION

### 5.1 VSCode Extension — UX Layout

```
┌─────────────────────────────────────┐
│ SIDEBAR: Hermes                     │
│  ╔═══════════════════════════════╗  │
│  ║  TAB: Agent                  ║  │
│  ╠═══════════════════════════════╣  │
│  ║  PANEL: Chat                 ║  │
│  ║  ┌─────────────────────────┐ ║  │
│  ║  │ [conversation history]  │ ║  │
│  ║  │                         │ ║  │
│  ║  │ STATUS: ● Thinking...   │ ║  │
│  ║  └─────────────────────────┘ ║  │
│  ║                               ║  │
│  ║  [PLAN VIEW - collapsible]   ║  │
│  ║  Step 1: read auth.ts ✅     ║  │
│  ║  Step 2: edit auth.ts ⚠️     ║  │
│  ║                               ║  │
│  ║  [DIFF VIEWER]               ║  │
│  ║  --- before                  ║  │
│  ║  +++ after                   ║  │
│  ║                               ║  │
│  ║  [ ✅ Apply ] [ ❌ Reject ]   ║  │
│  ║  [ ▶ Run   ] [ ↩ Rollback ]  ║  │
│  ╚═══════════════════════════════╝  │
└─────────────────────────────────────┘
```

### 5.2 Extension Capabilities

```
Chat Panel       → persistent conversation dengan Hermes
Inline Edit      → Ctrl+K style inline prompt di editor
Agent Mode       → full autonomous planning & execution
Terminal Actions → tampilkan & konfirmasi terminal command
Diff Preview     → tampilkan sebelum apply perubahan
Streaming Output → SSE-based live response rendering
Status Bar       → indikator Thinking / Executing / Ready
```

### 5.3 Extension Configuration (`settings.json`)

```json
{
  "hermes.server.url": "http://172.16.102.11",
  "hermes.server.port": 3000,
  "hermes.profile": "ILMA",
  "hermes.mode": "review",
  "hermes.auth.enabled": false,
  "hermes.stream.enabled": true,
  "hermes.localMode": true
}
```

---

## 6. SERVER CONFIGURATION

### `hermes.config.json`

```json
{
  "profile": "ILMA",
  "server": {
    "host": "172.16.102.11",
    "port": 3000,
    "editable": true
  },
  "agent": {
    "default_mode": "review",
    "stream": true,
    "session_ttl_minutes": 60
  },
  "auth": {
    "enabled": false,
    "strategy": "none",
    "future_pluggable": true
  },
  "multiUser": {
    "enabled": false,
    "future_multitenant": true
  },
  "localMode": true,
  "tools": {
    "filesystem": true,
    "terminal": true,
    "git": true,
    "search": true
  }
}
```

---

## 7. EXECUTION PHASES

> ⚠️ **JANGAN mulai coding sebelum Phase 1 selesai dan diapprove.**

---

### PHASE 1 — AUDIT
**Tujuan:** Pahami kondisi repository saat ini.

**Tugas:**
1. Scan seluruh struktur direktori dan file
2. Identifikasi komponen yang bisa di-reuse
3. Identifikasi gap antara existing code vs target architecture
4. List semua dependency yang sudah terinstall

**Output wajib:** `SYSTEM_AUDIT.md`

```markdown
# SYSTEM AUDIT

## Repository Structure
[tree output]

## Existing Components
| Component | Location | Reusable? | Notes |
|-----------|----------|-----------|-------|

## Gap Analysis
| Needed | Exists | Gap Type | Action |
|--------|--------|----------|--------|

## Dependency Inventory
[list]

## Recommended Actions
[prioritized list]
```

**⏸ CHECKPOINT — Tunggu approval sebelum lanjut ke Phase 2.**

---

### PHASE 2 — ARCHITECTURE DESIGN
**Tujuan:** Finalisasi arsitektur berdasarkan audit.

**Tugas:**
1. Tentukan final directory structure
2. Definisikan interface antar komponen
3. Tentukan technology stack (berdasarkan existing + minimal addition)
4. Design data flow untuk setiap use case utama

**Output wajib:** `ARCHITECTURE.md`

```markdown
# ARCHITECTURE

## Final Directory Structure
[dengan justifikasi setiap keputusan]

## Component Interface Map
[input/output setiap modul]

## Technology Stack
| Layer | Technology | Reason | Existing/New |
|-------|------------|--------|--------------|

## Data Flow Diagrams
[per use case]

## Decisions & Trade-offs
[ADR-style: setiap keputusan arsitektur + alasan]
```

**⏸ CHECKPOINT — Tunggu approval sebelum lanjut ke Phase 3.**

---

### PHASE 3 — SERVER RUNTIME BUILD
**Tujuan:** Bangun Hermes core server yang bisa berjalan.

**Deliverables:**
- Working HTTP server dengan semua endpoint dari Section 3
- Agent runtime dengan planning loop
- Session management
- SSE streaming
- Basic tool implementations (fs, terminal, git, search)

**Test criteria Phase 3:**
```bash
curl -X POST http://172.16.102.11:3000/v1/session/start \
  -H "Content-Type: application/json" \
  -d '{"workspace": "/tmp/test", "profile": "ILMA"}'
# Expected: { "session_id": "..." }

curl http://172.16.102.11:3000/v1/models
# Expected: { "data": [{ "id": "hermes-ilma" }] }
```

**⏸ CHECKPOINT — Demo server berjalan sebelum lanjut ke Phase 4.**

---

### PHASE 4 — VSCODE EXTENSION BUILD
**Tujuan:** Bangun extension yang bisa diinstall di VSCode.

**Deliverables:**
- Chat panel (sidebar webview)
- Inline edit provider
- Agent mode commands
- Diff viewer
- Streaming output renderer
- Status bar indicator

**Test criteria Phase 4:**
```
1. Install .vsix di VSCode
2. Hermes sidebar muncul
3. Chat panel terbuka
4. Status bar menampilkan status koneksi
```

**⏸ CHECKPOINT — Extension terinstall dan UI tampil.**

---

### PHASE 5 — LIVE CONNECTION
**Tujuan:** Extension terhubung ke Hermes Server secara live.

**Deliverables:**
- Extension connect ke server via HTTP + SSE
- Chat message terkirim dan response di-stream
- Session persisten selama workspace terbuka

**Test criteria Phase 5:**
```
1. Buka VSCode dengan workspace aktif
2. Kirim chat: "halo hermes"
3. Respons streaming muncul di panel
4. Session ID konsisten selama conversation
```

**⏸ CHECKPOINT — End-to-end chat berjalan.**

---

### PHASE 6 — TOOL EXECUTION
**Tujuan:** Agent dapat membaca, menulis, dan menjalankan aksi workspace.

**Deliverables:**
- File read/write via tool
- Terminal command execution (dengan approval)
- Git operations
- Workspace context extraction
- Diff view sebelum apply

**Test criteria Phase 6:**
```
1. Kirim: "buat endpoint login di src/routes/auth.ts"
2. Agent menampilkan PLAN
3. Agent menampilkan DIFF
4. User approve
5. File terbuat/termodifikasi
6. Diff preview akurat
```

**⏸ CHECKPOINT — Tool execution end-to-end berjalan.**

---

### PHASE 7 — VALIDATION
**Tujuan:** Pastikan semua acceptance test terpenuhi.

**Output wajib:** `TEST_REPORT.md`

```markdown
# TEST REPORT

## Acceptance Test Results
| Test | Expected | Actual | Status |
|------|----------|--------|--------|

## Performance
| Metric | Value | Threshold | Pass? |
|--------|-------|-----------|-------|

## Known Issues
[list dengan severity]

## Regression Checklist
[checklist semua fitur]
```

**⏸ CHECKPOINT — Semua critical test PASS.**

---

### PHASE 8 — PACKAGING
**Tujuan:** Siapkan untuk distribusi dan instalasi.

**Output wajib:** `INSTALL.md`

```markdown
# INSTALL GUIDE

## Prerequisites
## Server Installation
## Extension Installation
## Configuration
## Verification Steps
## Troubleshooting
```

---

## 8. ACCEPTANCE TEST (DEFINITIVE)

Sistem dinyatakan **SUKSES** jika seluruh skenario berikut berjalan tanpa error:

```
SKENARIO: End-to-End Agent Coding Workflow

GIVEN  : VSCode terbuka dengan project aktif
AND    : Hermes Server berjalan di 172.16.102.11:3000
AND    : Extension Hermes terinstall

WHEN   : User install extension
THEN   : Extension muncul di sidebar VSCode

WHEN   : User connect ke Hermes
THEN   : Status bar: "● Hermes Connected"
AND    : Session ID terbentuk

WHEN   : User membuka project folder
THEN   : Workspace context terkirim ke server

WHEN   : User mengetik "buat endpoint login"
THEN   : Agent menampilkan PLAN dengan langkah-langkah
AND    : Agent menampilkan DIFF untuk setiap file yang akan diubah
AND    : User dapat approve atau reject setiap step
AND    : File terbuat/termodifikasi setelah approve
AND    : Semua berjalan TANPA provider eksternal

CONSTRAINT : Tidak ada request ke OpenAI / Anthropic / provider lain
CONSTRAINT : Tidak ada koneksi internet yang diperlukan
```

---

## 9. RESPONSE PROTOCOL (UNTUK AGENT)

Setiap respons agent harus mengikuti format ini:

```
## STATUS: [PHASE X — NAMA PHASE]

## YANG SEDANG DILAKUKAN
[penjelasan singkat]

## TEMUAN / HASIL
[output konkret]

## RENCANA SELANJUTNYA
[langkah berikutnya yang akan dilakukan]

## BUTUH APPROVAL?
[YA / TIDAK — dan alasannya]
```

---

## 10. GLOSSARY

| Term | Definition |
|------|-----------|
| Hermes | Nama platform — execution engine |
| ILMA | Agent profile yang dijalankan Hermes |
| Session | Konteks percakapan + workspace state yang persisten |
| Workspace | Direktori project yang sedang dikerjakan |
| Plan | Daftar langkah terurut sebelum eksekusi |
| Diff | Preview perubahan sebelum file dimodifikasi |
| Tool | Fungsi eksekusi yang dipanggil agent (fs, terminal, git, search) |
| Adapter | Layer kompatibilitas agar editor bisa terhubung ke Hermes |
| AUTO mode | Agent eksekusi tanpa approval |
| REVIEW mode | Agent meminta approval sebelum aksi destructive |
| BLOCK mode | Agent hanya planning, tidak eksekusi |

---

## 11. START SEQUENCE

```
Agent, mulai dari PHASE 1.

1. Scan repository ini dari root.
2. Buat SYSTEM_AUDIT.md berdasarkan template di Phase 1.
3. Tampilkan hasil audit.
4. Tunggu approval sebelum melanjutkan ke Phase 2.

Ikuti RESPONSE PROTOCOL di Section 9 untuk setiap respons.
```
