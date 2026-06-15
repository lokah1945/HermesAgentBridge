# HERMES ILMA — PHASE 4: PRODUCTION HARDENING & END-TO-END
**Repo:** https://github.com/lokah1945/HermesAgentBridge  
**Precondition:** Phase 1-3 complete. LLM (Ollama) terhubung ke runtime.  
**Goal:** System bisa diinstall, dipakai, dan tidak crash di lingkungan nyata.

---

## STEP 0 — MANDATORY FIRST READ

Sebelum apapun, scan file-file ini:

```
package.json
tsconfig.json
config/hermes.config.json
server/          → semua .ts, catat structure
tools/           → semua .ts
extensions/vscode/  → package.json, src/**/*.ts
```

Buat ringkasan internal:
- Entry point server ada di mana?
- LLM client ada di file mana? (hasil Phase 3)
- Planner ada di file mana? (hasil Phase 3)
- Executor ada di file mana? (hasil Phase 3)
- Extension webview HTML ada di mana?
- Session disimpan di mana? (memory / file?)

Laporkan hasil scan sebelum eksekusi task pertama.

---

## PHASE 3 VALIDATION (jalankan dulu, STOP jika gagal)

Sebelum hardening, pastikan Phase 3 benar-benar terhubung.

```bash
# Pastikan openai ada di dependencies
cat package.json | grep openai
# Expected: "openai": "..."

# Start server
npx ts-node server/index.ts &
sleep 2

# Test chat completions - harus pakai LLM nyata (bukan stub)
curl -s -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"balas dengan kata: CONNECTED"}],"stream":false}' \
  | grep -i "CONNECTED"

# Test agent run - harus return plan dari LLM, bukan hardcoded
curl -s -X POST http://localhost:3000/v1/agent/run \
  -H "Content-Type: application/json" \
  -d '{"session_id":"val-001","task":"buat file test.ts","workspace":{"root":"/tmp"},"mode":"review"}'
```

**Jika kedua test di atas gagal:** perbaiki LLM wiring sebelum lanjut.  
**Jika sukses:** lanjut ke task berikut.

---

## PRODUCTION REQUIREMENTS

"Production" di sini = self-hosted local tool yang:
- Start dengan satu command
- Tidak crash pada input buruk atau Ollama down
- Extension reconnect otomatis jika server restart
- Session tidak hilang saat server restart
- Bisa diinstall di mesin bersih dengan INSTALL.md
- `.vsix` siap install tanpa error

Tidak perlu: Docker, cloud, CI/CD, multi-user, auth.

---

## IMPLEMENTATION TASKS

Kerjakan dalam urutan ini. Tandai DONE / SKIP / BLOCKED setelah setiap task.

---

### T1 — FIX: Diff Generation yang Nyata

**Problem:** Diff saat ini kemungkinan placeholder string.  
**Fix:** Implementasi real unified diff sebelum setiap file write.

Install:
```bash
npm install diff
npm install --save-dev @types/diff
```

Buat atau update `tools/filesystem.ts` — fungsi `generateDiff`:

```typescript
import { createTwoFilesPatch } from 'diff';

export function generateDiff(
  filePath: string,
  before: string,      // konten sebelum ('' jika file baru)
  after: string        // konten setelah
): string {
  return createTwoFilesPatch(
    filePath,
    filePath,
    before,
    after,
    'before',
    'after'
  );
}
```

Panggil `generateDiff` di executor sebelum emit SSE event `diff`.  
Kirim hasilnya ke extension sebagai:
```json
{
  "event": "diff",
  "data": {
    "stepId": "...",
    "file": "relative/path",
    "unified": "--- before\n+++ after\n..."
  }
}
```

---

### T2 — FIX: Session Persistence (File-Based)

**Problem:** Session in-memory → hilang saat server restart.  
**Fix:** Simpan session state ke disk.

Buat `server/session-store.ts`:

```typescript
import fs from 'fs';
import path from 'path';

const STORE_PATH = path.join(process.cwd(), 'data', 'sessions.json');

interface SessionStore {
  [sessionId: string]: {
    id: string;
    workspace: string;
    profile: string;
    history: Array<{ role: string; content: string }>;
    createdAt: number;
    updatedAt: number;
    pendingStep?: {
      stepId: string;
      action: string;
      target: string;
      after: string;
    };
  };
}

export function loadSessions(): SessionStore {
  try {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
    const raw = fs.readFileSync(STORE_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function saveSession(id: string, data: SessionStore[string]): void {
  const store = loadSessions();
  store[id] = { ...data, updatedAt: Date.now() };
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

export function getSession(id: string): SessionStore[string] | null {
  return loadSessions()[id] ?? null;
}

export function deleteSession(id: string): void {
  const store = loadSessions();
  delete store[id];
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

export function cleanOldSessions(ttlMinutes = 60): void {
  const store = loadSessions();
  const cutoff = Date.now() - ttlMinutes * 60 * 1000;
  let changed = false;
  for (const id in store) {
    if (store[id].updatedAt < cutoff) {
      delete store[id];
      changed = true;
    }
  }
  if (changed) fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}
```

Tambahkan ke `.gitignore`:
```
data/
dist/
```

Ganti semua penggunaan in-memory session Map/Object dengan `session-store.ts`.

---

### T3 — FIX: Approval/Reject Flow Wired ke File Write

Pastikan endpoint `POST /v1/agent/approve/:sessionId/:stepId` benar-benar:
1. Load session dari store
2. Ambil `pendingStep` dari session
3. Tulis file ke disk: `fs.writeFileSync(path, after, 'utf-8')`
4. Hapus `pendingStep` dari session
5. Emit SSE event `{ event: "applied", data: { file, stepId } }`
6. Lanjut ke step berikutnya dalam plan (jika ada)

Endpoint `POST /v1/agent/reject/:sessionId/:stepId`:
1. Load session
2. Hapus `pendingStep`
3. Emit `{ event: "rejected", data: { stepId } }`
4. Lanjut ke step berikutnya

---

### T4 — Error Handling: LLM Down / Timeout

Di `server/adapter/llm.ts`, wrap semua LLM calls:

```typescript
export async function chat(messages: LLMMessage[]): Promise<string> {
  try {
    const response = await openai.chat.completions.create({
      model: config.llm.model,
      messages,
    });
    return response.choices[0]?.message?.content ?? '';
  } catch (err: any) {
    if (err.code === 'ECONNREFUSED') {
      throw new Error('LLM_UNAVAILABLE: Ollama tidak berjalan di ' + config.llm.baseUrl);
    }
    if (err.status === 404) {
      throw new Error('LLM_MODEL_NOT_FOUND: Model ' + config.llm.model + ' belum di-pull di Ollama');
    }
    throw new Error('LLM_ERROR: ' + err.message);
  }
}
```

Di semua route handler yang memanggil LLM, catch error dan kirim SSE error event:
```json
{ "event": "error", "data": { "code": "LLM_UNAVAILABLE", "message": "..." } }
```

Untuk REST endpoint, return proper HTTP error:
```json
HTTP 503 { "error": "LLM_UNAVAILABLE", "message": "...", "hint": "Jalankan: ollama serve" }
```

---

### T5 — Input Validation di Semua Route

Setiap route harus validasi request body. Buat `server/middleware/validate.ts`:

```typescript
export function requireFields(...fields: string[]) {
  return (req: any, res: any, next: any) => {
    const missing = fields.filter(f => !req.body?.[f]);
    if (missing.length > 0) {
      return res.status(400).json({ error: 'MISSING_FIELDS', fields: missing });
    }
    next();
  };
}
```

Pasang di setiap route:
```typescript
router.post('/v1/agent/run', requireFields('session_id', 'task', 'workspace'), handler);
router.post('/v1/files/write', requireFields('path', 'content'), handler);
```

---

### T6 — Health Check Endpoint

Tambahkan `GET /health`:

```typescript
app.get('/health', async (req, res) => {
  const status: any = {
    server: 'ok',
    version: process.env.npm_package_version ?? '1.0.0',
    profile: config.profile,
    uptime: Math.floor(process.uptime()),
    llm: { status: 'unknown', model: config.llm.model, baseUrl: config.llm.baseUrl }
  };

  try {
    const r = await fetch(`${config.llm.baseUrl.replace('/v1','')}/api/tags`);
    status.llm.status = r.ok ? 'ok' : 'degraded';
  } catch {
    status.llm.status = 'unavailable';
  }

  const httpStatus = status.llm.status === 'ok' ? 200 : 207;
  res.status(httpStatus).json(status);
});
```

---

### T7 — Graceful Shutdown

Di server entry point (`server/index.ts`):

```typescript
const server = app.listen(port, host, () => {
  console.log(`[Hermes] ● Server running at http://${host}:${port}`);
  console.log(`[Hermes] Profile: ${config.profile} | LLM: ${config.llm.model}`);
});

const shutdown = (signal: string) => {
  console.log(`\n[Hermes] ${signal} received — shutting down gracefully...`);
  server.close(() => {
    console.log('[Hermes] Server stopped.');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
```

---

### T8 — Build Pipeline (TypeScript → JavaScript)

Update `package.json` scripts:

```json
{
  "scripts": {
    "dev": "nodemon --exec ts-node server/index.ts",
    "build": "tsc --outDir dist --rootDir . --declaration false",
    "start": "node dist/server/index.js",
    "start:dev": "npm run dev",
    "start:prod": "npm run build && npm run start",
    "health": "curl -s http://localhost:3000/health | cat"
  }
}
```

Pastikan `tsconfig.json` dikonfigurasi untuk emit ke `./dist`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "outDir": "./dist",
    "rootDir": "./",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "exclude": ["node_modules", "dist", "extensions"]
}
```

Test:
```bash
npm run build
# Expected: ./dist/server/index.js exists
node dist/server/index.js
# Expected: server starts dari JS compiled
```

---

### T9 — Extension Webview UI (Production-Ready)

Ini adalah komponen yang paling terlihat oleh user. UI extension harus handle semua SSE events.

Cari file webview HTML/JS di `extensions/vscode/`. Update atau replace dengan implementasi lengkap:

**Fitur yang wajib ada:**

```
Chat area:
  - User message (right-aligned, warna berbeda)
  - Agent response streaming (left-aligned, real-time)
  - Timestamp per pesan

Plan view (collapsible):
  - List steps dengan icon per status:
    ⏳ pending | ✅ done | ⚠️ review | ❌ error
  - Klik step untuk lihat detail

Diff view (per file):
  - Unified diff dengan syntax highlight minimal
  - Filename header
  - Line numbers
  - Green (+) / Red (-) lines

Action buttons:
  - ✅ Apply  → POST /v1/agent/approve/:sessionId/:stepId
  - ❌ Reject → POST /v1/agent/reject/:sessionId/:stepId
  - ▶ Run    → POST /v1/agent/run
  - ↩ Rollback (future, disabled with tooltip)

Status bar di dalam panel:
  - ● Idle (hijau)
  - ◌ Thinking... (kuning, animasi)
  - ⚡ Executing (biru)
  - ⏸ Awaiting Approval (oranye)
  - ✗ Error (merah)

Auto-reconnect:
  - Jika SSE connection terputus, retry setiap 3 detik
  - Tampilkan "Reconnecting..." saat retry
  - Tampilkan "Connected" saat berhasil
```

**Implementasi auto-reconnect di webview JS:**

```javascript
let eventSource = null;
let reconnectTimer = null;

function connectSSE(sessionId) {
  if (eventSource) eventSource.close();

  eventSource = new EventSource(`${hermesUrl}/v1/session/${sessionId}/stream`);
  
  eventSource.onopen = () => {
    clearTimeout(reconnectTimer);
    setStatus('idle');
  };
  
  eventSource.onerror = () => {
    eventSource.close();
    setStatus('reconnecting');
    reconnectTimer = setTimeout(() => connectSSE(sessionId), 3000);
  };
  
  eventSource.addEventListener('plan', e => renderPlan(JSON.parse(e.data)));
  eventSource.addEventListener('diff', e => renderDiff(JSON.parse(e.data)));
  eventSource.addEventListener('awaiting_approval', e => showApprovalButtons(JSON.parse(e.data)));
  eventSource.addEventListener('applied', e => markStepDone(JSON.parse(e.data)));
  eventSource.addEventListener('rejected', e => markStepRejected(JSON.parse(e.data)));
  eventSource.addEventListener('done', e => setStatus('idle'));
  eventSource.addEventListener('error', e => showError(JSON.parse(e.data)));
  eventSource.addEventListener('chunk', e => appendStreamChunk(JSON.parse(e.data)));
}
```

Tambahkan endpoint di server untuk persistent SSE stream per session:
```
GET /v1/session/:sessionId/stream
```
Client subscribe sekali, agent push events melalui connection ini.

---

### T10 — Extension: Build .vsix yang Installable

Di `extensions/vscode/package.json`, pastikan:

```json
{
  "name": "hermes-ilma",
  "displayName": "Hermes ILMA",
  "description": "Self-hosted AI Coding Agent",
  "version": "1.0.0",
  "publisher": "hermes-local",
  "engines": { "vscode": "^1.85.0" },
  "categories": ["AI", "Other"],
  "activationEvents": ["onStartupFinished"],
  "main": "./out/extension.js",
  "contributes": {
    "viewsContainers": {
      "activitybar": [{ "id": "hermes", "title": "Hermes", "icon": "$(robot)" }]
    },
    "views": {
      "hermes": [{ "type": "webview", "id": "hermes.chat", "name": "Agent" }]
    },
    "commands": [
      { "command": "hermes.run", "title": "Hermes: Run Agent" },
      { "command": "hermes.configure", "title": "Hermes: Configure Server" }
    ],
    "configuration": {
      "title": "Hermes",
      "properties": {
        "hermes.serverUrl": {
          "type": "string",
          "default": "http://172.16.102.11:3000",
          "description": "Hermes server URL"
        }
      }
    }
  },
  "scripts": {
    "compile": "tsc -p ./",
    "package": "npm run compile && vsce package --no-dependencies"
  },
  "devDependencies": {
    "@types/vscode": "^1.85.0",
    "@vscode/vsce": "^3.0.0",
    "typescript": "^5.0.0"
  }
}
```

Build extension:
```bash
cd extensions/vscode
npm install
npm run package
# Expected: hermes-ilma-1.0.0.vsix
```

---

### T11 — Startup Script + PM2 Config

Buat `start.sh` di root:
```bash
#!/bin/bash
set -e

echo "=== Hermes ILMA Startup ==="

# Check Ollama
if ! curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
  echo "⚠️  WARNING: Ollama tidak berjalan. LLM calls akan gagal."
  echo "    Jalankan: ollama serve"
fi

# Build
echo "▶ Building TypeScript..."
npm run build

# Start
echo "▶ Starting Hermes server..."
node dist/server/index.js
```

```bash
chmod +x start.sh
```

Buat `pm2.config.js` (opsional, untuk PM2 user):
```javascript
module.exports = {
  apps: [{
    name: 'hermes-ilma',
    script: 'dist/server/index.js',
    watch: false,
    max_memory_restart: '200M',
    env: { NODE_ENV: 'production' }
  }]
};
```

---

### T12 — Final INSTALL.md

Tulis ulang `INSTALL.md` berdasarkan kondisi nyata:

```markdown
# Hermes ILMA — Installation Guide

## Prerequisites

- Node.js >= 18
- npm >= 9
- VSCode >= 1.85
- Ollama (https://ollama.com)

## 1. Install Ollama dan Pull Model

curl -fsSL https://ollama.com/install.sh | sh
ollama pull llama3.2

## 2. Clone dan Install Dependencies

git clone https://github.com/lokah1945/HermesAgentBridge
cd HermesAgentBridge
npm install

## 3. Konfigurasi (opsional)

Edit config/hermes.config.json:
- llm.model    → model Ollama yang digunakan
- server.host  → alamat server (default: 172.16.102.11)
- server.port  → port (default: 3000)

## 4. Start Server

./start.sh
# atau
npm run start:prod

## 5. Verifikasi Server

curl http://localhost:3000/health

## 6. Install Extension VSCode

1. Buka VSCode
2. Ctrl+Shift+P → "Install from VSIX"
3. Pilih: extensions/vscode/hermes-ilma-1.0.0.vsix

## 7. Konfigurasi Extension

VSCode Settings → cari "Hermes":
- hermes.serverUrl: http://[alamat-server]:3000

## 8. Verifikasi End-to-End

1. Buka VSCode dengan project folder
2. Sidebar kiri → ikon Hermes
3. Ketik: "buat file hello.ts yang print hello world"
4. Agent akan tampilkan Plan → Diff → Approve
5. Klik Apply → file terbuat

## Troubleshooting

Server tidak start:
  → npm run build (pastikan tidak ada TypeScript error)

LLM tidak merespon:
  → ollama serve (di terminal terpisah)
  → curl http://localhost:11434/api/tags (verifikasi Ollama)

Extension tidak connect:
  → Cek hermes.serverUrl di VSCode settings
  → curl http://[server]:3000/health
```

---

## FINAL ACCEPTANCE TEST

Jalankan secara manual, dokumentasikan hasilnya:

```
TEST 1: Server Startup
  → npm run start:prod
  → Expected: "● Server running" tanpa error
  → curl /health → { server: "ok", llm: { status: "ok" } }

TEST 2: Chat Real LLM
  → curl POST /v1/chat/completions dengan pesan "halo"
  → Expected: respons berbeda setiap kali (bukan hardcoded)
  → Expected: bukan "stub" atau "mock"

TEST 3: Agent Full Flow
  → curl POST /v1/agent/run dengan task "buat file test.ts"
  → Expected: SSE stream dengan plan dari LLM
  → Expected: diff event dengan konten file nyata
  → Expected: approve → file terbuat di disk

TEST 4: Extension Connect
  → Install .vsix di VSCode
  → Status: "● Connected" di panel
  → Ketik pesan → agent merespons

TEST 5: Resilience
  → Stop Ollama: pkill ollama
  → Kirim pesan ke agent
  → Expected: error event dengan pesan jelas (bukan crash)
  → Start Ollama kembali: ollama serve
  → Expected: agent merespons normal kembali

TEST 6: Restart Recovery
  → Stop server: Ctrl+C
  → Start ulang: npm run start:prod
  → Kirim request dengan session_id yang sama
  → Expected: session history masih ada (dari file store)
```

Tulis hasil setiap test di `TEST_REPORT.md`.

---

## DONE DEFINITION

Fase ini selesai ketika:

```
✅ npm run build → sukses tanpa error TypeScript
✅ npm run start:prod → server berjalan
✅ GET /health → { server: "ok", llm: { status: "ok" } }
✅ POST /chat/completions → respon LLM nyata (bukan stub)
✅ POST /agent/run → SSE plan dari LLM → diff → approve → file terbuat
✅ extensions/vscode/hermes-ilma-1.0.0.vsix → bisa diinstall di VSCode
✅ Extension UI menampilkan plan, diff, approve/reject buttons
✅ Extension reconnect otomatis jika server restart
✅ Session tersimpan di data/sessions.json
✅ INSTALL.md akurat dan bisa diikuti di mesin bersih
✅ Semua 6 acceptance test documented di TEST_REPORT.md
```

---

## CONSTRAINTS

- Jangan tambah framework baru (tidak perlu React/Vue di webview — vanilla JS cukup)
- Jangan tambah database (file JSON sudah cukup untuk sessions)
- Jangan tambah auth (out of scope)
- Diff package (`diff`) adalah satu-satunya dependency tambahan yang diizinkan
- `data/` folder di .gitignore
- Semua config tetap di `hermes.config.json`, tidak ada hardcode

---

## RESPONSE FORMAT PER TASK

```
TASK [N] — [NAMA]
Status  : DONE | SKIP | BLOCKED
Files   : [modified/created]
Notes   : [hal penting atau keputusan yang dibuat]
```

Report BLOCKED segera. Jangan skip step kecuali sudah benar-benar ada.
```
