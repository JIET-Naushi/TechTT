const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { query, queryOne, run } = require('../database');

const JWT_SECRET = process.env.JWT_SECRET || 'techtt-jiet-secret-2024';
const COOKIE_NAME = 'techtt_token';

// The fixed recovery email for super admin password resets
const RECOVERY_EMAIL = 'nausheen.khilji@jietjodhpur.ac.in';

// Build nodemailer transporter from env vars (MAIL_USER + MAIL_PASS)
// Uses explicit Gmail SMTP settings — more reliable than service:'gmail' in serverless
function getMailer() {
  const user = process.env.MAIL_USER;
  const pass = process.env.MAIL_PASS;
  if (!user || !pass) throw new Error('MAIL_USER and MAIL_PASS environment variables are not set');
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,           // SSL on port 465
    auth: { user, pass },
    tls: { rejectUnauthorized: false },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000
  });
}

// ── Debug env check (super admin only — remove after confirming) ──────────────
router.get('/debug-mail-config', (req, res) => {
  res.json({
    MAIL_USER_set: !!process.env.MAIL_USER,
    MAIL_USER_value: process.env.MAIL_USER ? process.env.MAIL_USER.replace(/(.{3}).*(@.*)/, '$1***$2') : null,
    MAIL_PASS_set: !!process.env.MAIL_PASS,
    MAIL_PASS_length: process.env.MAIL_PASS ? process.env.MAIL_PASS.length : 0,
    APP_URL: process.env.APP_URL || null,
    VERCEL_URL: process.env.VERCEL_URL || null,
    NODE_ENV: process.env.NODE_ENV || null,
  });
});
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ success: false, message: 'Username and password required' });

    const user = await queryOne(
      'SELECT * FROM users WHERE username = $1 AND password = $2', [username, password]
    );
    if (!user)
      return res.status(401).json({ success: false, message: 'Invalid credentials' });

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role,
        loginType: 'password', department_id: null, isSuperAdmin: true },
      JWT_SECRET, { expiresIn: '24h' }
    );
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000
    });
    res.json({ success: true, user: { id: user.id, username: user.username, role: user.role, isSuperAdmin: true } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── Google OAuth — only allowed if email is a registered incharge ─────────────
router.post('/google', async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ success: false, message: 'No credential provided' });

    // Verify with Google's tokeninfo API
    const googleRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`);
    const info = await googleRes.json();

    if (info.error || !info.email_verified) {
      return res.status(401).json({ success: false, message: 'Invalid Google token' });
    }

    const { email, name, picture, sub } = info;

    // Check if this Google account is a registered timetable incharge
    const incharge = await queryOne(
      `SELECT di.*, d.name as dept_name, d.code as dept_code
       FROM dept_incharges di
       JOIN departments d ON di.department_id = d.id
       WHERE di.email = $1 AND di.is_active = true`,
      [email]
    );

    if (!incharge) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Your Google account is not registered as a timetable incharge. Please contact the super admin.'
      });
    }

    // Upsert into oauth_users
    await run(
      `INSERT INTO oauth_users (email, name, picture, role)
       VALUES ($1, $2, $3, 'incharge')
       ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, picture=EXCLUDED.picture`,
      [email, name || email, picture || '']
    );
    const oauthUser = await queryOne('SELECT * FROM oauth_users WHERE email=$1', [email]);

    // Issue JWT with department_id embedded
    const token = jwt.sign(
      {
        id: oauthUser.id,
        username: email,
        name: oauthUser.name,
        picture: oauthUser.picture,
        role: 'incharge',
        loginType: 'google',
        googleSub: sub,
        department_id: incharge.department_id,
        dept_name: incharge.dept_name,
        dept_code: incharge.dept_code,
        isSuperAdmin: false
      },
      JWT_SECRET, { expiresIn: '24h' }
    );
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000
    });
    res.json({
      success: true,
      user: {
        id: oauthUser.id, username: email,
        name: oauthUser.name, picture: oauthUser.picture,
        role: 'incharge', loginType: 'google',
        department_id: incharge.department_id,
        dept_name: incharge.dept_name,
        isSuperAdmin: false
      }
    });
  } catch (err) {
    console.error('Google login error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── Logout ────────────────────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ success: true });
});

// ── Forgot password — sends reset link to the fixed recovery email ─────────────
router.post('/forgot-password', async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ success: false, message: 'Username is required' });

    // Find super admin user
    const user = await queryOne('SELECT * FROM users WHERE username=$1', [username.trim()]);
    // Always respond the same way to avoid username enumeration
    if (!user) {
      return res.json({ success: true, message: `If that username exists, a reset link has been sent to ${RECOVERY_EMAIL}` });
    }

    // Expire any previous unused tokens for this user
    await run('UPDATE password_reset_tokens SET used=TRUE WHERE user_id=$1 AND used=FALSE', [user.id]);

    // Generate secure random token
    const token   = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await run(
      'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, token, expires]
    );

    // Build reset URL
    // APP_URL takes priority (set in Vercel env vars as full https://... URL)
    // Fall back to VERCEL_URL (auto-set by Vercel, no https://)
    // Fall back to localhost for local dev
    let baseUrl = process.env.APP_URL;
    if (!baseUrl) {
      if (process.env.VERCEL_URL) {
        baseUrl = `https://${process.env.VERCEL_URL}`;
      } else {
        baseUrl = 'http://localhost:3000';
      }
    }
    // Remove trailing slash
    baseUrl = baseUrl.replace(/\/$/, '');
    const resetUrl = `${baseUrl}/reset-password.html?token=${token}`;

    // Send email — surface errors to client for debugging
    try {
      const mailer = getMailer();
      await mailer.sendMail({
        from: `"JIET Timetable" <${process.env.MAIL_USER}>`,
        to: RECOVERY_EMAIL,
        subject: '🔐 Password Reset — JIET Timetable Admin',
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;border:1px solid #e0e0e0;border-radius:8px;">
            <h2 style="color:#1a237e;margin-top:0;">Password Reset Request</h2>
            <p>A password reset was requested for username: <strong>${user.username}</strong></p>
            <p>Click the button below to set a new password. This link is valid for <strong>1 hour</strong>.</p>
            <div style="text-align:center;margin:28px 0;">
              <a href="${resetUrl}"
                style="background:#1a237e;color:white;padding:12px 28px;border-radius:6px;text-decoration:none;font-size:1rem;font-weight:600;">
                Reset Password
              </a>
            </div>
            <p style="font-size:0.85rem;color:#666;">If you didn't request this, ignore this email — your password won't change.</p>
            <hr style="border:none;border-top:1px solid #eee;margin:16px 0;">
            <p style="font-size:0.82rem;color:#999;margin:0;">Or copy this link manually:<br>
              <a href="${resetUrl}" style="color:#1a237e;word-break:break-all;">${resetUrl}</a>
            </p>
          </div>
        `
      });
    } catch (mailErr) {
      console.error('Email send error:', mailErr);
      // Return the actual error so admin can diagnose
      return res.status(500).json({
        success: false,
        message: `Email delivery failed: ${mailErr.message}. Please check MAIL_USER and MAIL_PASS environment variables in Vercel.`,
        resetUrl // Include reset URL directly so admin can still reset
      });
    }

    res.json({ success: true, message: `Reset link sent to ${RECOVERY_EMAIL}` });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ success: false, message: `Server error: ${err.message}` });
  }
});

// ── Reset password — validate token and update password ──────────────────────
router.post('/reset-password', async (req, res) => {
  try {
    const { token, new_password } = req.body;
    if (!token || !new_password)
      return res.status(400).json({ success: false, message: 'Token and new password are required' });
    if (new_password.length < 6)
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });

    // Find valid, unused, unexpired token
    const rec = await queryOne(
      `SELECT prt.*, u.username FROM password_reset_tokens prt
       JOIN users u ON prt.user_id = u.id
       WHERE prt.token=$1 AND prt.used=FALSE AND prt.expires_at > NOW()`,
      [token]
    );

    if (!rec)
      return res.status(400).json({ success: false, message: 'Reset link is invalid or has expired. Please request a new one.' });

    // Update password and mark token as used
    await run('UPDATE users SET password=$1 WHERE id=$2', [new_password, rec.user_id]);
    await run('UPDATE password_reset_tokens SET used=TRUE WHERE id=$1', [rec.id]);

    res.json({ success: true, message: 'Password updated successfully. You can now log in.' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── Validate reset token (GET — for page pre-check) ───────────────────────────
router.get('/reset-password/validate', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.json({ valid: false });
    const rec = await queryOne(
      `SELECT id, expires_at FROM password_reset_tokens
       WHERE token=$1 AND used=FALSE AND expires_at > NOW()`,
      [token]
    );
    res.json({ valid: !!rec, expires_at: rec?.expires_at });
  } catch (err) {
    res.json({ valid: false });
  }
});

// ── Status ────────────────────────────────────────────────────────────────────
router.get('/status', (req, res) => {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) return res.json({ loggedIn: false });
  try {
    const user = jwt.verify(token, JWT_SECRET);
    res.json({
      loggedIn: true,
      user: {
        id: user.id, username: user.username, name: user.name,
        picture: user.picture, role: user.role,
        loginType: user.loginType, department_id: user.department_id,
        dept_name: user.dept_name, isSuperAdmin: user.isSuperAdmin
      }
    });
  } catch {
    res.clearCookie(COOKIE_NAME);
    res.json({ loggedIn: false });
  }
});

module.exports = router;
module.exports.JWT_SECRET = JWT_SECRET;
module.exports.COOKIE_NAME = COOKIE_NAME;
