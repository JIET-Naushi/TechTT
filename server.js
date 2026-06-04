const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const { initializeDatabase } = require('./database');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

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

initializeDatabase()
  .then(() => {
    if (process.env.NODE_ENV !== 'production') {
      app.listen(PORT, () => {
        console.log(`Server running at http://localhost:${PORT}`);
        console.log(`Admin: admin / admin123`);
      });
    }
  })
  .catch(err => {
    console.error('DB init failed:', err.message);
    process.exit(1);
  });

module.exports = app;
