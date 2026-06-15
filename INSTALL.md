# INSTALL GUIDE

## Prerequisites
- Node.js (v18 atau lebih baru)
- NPM (Node Package Manager)
- Visual Studio Code (v1.80.0 atau lebih baru)

## Server Installation
1. Buka terminal di root folder `hermes`.
2. Install dependency menggunakan NPM:
   ```bash
   npm install
   ```
3. Sesuaikan konfigurasi server di file `config/hermes.config.json` bila perlu (secara default diset untuk mendengarkan `0.0.0.0:3000`).
4. Jalankan Hermes Server:
   ```bash
   npm run start
   # atau
   npx ts-node server/index.ts
   ```

## Extension Installation
1. Navigasikan ke sub-folder ekstensi:
   ```bash
   cd extensions/vscode
   ```
2. Jalankan kompilasi dan paketing ekstensi (pastikan modul `@vscode/vsce` sudah terinstall):
   ```bash
   npm install
   npm run package
   ```
3. File `.vsix` (seperti `hermes-ilma-1.0.0.vsix`) akan di-generate.
4. Buka VSCode, arahkan ke tab *Extensions* -> Klik tanda elipsis (`...`) di kanan atas tab -> Pilih **Install from VSIX...**
5. Pilih file `.vsix` yang baru saja di-generate.

## Configuration
Pada VSCode, Anda dapat mengatur koneksi ke server Hermes secara default melalui konfigurasi jika diperlukan (bisa dimodifikasi di `settings.json`):
```json
{
  "hermes.server.url": "http://127.0.0.1",
  "hermes.server.port": 3000,
  "hermes.profile": "ILMA",
  "hermes.mode": "review"
}
```
*Catatan: fitur inject settings di atas merupakan standar operasi yang akan terus dikembangkan untuk rilis mendatang.*

## Verification Steps
1. Pastikan script server Hermes (Terminal 1) berjalan tanpa throw error.
2. Saat VSCode terbuka, perhatikan pojok kanan bawah Status Bar, Anda harus melihat ikon `(circle-filled) Hermes Connected`.
3. Buka tab Hermes di Activity Bar VSCode. Coba berinteraksi lewat form Chat ("hello hermes"). Jika terkoneksi, balasan stream akan di-render pada antarmuka webview.

## Troubleshooting
- **Koneksi Ditolak (ECONNREFUSED)**: Pastikan alamat IP di klien sesuai dengan setting konfigurasi server. Ganti `172.16.102.11` menjadi `127.0.0.1` di konfigurasi apabila Anda menjalankannya pada mesin lokal (*localhost*).
- **Extensi tidak aktif/gagal memuat**: Tekan `Ctrl+Shift+P`, ketik "Developer: Show Window Log" atau "Developer: Show Extension Host Log" untuk melihat peringatan dan error saat aktivasi webview panel.
- **Port Bentrok**: Jika Port `3000` telah digunakan program lain, Anda harus mematikannya (`Stop-Process` di Powershell/Task Manager), atau ganti opsi "port" di file `hermes.config.json`.
