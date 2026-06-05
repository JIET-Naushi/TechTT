const express = require('express');
const router = express.Router();
const { query, queryOne } = require('../database');

// Public: GET settings (department name, Google Client ID, etc.)
router.get('/settings', async (req, res) => {
  try {
    const rows = await query('SELECT key, value FROM settings');
    const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));
    // Add env-based Google Client ID (not stored in DB for security)
    settings.google_client_id = process.env.GOOGLE_CLIENT_ID || '';
    res.json(settings);
  } catch (err) { res.status(500).json({ error: err.message}); }
});

router.get('/years', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM years ORDER BY id');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/sections', async (req, res) => {
  try {
    const { year_id } = req.query;
    let rows;
    if (year_id) {
      rows = await query(
        'SELECT s.*, y.display_name as year_name FROM sections s JOIN years y ON s.year_id = y.id WHERE s.year_id = $1 ORDER BY s.name',
        [year_id]
      );
    } else {
      rows = await query(
        'SELECT s.*, y.display_name as year_name FROM sections s JOIN years y ON s.year_id = y.id ORDER BY y.id, s.name'
      );
    }
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/subjects', async (req, res) => {
  try {
    const { year_id } = req.query;
    let rows;
    if (year_id) {
      rows = await query('SELECT * FROM subjects WHERE year_id = $1 ORDER BY name', [year_id]);
    } else {
      rows = await query(
        'SELECT s.*, y.display_name as year_name FROM subjects s JOIN years y ON s.year_id = y.id ORDER BY y.id, s.name'
      );
    }
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/faculty', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM faculty ORDER BY name');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/rooms', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM rooms ORDER BY type, name');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/timeslots', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM time_slots ORDER BY slot_number');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/timetable/class', async (req, res) => {
  try {
    const { section_id } = req.query;
    if (!section_id) return res.status(400).json({ error: 'section_id required' });
    const rows = await query(`
      SELECT te.*,
        s.name as subject_name, s.code as subject_code, s.type as subject_type,
        f.name as faculty_name,
        r.name as room_name, r.type as room_type,
        ts.slot_number, ts.start_time, ts.end_time, ts.is_break
      FROM timetable_entries te
      LEFT JOIN subjects s ON te.subject_id = s.id
      LEFT JOIN faculty f ON te.faculty_id = f.id
      LEFT JOIN rooms r ON te.room_id = r.id
      JOIN time_slots ts ON te.time_slot_id = ts.id
      WHERE te.section_id = $1
      ORDER BY te.day_of_week, ts.slot_number
    `, [section_id]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/timetable/faculty', async (req, res) => {
  try {
    const { faculty_id } = req.query;
    if (!faculty_id) return res.status(400).json({ error: 'faculty_id required' });
    const rows = await query(`
      SELECT te.*,
        s.name as subject_name, s.code as subject_code, s.type as subject_type,
        f.name as faculty_name,
        r.name as room_name, r.type as room_type,
        ts.slot_number, ts.start_time, ts.end_time, ts.is_break,
        sec.name as section_name,
        y.display_name as year_name
      FROM timetable_entries te
      LEFT JOIN subjects s ON te.subject_id = s.id
      LEFT JOIN faculty f ON te.faculty_id = f.id
      LEFT JOIN rooms r ON te.room_id = r.id
      JOIN time_slots ts ON te.time_slot_id = ts.id
      JOIN sections sec ON te.section_id = sec.id
      JOIN years y ON sec.year_id = y.id
      WHERE te.faculty_id = $1
      ORDER BY te.day_of_week, ts.slot_number
    `, [faculty_id]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/timetable/location', async (req, res) => {
  try {
    const { room_id } = req.query;
    if (!room_id) return res.status(400).json({ error: 'room_id required' });
    const rows = await query(`
      SELECT te.*,
        s.name as subject_name, s.code as subject_code, s.type as subject_type,
        f.name as faculty_name,
        r.name as room_name, r.type as room_type,
        ts.slot_number, ts.start_time, ts.end_time, ts.is_break,
        sec.name as section_name,
        y.display_name as year_name
      FROM timetable_entries te
      LEFT JOIN subjects s ON te.subject_id = s.id
      LEFT JOIN faculty f ON te.faculty_id = f.id
      LEFT JOIN rooms r ON te.room_id = r.id
      JOIN time_slots ts ON te.time_slot_id = ts.id
      JOIN sections sec ON te.section_id = sec.id
      JOIN years y ON sec.year_id = y.id
      WHERE te.room_id = $1
      ORDER BY te.day_of_week, ts.slot_number
    `, [room_id]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
