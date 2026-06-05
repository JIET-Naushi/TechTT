const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const { initializeDatabase } = require('./database');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// For Vercel: Initialize DB on first request, not on module load
let dbInitialized = false;
let dbInitPromise = null;

async function ensureDbInitialized() {
  if (dbInitialized) return;
  if (dbInitPromise) return dbInitPromise;
  
  dbInitPromise = initializeDatabase()
    .then(() => {
      dbInitialized = true;
      console.log('Database initialized successfully');
    })
    .catch(err => {
      dbInitPromise = null; // Reset to allow retry
      console.error('DB init failed:', err.message);
      throw err;
    });
  
  return dbInitPromise;
}

// Middleware to ensure DB is ready before handling API requests
app.use('/api', async (req, res, next) => {
  try {
    await ensureDbInitialized();
    next();
  } catch (err) {
    console.error('Database initialization error:', err);
    res.status(500).json({ 
      error: 'Database initialization failed', 
      message: err.message,
      hint: 'Check POSTGRES_URL environment variable in Vercel settings'
    });
  }
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Routes
const authRoutes     = require('./routes/auth');
const adminRoutes    = require('./routes/admin');
const timetableRoutes = require('./routes/timetable');

app.use('/api/auth',  authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api',       timetableRoutes);

// Catch-all: serve index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Initialize DB then start (or export for Vercel)
const PORT = process.env.PORT || 3000;

// Local development server
if (process.env.NODE_ENV !== 'production') {
  ensureDbInitialized().then(() => {
    app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
      console.log(`Admin: admin / admin123`);
    });
  }).catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}

module.exports = app;
