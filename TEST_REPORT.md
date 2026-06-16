# Hermes Agent Bridge — hardended Test Report

## Hardening Acceptance Test Results

| Test Scenario | Expected Outcome | Actual Result | Status |
|---------------|------------------|---------------|--------|
| **Extension Install** | Hermes UI muncul di sidebar VSCode setelah instalasi `.vsix` | Hermes Sidebar View muncul secara native via Webview Provider. VSIX dibuat menggunakan `@vscode/vsce`. | ✅ PASS |
| **Server Connection** | Status bar berubah menjadi "Hermes Connected" dan memancarkan Session ID | Status koneksi berubah menjadi aktif, dan Session ID (`UUID v4`) divalidasi ke backend tanpa masalah. | ✅ PASS |
| **Path Traversal Shield** | Mencegah pembacaan/penulisan file di luar sandbox workspace | File system tool menolak pembacaan file dengan `..` atau absolute path di luar root workspace. | ✅ PASS |
| **Command Token Blocklist** | Mencegah eksekusi command terlarang (misal `rm -rf`, `format`) | Terminal tool secara otomatis mendeteksi dan memblokir input command terlarang. | ✅ PASS |
| **SSE Auto-Reconnect** | Koneksi melakukan reconnect otomatis dengan exponential backoff dan ID recovery | Webview client memulihkan koneksi SSE yang terputus dengan `Last-Event-ID` header. | ✅ PASS |
| **Zod API Schema Validation** | Validasi payload request body untuk semua endpoint Express | Schema validation terintegrasi dengan middleware Express dan mengembalikan 400 Bad Request jika tidak valid. | ✅ PASS |
| **PM2 Process Control** | Pengelolaan proses handal di background dengan monitoring memori | PM2 dikonfigurasi dengan limit memori 200MB, auto-restart on crash, dan mode `production`. | ✅ PASS |
| **Unit & Integration Tests** | Cakupan tes di atas 60% dengan vitest | Semua 20 unit & integration test pada filesystem, terminal, git, LLM, dan server route lulus 100%. | ✅ PASS |

## Hardening Performance Metrics
| Metric | Hardened Value | Threshold | Pass? |
|--------|----------------|-----------|-------|
| API Latency (Local Health) | ~5ms | < 100ms | ✅ Yes |
| RAM Usage (Server Idle) | ~50 MB | < 150 MB | ✅ Yes |
| RAM Max Limit (PM2) | 200 MB | < 300 MB | ✅ Yes |
| Extension Activation | ~110ms | < 500ms | ✅ Yes |
| Test Coverage | ~76.2% | > 60% | ✅ Yes |

## Regression Checklist
- [x] Basic HTTP Server Boot & Env Parsing
- [x] Webview UI Rendering with modular assets
- [x] Local Filesystem Read/Write Constraints
- [x] File Permission and Sandbox Constraint Check
- [x] SSE Stream Parser (Client-Side)
- [x] Circuit Breaker state transition (CLOSED -> OPEN -> HALF_OPEN)
