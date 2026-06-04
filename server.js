const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const { initializeDatabase, saveAfterWrite } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Auto-save DB after every mutating API call
app.use('/api/admin', (req, res, next) => {
  res.on('finish', () => {
    if (['POST','PUT','DELETE'].includes(req.method)) saveAfterWrite();
  });
  next();
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Routes
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const timetableRoutes = require('./routes/timetable');

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', timetableRoutes);

// Catch-all: serve index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Initialize DB then start server
initializeDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`College Timetable System running at http://localhost:${PORT}`);
    console.log(`Admin login: username=admin, password=admin123`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});

module.exports = app; // needed for Vercel
