const express = require('express');
const session = require('express-session');
const path = require('path');
const { initializeDatabase, getDb } = require('./database');

const app = express();
const PORT = 3000;

// Initialize database first
initializeDatabase();

// SQLite-backed session store — sessions survive server restarts
const SqliteStore = require('better-sqlite3-session-store')(session);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  store: new SqliteStore({
    client: getDb(),
    expired: {
      clear: true,
      intervalMs: 15 * 60 * 1000  // clear expired sessions every 15 min
    }
  }),
  secret: 'college-timetable-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    maxAge: 24 * 60 * 60 * 1000   // 24 hours
  }
}));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Routes
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const timetableRoutes = require('./routes/timetable');

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', timetableRoutes);

// Catch-all: serve index.html for unknown routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`College Timetable System running at http://localhost:${PORT}`);
  console.log(`Admin login: username=admin, password=admin123`);
});
