const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { queryOne, run } = require('../database');

const JWT_SECRET = process.env.JWT_SECRET || 'techtt-jiet-secret-2024';
const COOKIE_NAME = 'techtt_token';

// ── Password login (kept for fallback / local dev) ────────────────────────────
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
      { id: user.id, username: user.username, role: user.role, loginType: 'password' },
      JWT_SECRET, { expiresIn: '24h' }
    );
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000
    });
    res.json({ success: true, user: { id: user.id, username: user.username, role: user.role } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── Google OAuth — receives the Google ID token from the frontend ─────────────
// We verify the token by calling Google's tokeninfo endpoint (no extra package needed)
router.post('/google', async (req, res) => {
  try {
    const { credential } = req.body; // Google JWT id_token
    if (!credential) return res.status(400).json({ success: false, message: 'No credential provided' });

    // Verify with Google's tokeninfo API
    const googleRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`);
    const info = await googleRes.json();

    if (info.error || !info.email_verified) {
      return res.status(401).json({ success: false, message: 'Invalid Google token' });
    }

    const { email, name, picture, sub } = info;

    // Upsert user in oauth_users table — each Google account gets its own session
    await run(
      `INSERT INTO oauth_users (email, name, picture, role)
       VALUES ($1, $2, $3, 'admin')
       ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, picture=EXCLUDED.picture`,
      [email, name || email, picture || '']
    );
    const oauthUser = await queryOne('SELECT * FROM oauth_users WHERE email=$1', [email]);

    // Issue JWT containing google email + sub so each account is unique
    const token = jwt.sign(
      { id: oauthUser.id, username: email, name: oauthUser.name, picture: oauthUser.picture,
        role: oauthUser.role, loginType: 'google', googleSub: sub },
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
      user: { id: oauthUser.id, username: email, name: oauthUser.name,
              picture: oauthUser.picture, role: oauthUser.role }
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

// ── Status ────────────────────────────────────────────────────────────────────
router.get('/status', (req, res) => {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) return res.json({ loggedIn: false });
  try {
    const user = jwt.verify(token, JWT_SECRET);
    res.json({
      loggedIn: true,
      user: { id: user.id, username: user.username, name: user.name,
              picture: user.picture, role: user.role, loginType: user.loginType }
    });
  } catch {
    res.clearCookie(COOKIE_NAME);
    res.json({ loggedIn: false });
  }
});

module.exports = router;
module.exports.JWT_SECRET = JWT_SECRET;
module.exports.COOKIE_NAME = COOKIE_NAME;
