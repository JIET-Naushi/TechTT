const express = require('express');
const router = express.Router();
const { getDb } = require('../database');

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
  req.session.user = { id: user.id, username: user.username, role: user.role };
  res.json({ success: true, user: { id: user.id, username: user.username, role: user.role } });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// GET /api/auth/status
router.get('/status', (req, res) => {
  if (req.session.user) {
    res.json({ loggedIn: true, user: req.session.user });
  } else {
    res.json({ loggedIn: false });
  }
});

module.exports = router;
