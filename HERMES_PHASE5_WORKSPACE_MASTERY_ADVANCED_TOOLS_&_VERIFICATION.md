# HERMES ILMA — PHASE 5: WORKSPACE MASTERY, ADVANCED TOOLS & VERIFICATION
**Repo:** https://github.com/lokah1945/HermesAgentBridge  
**Precondition:** Phase 1-4 complete. Extension terhubung, file saving via UI diff bekerja, session persistent.  
**Goal:** Membuat agent cerdas dalam membaca context project (tidak buta), mampu menjalankan terminal/git, dan memiliki "Self-Correction Loop" jika terjadi error. Ini adalah langkah final menuju status "Daily Driver".

---

## STEP 0 — MANDATORY FIRST READ

Sebelum melakukan modifikasi apapun, lakukan pemindaian file-file krusial hasil eksekusi Phase 4:


```

tools/filesystem.ts      → Bagaimana file dibaca/ditulis saat ini?
tools/search.ts          → Bagaimana search berjalan?
runtime/executor.ts      → Bagaimana step dieksekusi?
server/adapter/llm.ts    → Pastikan prompt/context window dipahami.

```

**Laporan Internal:** Konfirmasi bahwa Anda telah membaca file-file ini dan memahami cara `pendingStep` dikelola saat mode `review` sebelum melanjutkan ke eksekusi task.

---

## IMPLEMENTATION TASKS

Kerjakan secara berurutan. Evaluasi `TEST_REPORT.md` sebelumnya. Jika ada *Known Issues* dari Phase 4 yang memblokir task di bawah, perbaiki terlebih dahulu.

---

### T1 — Implementasi Workspace Context Engine (Smart File Tree)

**Problem:** Agent saat ini kesulitan memahami struktur project secara keseluruhan kecuali user secara spesifik menyebutkan file.
**Fix:** Implementasi `POST /v1/workspace/context` yang pintar.

Buat/Update `tools/workspace.ts`:

1. Buat fungsi `generateFileTree(rootDir: string, maxDepth: number = 4): string`.
2. **WAJIB:** Implementasi pengabaian otomatis (ignore) untuk:
   - `node_modules`, `.git`, `dist`, `build`, `.next`, `out`, `coverage`
   - File biner (images, fonts, dll).
   - Membaca `.gitignore` jika ada (gunakan library `ignore` jika perlu, install via `npm install ignore`).
3. Output harus berupa representasi tree sederhana (string) agar hemat token LLM.

```typescript
// Contoh Output yang diekspektasikan:
// src/
// ├── index.ts
// ├── auth/
// │   └── login.ts
// package.json

```

4. Integrasikan fungsi ini ke dalam `runtime/planner.ts` agar context tree ini *selalu* dikirim ke LLM sebagai bagian dari `system prompt` saat membuat plan.

---

### T2 — Terminal Tool Implementation (Safe Execution)

**Problem:** Agent belum bisa menjalankan `npm install`, `npm run build`, atau melihat error log.
**Fix:** Sempurnakan `tools/terminal.ts`.

1. Gunakan `child_process.exec` (atau `spawn`).
2. Batasi waktu eksekusi (Timeout: max 30 detik untuk default, cegah hanging process).
3. Tangkap `stdout` dan `stderr`. Truncate output jika lebih dari 2000 karakter (agar tidak merusak context window LLM).
4. **Security Block:** Hardcode blocklist untuk command berbahaya:
* `rm -rf /`, `mkfs`, `shutdown`, dsb.


5. Daftarkan action ini di `runtime/executor.ts` sebagai `action: "run_command"`.
6. **Rule Mode:** `run_command` **WAJIB** masuk ke state `pending_approval` (mode `review`). Eksekusi hanya berjalan jika user menekan "Approve/Apply" di VSCode UI.

---

### T3 — Git Tool Implementation (Context Enhancer)

**Problem:** Agent tidak tahu apa yang sedang dikerjakan user saat ini (uncommitted changes).
**Fix:** Implementasi `tools/git.ts`.

Buat endpoint/fungsi yang bisa diakses oleh Planner:

1. `getGitStatus()`: Menjalankan `git status -s`.
2. `getGitDiff()`: Menjalankan `git diff` (truncate jika terlalu panjang).

Tambahkan data ini ke `WorkspaceContext` payload di `POST /v1/agent/run`. Jika ada file yang termodifikasi, LLM akan lebih paham fokus user saat ini.

---

### T4 — Token & Context Window Management

**Problem:** Jika percakapan panjang atau file sangat besar dibaca oleh agent, Ollama (Llama 3.2) akan crash karena `context_length_exceeded`.
**Fix:** Buat `shared/utils/tokenizer.ts` (Simple character-based truncation).

1. Estimasi: 1 token ≈ 4 karakter. Batas aman context = 6000 token (~24.000 karakter).
2. Jika agen mengeksekusi `read_file` pada file berukuran 50KB, potong string file tersebut, atau ambil spesifik baris/fungsi (jika memungkinkan), atau kembalikan error "File too large, please use search tool".
3. Truncate `conversationHistory` di `server/session-store.ts`. Simpan maksimum 10 turn (5 user, 5 assistant) terakhir untuk dimasukkan ke payload LLM.

---

### T5 — Self-Correction Loop (The Verify Phase)

**Problem:** Jika agen menulis kode yang salah atau menjalankan terminal yang error, agen diam saja.
**Fix:** Tambahkan fase VERIFY di `runtime/executor.ts`.

1. Setelah step selesai (misal `run_command` selesai), periksa `stderr` atau exit code.
2. Jika ada `error`, jangan langsung `status: 'error'` dan berhenti.
3. Kirim error message kembali ke LLM secara otomatis (sistem):
*"Step X failed with error: [error message]. Analyze and provide a new step to fix this."*
4. Berikan limit max 2x retry per task untuk mencegah infinite loop.

---

### T6 — VSCode Extension Polish untuk Terminal & Errors

Update `extensions/vscode/src/panel/...` (Webview JS):

1. **Terminal UI:** Jika event SSE membawa tipe `action: run_command`, tampilkan dalam format blok terminal di UI.
```
[Terminal Icon] npm install axios

```


Tombol: ✅ Run Command | ❌ Cancel
2. **Output Stream:** Setelah user klik `Run Command`, tampilkan output terminal di chat panel.
3. **Error Handling:** Jika server merespons dengan HTTP 503 (LLM Unavailable), tampilkan overlay besar di Chat Panel: "Ollama is down. Please run `ollama serve`".

---

### T7 — Final Code Audit & Cleanup

Sebelum dinyatakan "Production Ready":

1. Hapus semua `console.log` yang bersifat debugging (ganti dengan logger utilitas / prefix `[Hermes]`).
2. Pastikan tidak ada komentar `// TODO` atau fungsi mock yang tersisa di `/runtime` dan `/tools`.
3. Validasi tipe TypeScript secara ketat. Jalankan `npm run build` dan pastikan `0 errors`.

---

## ACCEPTANCE TEST (DAILY DRIVER STATUS)

Sistem dinyatakan **PRODUCTION READY** jika skenario berikut sukses 100%:

```
SKENARIO: Complex Full Stack Task

GIVEN  : User membuka project Node.js kosong di VSCode
AND    : User mengirim prompt: "Buat project express.js sederhana, install dependencies, dan buat satu endpoint /ping"

WHEN   : Agent memproses prompt
THEN   : Agent membuat plan berisi:
         1. run_command: npm init -y
         2. run_command: npm install express
         3. write_file: index.js
         4. write_file: package.json (update script)

WHEN   : User menyetujui eksekusi terminal (Approve)
THEN   : Terminal command dieksekusi di background, output terlihat

WHEN   : User menyetujui file write (Approve diff)
THEN   : File terbuat sesuai standar

WHEN   : User menjalankan node index.js secara manual
THEN   : Aplikasi berjalan tanpa error syntax.

```

---

## DONE DEFINITION

1. `tools/workspace.ts` beroperasi dan mengabaikan `.gitignore` / `node_modules`.
2. Terminal tool berjalan dengan limit waktu dan memblokir command destruktif.
3. Git status terkirim ke LLM sebagai bagian dari context.
4. Truncation context history bekerja (tidak ada LLM crash karena payload kepanjangan).
5. Self-Correction Loop aktif jika command terminal/kode gagal.
6. `npm run build` pass tanpa error TypeScript.
7. Acceptance Test di atas berjalan sukses tanpa campur tangan provider eksternal.

Update `TEST_REPORT.md` dan ubah status project menjadi `PRODUCTION READY`.

---

## RESPONSE FORMAT PER TASK

```
TASK [N] — [NAMA]
Status  : DONE | SKIP | BLOCKED
Files   : [modified/created]
Notes   : [Technical details, limitations resolved]

```