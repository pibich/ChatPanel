# 💬 ChatPanel

**ChatPanel** adalah aplikasi desktop *overlay* ringan yang menampilkan *live chat* (**YouTube Live**, **TikTok Live**, & **Twitch Live**) secara transparan dan selalu berada di atas layar (*Always-on-Top*).

---

## 🎯 Latar Belakang (Intention)

Melakukan *livestreaming* hanya dengan **satu perangkat (single-monitor)** tanpa layar tambahan sering kali menyulitkan *streamer* untuk membaca interaksi *live chat* secara langsung—terutama saat sedang membuka game atau aplikasi lain dalam mode layar penuh (*fullscreen* / *borderless*).

Aplikasi ini dibuat sebagai solusi praktis agar *streamer* dapat memantau *live chat* secara *real-time* langsung di atas layar utama tanpa perlu berpindah jendela (*Alt+Tab*) dan tanpa mengganggu aktivitas di layar berkat fitur transparansi serta mode *Click-Through* (tembus klik).

---

## ✨ Fitur Singkat

- **Always-on-Top & Transparan**: Jendela *chat* melayang di atas aplikasi/game dengan tingkat transparansi latar belakang yang dapat diatur.
- **Click-Through Mode (Tembus Klik)**: Mengunci panel agar klik *mouse* tembus langsung ke aplikasi atau game di belakangnya.
- **Multi-Platform Tanpa Ribet**: Mendukung **YouTube Live**, **TikTok Live**, dan **Twitch Live** secara bersamaan tanpa memerlukan konfigurasi *API Key* atau *login* akun.
- **Live Viewer Count & YouTube Like Counter**: Bar statistik *real-time* di atas panel chat untuk memantau jumlah penonton aktif dari semua platform serta jumlah *Likes* YouTube Live.
- **Filter Chat & Bot Cerdas**: Opsi untuk menyembunyikan pesan *bot* (termasuk *bot* yang memiliki akses Moderator), perintah (`!command`), serta fitur *pin* pesan penting.

---

## 🛠️ Tech Stack

- **[Electron](https://www.electronjs.org/)** — *Framework* aplikasi desktop (*Always-on-Top*, *Frameless Transparent Window*, & *Global Shortcuts*).
- **Node.js** — *Backend process* untuk mengambil data *live chat* YouTube (*Innertube Live Chat polling*) dan TikTok ([`tiktok-live-connector`](https://github.com/zerodytrash/TikTok-Live-Connector)).
- **HTML5, CSS3, & Vanilla JavaScript** — Antarmuka pengguna (*UI*) yang ringan, responsif, dan hemat sumber daya.

---

## 🚀 Cara Penggunaan

### 1. Instalasi (Pengguna Windows)
Unduh file installer **`ChatPanel Setup 1.0.0.exe`** dari halaman **Releases**, lalu jalankan installer tersebut.

### 2. Menjalankan dari Source Code (Developer)
Pastikan [Node.js](https://nodejs.org/) sudah terpasang di perangkat Anda, lalu jalankan perintah berikut di terminal:

```bash
# Install dependencies
npm install

# Jalankan aplikasi
npm start

# Build installer .exe (Output berada di folder dist/)
npm run dist
```

### 3. Menghubungkan ke Live Chat
1. Pilih input platform (**YouTube** atau **TikTok**) pada menu pengaturan koneksi.
2. Masukkan **URL Live**, **Video ID**, atau **Username** (`@username`), lalu klik **Connect**.
3. *(Opsional)* Gunakan tombol **Tes Simulasi Chat** untuk menguji tampilan *chat* sebelum mulai *live*.

### 4. Pintasan Keyboard (Shortcuts)
- `Ctrl + Shift + L` : Mengaktifkan/menonaktifkan mode **Click-Through (Lock Overlay)** kapan saja (termasuk saat di dalam game).
- `Ctrl + Shift + T` : Mengaktifkan/menonaktifkan mode **Always-on-Top (Pin on Top)**.
