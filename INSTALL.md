# Hermes Agent Bridge — Installation & Setup Guide

Hermes Agent Bridge adalah framework jembatan agen AI yang terintegrasi langsung dengan ekstensi VSCode Sidebar untuk membantu penulisan kode, visualisasi unified diff, review step, dan eksekusi command terotomatisasi.

---

## 📋 Prasyarat Sistem
1. **Node.js**: Versi 18 ke atas.
2. **LLM Server**: Endpoint LLM yang compatible dengan OpenAI API (v1/chat/completions).
   Hermes Agent Bridge bekerja dengan SEMUA LLM backend yang support OpenAI-compatible API.

---

## 🚀 Instalasi & Menjalankan Server

### 1. Konfigurasi LLM
Edit `config/hermes.config.json` dan sesuaikan bagian `llm`:
```json
{
  "llm": {
    "baseUrl": "http://your-llm-server:port/v1",
    "apiKey": "your-api-key",
    "model": "your-model-name",
    "timeout": 60000
  }
}
```

### 2. Instalasi Dependensi
```bash
npm install
```

### 3. Menjalankan Server (Mode Development)
```bash
npm run dev
```
Server akan aktif di `http://localhost:3000`.

### 4. Menjalankan Server (Mode Production)
```bash
npm run build
npm start
```
Atau jalankan skrip gabungan sekali klik:
* **Windows**: `start.bat`
* **Linux/macOS**: `bash start.sh`

*(Skrip di atas akan mengompilasi kode dan mengaktifkan server di latar belakang menggunakan PM2)*

---

## 🔌 Instalasi Ekstensi VSCode

1. Buka aplikasi **VSCode**.
2. Masuk ke tab **Extensions** (`Ctrl+Shift+X` atau `Cmd+Shift+X`).
3. Klik ikon menu tiga titik di pojok kanan atas tab Extensions, lalu pilih **Install from VSIX...**.
4. Arahkan ke file berkas VSIX berikut:
   `extensions/vscode/hermes-ilma-1.0.0.vsix`
5. Setelah berhasil dipasang, ikon **Hermes** akan muncul pada Activity Bar di sisi kiri editor Anda.

---

## ⚙️ Konfigurasi Kustom

File konfigurasi server dan LLM berada di `config/hermes.config.json`:
```json
{
  "server": {
    "host": "0.0.0.0",
    "port": 3000
  },
  "profile": "ILMA",
  "llm": {
    "baseUrl": "http://localhost:8000/v1",
    "apiKey": "default-api-key",
    "model": "default-model",
    "timeout": 60000
  }
}
```

Jika port atau alamat server VSCode diubah, perbarui pengaturan ekstensi VSCode:
1. Buka settings VSCode (`Ctrl+,` atau `Cmd+,`).
2. Cari `Hermes Server Url`.
3. Masukkan URL server Hermes kustom Anda.

Environment variables yang tersedia:
- `HERMES_PORT` — override server port
- `HERMES_HOST` — override server host
- `HERMES_LLM_BASE_URL` — override LLM base URL
- `HERMES_MODEL` — override LLM model
- `HERMES_LOG_LEVEL` — override log level (DEBUG, INFO, WARN, ERROR)

---

## 🛠️ Panduan Penanganan Masalah (Troubleshooting)

### 🔴 Status "DISCONNECTED" pada VSCode Sidebar
* Pastikan server Hermes sudah aktif (`npm start`).
* Jika server berjalan di port kustom, pastikan `Hermes Server Url` pada settings VSCode telah disesuaikan.
* Periksa log konsol server untuk memastikan tidak ada konflik port.

### 🔴 Error: "LLM_UNAVAILABLE: LLM server tidak berjalan"
* Pastikan LLM server Anda sedang aktif dan accessible dari Hermes server.
* Verifikasi `baseUrl` di `config/hermes.config.json` sudah benar.
* Cek koneksi dengan curl: `curl http://YOUR_LLM_URL/v1/models`

### 🔴 Error: "LLM_MODEL_NOT_FOUND"
* Model LLM yang dikonfigurasi tidak tersedia di LLM server Anda.
* Periksa daftar model yang tersedia dan sesuaikan `model` di config.

### 🔴 Konflik Port 3000
Jika port 3000 sedang digunakan oleh aplikasi lain, Anda dapat mematikan proses tersebut atau mengubah port di `config/hermes.config.json` pada objek `"server": { "port": 3001 }`.
