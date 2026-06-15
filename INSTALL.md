# Hermes Agent Bridge — Installation & Setup Guide

Hermes Agent Bridge adalah framework jembatan agen AI lokal (berbasis Ollama) yang terintegrasi langsung dengan ekstensi VSCode Sidebar untuk membantu penulisan kode, visualisasi unified diff, review step, dan eksekusi command terotomatisasi.

---

## 📋 Prasyarat Sistem
1. **Node.js**: Versi 18 ke atas.
2. **Ollama**: Terinstal dan berjalan secara lokal (default port: `11434`).
3. **Model Llama**: Pastikan model `llama3.2` sudah di-pull.
   ```bash
   ollama pull llama3.2
   ```

---

## 🚀 Instalasi & Menjalankan Server

### 1. Instalasi Dependensi
Jalankan perintah berikut pada direktori utama proyek untuk memasang semua pustaka yang dibutuhkan:
```bash
npm install
```

### 2. Menjalankan Server (Mode Development)
```bash
npm run dev
```
Server akan aktif di `http://localhost:3000`.

### 3. Menjalankan Server (Mode Production)
Gunakan perintah build untuk mengompilasi TypeScript ke JavaScript sebelum dijalankan:
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
    "baseUrl": "http://localhost:11434/v1",
    "apiKey": "ollama",
    "model": "llama3.2",
    "timeout": 60000
  }
}
```

Jika port atau alamat server VSCode diubah, perbarui pengaturan ekstensi VSCode:
1. Buka settings VSCode (`Ctrl+,` atau `Cmd+,`).
2. Cari `Hermes Server Url`.
3. Masukkan URL server Hermes kustom Anda (misal: `http://127.0.0.1:3000`).

---

## 🛠️ Panduan Penanganan Masalah (Troubleshooting)

### 🔴 Status "DISCONNECTED" pada VSCode Sidebar
* Pastikan server Hermes sudah aktif (`npm start`).
* Jika server berjalan di port kustom, pastikan `Hermes Server Url` pada settings VSCode telah disesuaikan.
* Periksa log konsol server untuk memastikan tidak ada konflik port.

### 🔴 Error: "LLM_UNAVAILABLE: Ollama tidak berjalan"
* Pastikan aplikasi Ollama sedang aktif. Jalankan `ollama serve` di terminal untuk menyalakan Ollama secara manual.
* Pastikan port `11434` dapat diakses dari browser dengan membuka `http://localhost:11434`.

### 🔴 Error: "LLM_MODEL_NOT_FOUND"
* Model LLM yang dikonfigurasi belum diunduh di sistem Anda. Unduh model menggunakan terminal:
  ```bash
  ollama pull llama3.2
  ```

### 🔴 Konflik Port 3000
Jika port 3000 sedang digunakan oleh aplikasi lain, Anda dapat mematikan proses tersebut atau mengubah port di `config/hermes.config.json` pada objek `"server": { "port": 3001 }`.
