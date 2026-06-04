const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { getDb } = require('../database');

const JWT_SECRET = process.env.JWT_SECRET || 'techtt-jiet-secret-2024';
const COOKIE_NAME = 'techtt_token';

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username and password required' });
  }
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND password = ?').get(username, password);
  if (!user) {
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '24h' }
  );

  // Set as httpOnly cookie so it works across page refreshes
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000   // 24 hours
  });

  res.json({ success: true, user: { id: user.id, username: user.username, role: user.role } });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ success: true });
});

// GET /api/auth/status
router.get('/status', (req, res) => {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) return res.json({ loggedIn: false });
  try {
    const user = jwt.verify(token, JWT_SECRET);
    res.json({ loggedIn: true, user: { id: user.id, username: user.username, role: user.role } });
  } catch {
    res.clearCookie(COOKIE_NAME);
    res.json({ loggedIn: false });
  }
});

module.exports = router;
module.exports.JWT_SECRET = JWT_SECRET;
module.exports.COOKIE_NAME = COOKIE_NAME;
