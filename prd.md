# Product Requirements Document (PRD): ChatPanel

## 1. Ringkasan Produk
**ChatPanel** adalah aplikasi desktop berbasis **Electron** yang dirancang khusus untuk *streamer* (dengan prioritas tahap pertama pada **YouTube Live**, dan arsitektur siap ekspansi ke **TikTok Live**). Aplikasi ini berfungsi sebagai jendela overlay pembantu untuk membaca live chat dengan fitur **Always on Top (Pin on Top)**, pengaturan transparansi latar belakang secara *real-time*, mode *Click-Through* (kunci overlay), serta pemfilteran pesan cerdas (seperti menyembunyikan bot dan command).

---

## 2. Tujuan Utama
1. Memudahkan *streamer* membaca chat tanpa tertutup jendela game atau aplikasi lain (*single-monitor friendly*).
2. Mengambil data live chat YouTube secara langsung **tanpa memerlukan YouTube Data API Key / OAuth Login** (menggunakan metode *Innertube Live Chat polling*).
3. Menyediakan kontrol visual penuh (transparansi, ukuran font, filter bot/command, dan *highlight* role viewer seperti Owner, Moderator, dan Member).
4. Memungkinkan *streamer* mengunci posisi panel dan mengaktifkan mode *Click-Through* agar klik mouse tembus ke aplikasi di belakangnya.

---

## 3. Fitur Utama (MVP - Prioritas YouTube)

### 3.1. Koneksi Live Chat (Tanpa API Key)
- **Fleksibilitas Input:** Mendukung input berupa URL YouTube Live lengkap (`https://www.youtube.com/watch?v=...`, `https://youtube.com/live/...`), Video ID langsung (`11 karakter`), atau Channel Handle (`@username`).
- **Status Koneksi Real-Time:** Indikator status (`Disconnected`, `Connecting...`, `Connected / Live`, `Error`).
- **Mode Simulasi / Test Chat:** Tombol untuk memicu pesan simulasi (Viewer biasa, Member, Moderator, Super Chat, dan Bot) agar pengguna dapat menguji tampilan dan filter meskipun sedang tidak ada sesi live aktif.

### 3.2. Kontrol Jendela & Overlay (Window Management)
- **Pin on Top (Always on Top):** Toggle untuk membuat jendela selalu berada di layer paling atas di atas aplikasi lain.
- **Transparency Control:** Slider untuk mengatur opasitas background panel (`10%` hingga `100%`) sementara teks chat tetap tajam dan mudah dibaca.
- **Click-Through / Lock Mode:**
  - Saat diaktifkan, jendela tidak akan merespons klik di area chat (klik tembus ke jendela/game di belakangnya).
  - Menyediakan tombol kecil atau *global shortcut* (`Ctrl+Shift+L` / hover tombol gembok) untuk membuka kembali kunci overlay.
- **Frameless & Resizable Window:** Desain tanpa *title bar* bawaan OS yang kaku, digantikan dengan *custom compact header* yang bisa di-*drag* dan ukuran jendela yang bebas diubah.

### 3.3. Identitas Viewer & Visualisasi Pesan
- **Role Badges & Warna Nama:**
  - **Streamer / Owner:** Warna kuning emas + badge mahkota/owner.
  - **Moderator:** Warna biru terang + badge kunci (*wrench*).
  - **Member (Sponsor):** Warna hijau + badge member custom dari channel (jika tersedia).
  - **Regular Viewer:** Warna netral yang kontras dan nyaman dibaca.
- **Super Chat & Membership Alert:** Tampilan kartu dengan *highlight* warna khusus untuk pesan donasi/Super Chat beserta nominalnya.
- **Dukungan Emoji Custom YouTube:** Merender gambar emoji/stiker custom dari YouTube Live.

### 3.4. Filter & Moderasi Tampilan
- **Hide Bot Messages:** Otomatis menyembunyikan pesan dari bot populer (*Nightbot, StreamElements, Moobot, Streamlabs, Fossabot, Wizebot*) serta opsi bagi user untuk menambahkan daftar nama bot kustom (dipisahkan koma).
- **Hide Commands (`!command`):** Toggle untuk menyembunyikan pesan chat yang diawali dengan tanda seru (contoh: `!spec`, `!lagu`, `!discord`).
- **Role Filter (Opsional):** Filter cepat jika hanya ingin melihat chat dari Member/Moderator/Super Chat.

### 3.5. Fitur Pembantu Streamer (QoL Features)
- **Pin / Highlight Message:** Klik pada pesan chat mana saja untuk menyematkannya (*Pin*) di bagian atas layar chat (berguna saat sedang menjawab pertanyaan viewer tersebut).
- **Auto-Scroll & Pause on Hover:** Otomatis menggulir ke chat terbaru, namun berhenti otomatis ketika kursor diarahkan ke daftar chat untuk membaca pesan lama, disertai tombol *"Resume Auto-Scroll"* dan indikator jumlah pesan baru.
- **Font Size & Compact Mode:** Pengaturan ukuran teks (`12px` - `24px`) dan opsi menampilkan/menyembunyikan avatar & timestamp.
- **Sound Notification (Opsional):** Efek suara halus (Web Audio API synthesizer, tanpa file eksternal) saat ada Super Chat atau pesan masuk.
- **Persistent Settings:** Semua pengaturan (transparansi, daftar bot, ukuran font, posisi/status pin) tersimpan otomatis di `localStorage`.

---

## 4. Arsitektur Teknis
- **Framework Desktop:** Electron (Main Process & Renderer Process dengan `contextBridge` IPC yang aman).
- **Backend Chat Fetcher (Node.js Main Process):**
  - Modul khusus YouTube Live Chat Scraper/Parser menggunakan endpoint *YouTube Innertube (`youtubei/v1/live_chat/get_live_chat`)* tanpa API Key.
  - Arsitektur modular (`ChatProvider`) sehingga penambahan `TikTokChatProvider` di tahap berikutnya tinggal dihubungkan ke event emitter yang sama.
- **Frontend UI (Renderer Process):**
  - HTML5, Modern CSS3 (Glassmorphism, CSS Variables untuk transparansi & ukuran font dinamis), dan Vanilla JavaScript yang ringan & responsif.

---

## 5. Shortcut Keyboard Global
- `Ctrl + Shift + L` : Toggle **Lock / Click-Through Mode** (Sangat penting agar streamer bisa mengaktifkan/menonaktifkan mode tembus klik kapan saja bahkan saat sedang di dalam game).
- `Ctrl + Shift + T` : Toggle **Always on Top (Pin on Top)**.
