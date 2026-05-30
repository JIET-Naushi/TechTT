const express = require('express');
const router = express.Router();
const { getDb } = require('../database');

// GET /api/years
router.get('/years', (req, res) => {
  const db = getDb();
  const years = db.prepare('SELECT * FROM years ORDER BY id').all();
  res.json(years);
});

// GET /api/sections?year_id=
router.get('/sections', (req, res) => {
  const db = getDb();
  const { year_id } = req.query;
  let sections;
  if (year_id) {
    sections = db.prepare('SELECT s.*, y.display_name as year_name FROM sections s JOIN years y ON s.year_id = y.id WHERE s.year_id = ? ORDER BY s.name').all(year_id);
  } else {
    sections = db.prepare('SELECT s.*, y.display_name as year_name FROM sections s JOIN years y ON s.year_id = y.id ORDER BY y.id, s.name').all();
  }
  res.json(sections);
});

// GET /api/subjects?year_id=
router.get('/subjects', (req, res) => {
  const db = getDb();
  const { year_id } = req.query;
  let subjects;
  if (year_id) {
    subjects = db.prepare('SELECT * FROM subjects WHERE year_id = ? ORDER BY name').all(year_id);
  } else {
    subjects = db.prepare('SELECT s.*, y.display_name as year_name FROM subjects s JOIN years y ON s.year_id = y.id ORDER BY y.id, s.name').all();
  }
  res.json(subjects);
});

// GET /api/faculty
router.get('/faculty', (req, res) => {
  const db = getDb();
  const faculty = db.prepare('SELECT * FROM faculty ORDER BY name').all();
  res.json(faculty);
});

// GET /api/rooms
router.get('/rooms', (req, res) => {
  const db = getDb();
  const rooms = db.prepare('SELECT * FROM rooms ORDER BY type, name').all();
  res.json(rooms);
});

// GET /api/timeslots
router.get('/timeslots', (req, res) => {
  const db = getDb();
  const slots = db.prepare('SELECT * FROM time_slots ORDER BY slot_number').all();
  res.json(slots);
});

// GET /api/timetable/class?section_id=
router.get('/timetable/class', (req, res) => {
  const db = getDb();
  const { section_id } = req.query;
  if (!section_id) return res.status(400).json({ error: 'section_id required' });

  const entries = db.prepare(`
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
    WHERE te.section_id = ?
    ORDER BY te.day_of_week, ts.slot_number
  `).all(section_id);

  res.json(entries);
});

// GET /api/timetable/faculty?faculty_id=
router.get('/timetable/faculty', (req, res) => {
  const db = getDb();
  const { faculty_id } = req.query;
  if (!faculty_id) return res.status(400).json({ error: 'faculty_id required' });

  const entries = db.prepare(`
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
    WHERE te.faculty_id = ?
    ORDER BY te.day_of_week, ts.slot_number
  `).all(faculty_id);

  res.json(entries);
});

// GET /api/timetable/location?room_id=
router.get('/timetable/location', (req, res) => {
  const db = getDb();
  const { room_id } = req.query;
  if (!room_id) return res.status(400).json({ error: 'room_id required' });

  const entries = db.prepare(`
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
    WHERE te.room_id = ?
    ORDER BY te.day_of_week, ts.slot_number
  `).all(room_id);

  res.json(entries);
});

module.exports = router;
