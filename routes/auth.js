const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { query, queryOne, run } = require('../database');

const JWT_SECRET = process.env.JWT_SECRET || 'techtt-jiet-secret-2024';
const COOKIE_NAME = 'techtt_token';

// ── Super Admin password login ────────────────────────────────────────────────
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
