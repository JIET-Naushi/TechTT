const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { query, queryOne, run } = require('../database');
const { JWT_SECRET, COOKIE_NAME } = require('./auth');

// Auth middleware
function requireAdmin(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired, please login again' });
  }
}

// ==================== SUBJECTS ====================

router.post('/subjects', requireAdmin, async (req, res) => {
  try {
    const { year_id, name, code, type, credits, hours_per_week } = req.body;
    if (!year_id || !name) return res.status(400).json({ error: 'year_id and name required' });
    const result = await run(
      'INSERT INTO subjects (year_id,name,code,type,credits,hours_per_week) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [year_id, name, code||'', type||'theory', credits||3, hours_per_week||3]
    );
    res.json({ id: result.rows[0].id, message: 'Subject created' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/subjects/:id', requireAdmin, async (req, res) => {
  try {
    const { name, code, type, credits, hours_per_week } = req.body;
    await run(
      'UPDATE subjects SET name=$1,code=$2,type=$3,credits=$4,hours_per_week=$5 WHERE id=$6',
      [name, code, type, credits, hours_per_week, req.params.id]
    );
    res.json({ message: 'Subject updated' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/subjects/:id', requireAdmin, async (req, res) => {
  try {
    await run('DELETE FROM subjects WHERE id=$1', [req.params.id]);
    res.json({ message: 'Subject deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==================== FACULTY ====================

router.post('/faculty', requireAdmin, async (req, res) => {
  try {
    const { name, designation, role, email, subjects_can_teach } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const result = await run(
      'INSERT INTO faculty (name,designation,role,email,subjects_can_teach) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [name, designation||'', role||'faculty', email||'', JSON.stringify(subjects_can_teach||[])]
    );
    res.json({ id: result.rows[0].id, message: 'Faculty created' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/faculty/:id', requireAdmin, async (req, res) => {
  try {
    const { name, designation, role, email, subjects_can_teach } = req.body;
    await run(
      'UPDATE faculty SET name=$1,designation=$2,role=$3,email=$4,subjects_can_teach=$5 WHERE id=$6',
      [name, designation, role, email, JSON.stringify(subjects_can_teach||[]), req.params.id]
    );
    res.json({ message: 'Faculty updated' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/faculty/:id', requireAdmin, async (req, res) => {
  try {
    await run('DELETE FROM faculty WHERE id=$1', [req.params.id]);
    res.json({ message: 'Faculty deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==================== ROOMS ====================

router.post('/rooms', requireAdmin, async (req, res) => {
  try {
    const { name, type, capacity } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const result = await run(
      'INSERT INTO rooms (name,type,capacity) VALUES ($1,$2,$3) RETURNING id',
      [name, type||'classroom', capacity||60]
    );
    res.json({ id: result.rows[0].id, message: 'Room created' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/rooms/:id', requireAdmin, async (req, res) => {
  try {
    const { name, type, capacity } = req.body;
    await run('UPDATE rooms SET name=$1,type=$2,capacity=$3 WHERE id=$4', [name, type, capacity, req.params.id]);
    res.json({ message: 'Room updated' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/rooms/:id', requireAdmin, async (req, res) => {
  try {
    await run('DELETE FROM rooms WHERE id=$1', [req.params.id]);
    res.json({ message: 'Room deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==================== SECTIONS ====================

router.post('/sections', requireAdmin, async (req, res) => {
  try {
    const { year_id, name } = req.body;
    if (!year_id || !name) return res.status(400).json({ error: 'year_id and name required' });
    const result = await run(
      'INSERT INTO sections (year_id,name) VALUES ($1,$2) RETURNING id', [year_id, name]
    );
    res.json({ id: result.rows[0].id, message: 'Section created' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/sections/:id', requireAdmin, async (req, res) => {
  try {
    const { name } = req.body;
    await run('UPDATE sections SET name=$1 WHERE id=$2', [name, req.params.id]);
    res.json({ message: 'Section updated' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/sections/:id', requireAdmin, async (req, res) => {
  try {
    await run('DELETE FROM sections WHERE id=$1', [req.params.id]);
    res.json({ message: 'Section deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==================== TIMETABLE ENTRY ====================

router.post('/timetable/entry', requireAdmin, async (req, res) => {
  try {
    const { section_id, time_slot_id, day_of_week, subject_id, faculty_id, room_id } = req.body;
    if (!section_id || !time_slot_id || !day_of_week)
      return res.status(400).json({ error: 'section_id, time_slot_id, day_of_week required' });

    const existing = await queryOne(
      'SELECT id FROM timetable_entries WHERE section_id=$1 AND time_slot_id=$2 AND day_of_week=$3',
      [section_id, time_slot_id, day_of_week]
    );

    if (existing) {
      await run(
        'UPDATE timetable_entries SET subject_id=$1,faculty_id=$2,room_id=$3 WHERE id=$4',
        [subject_id||null, faculty_id||null, room_id||null, existing.id]
      );
      res.json({ id: existing.id, message: 'Entry updated' });
    } else {
      const result = await run(
        'INSERT INTO timetable_entries (section_id,time_slot_id,day_of_week,subject_id,faculty_id,room_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
        [section_id, time_slot_id, day_of_week, subject_id||null, faculty_id||null, room_id||null]
      );
      res.json({ id: result.rows[0].id, message: 'Entry created' });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/timetable/entry/:id', requireAdmin, async (req, res) => {
  try {
    await run('DELETE FROM timetable_entries WHERE id=$1', [req.params.id]);
    res.json({ message: 'Entry deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==================== CONFLICTS ====================

router.get('/conflicts', requireAdmin, async (req, res) => {
  try {
    const conflicts = [];

    const facultyConflicts = await query(`
      SELECT te1.id as id1, te2.id as id2, te1.day_of_week, ts.start_time, ts.end_time,
        f.name as faculty_name
      FROM timetable_entries te1
      JOIN timetable_entries te2 ON te1.faculty_id = te2.faculty_id
        AND te1.time_slot_id = te2.time_slot_id
        AND te1.day_of_week = te2.day_of_week
        AND te1.id < te2.id
      JOIN faculty f ON te1.faculty_id = f.id
      JOIN time_slots ts ON te1.time_slot_id = ts.id
      WHERE te1.faculty_id IS NOT NULL
    `);
    for (const c of facultyConflicts)
      conflicts.push({ type: 'faculty', message: `Faculty ${c.faculty_name} double-booked on ${c.day_of_week} at ${c.start_time}`, ...c });

    const roomConflicts = await query(`
      SELECT te1.id as id1, te2.id as id2, te1.day_of_week, ts.start_time, ts.end_time,
        r.name as room_name
      FROM timetable_entries te1
      JOIN timetable_entries te2 ON te1.room_id = te2.room_id
        AND te1.time_slot_id = te2.time_slot_id
        AND te1.day_of_week = te2.day_of_week
        AND te1.id < te2.id
      JOIN rooms r ON te1.room_id = r.id
      JOIN time_slots ts ON te1.time_slot_id = ts.id
      WHERE te1.room_id IS NOT NULL
    `);
    for (const c of roomConflicts)
      conflicts.push({ type: 'room', message: `Room ${c.room_name} double-booked on ${c.day_of_week} at ${c.start_time}`, ...c });

    res.json(conflicts);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==================== STATS ====================

router.get('/stats', requireAdmin, async (req, res) => {
  try {
    const [years, sections, subjects, faculty, rooms, entries] = await Promise.all([
      queryOne('SELECT COUNT(*) as cnt FROM years'),
      queryOne('SELECT COUNT(*) as cnt FROM sections'),
      queryOne('SELECT COUNT(*) as cnt FROM subjects'),
      queryOne('SELECT COUNT(*) as cnt FROM faculty'),
      queryOne('SELECT COUNT(*) as cnt FROM rooms'),
      queryOne('SELECT COUNT(*) as cnt FROM timetable_entries')
    ]);
    res.json({
      years: parseInt(years.cnt), sections: parseInt(sections.cnt),
      subjects: parseInt(subjects.cnt), faculty: parseInt(faculty.cnt),
      rooms: parseInt(rooms.cnt), timetable_entries: parseInt(entries.cnt)
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==================== GENERATE ====================

router.post('/generate', requireAdmin, async (req, res) => {
  try {
    const { scope, year_id, section_id } = req.body;

    let sections = [];
    if (scope === 'section' && section_id)
      sections = await query('SELECT * FROM sections WHERE id=$1', [section_id]);
    else if (scope === 'year' && year_id)
      sections = await query('SELECT * FROM sections WHERE year_id=$1', [year_id]);
    else
      sections = await query('SELECT * FROM sections');

    if (!sections.length) return res.status(400).json({ error: 'No sections found' });

    const allSlots = await query('SELECT * FROM time_slots WHERE is_break=0 ORDER BY slot_number');
    const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

    // Clear existing entries for these sections
    for (const sec of sections)
      await run('DELETE FROM timetable_entries WHERE section_id=$1', [sec.id]);

    const allFaculty = await query("SELECT * FROM faculty WHERE role = 'faculty'");
    const allRooms   = await query('SELECT * FROM rooms');
    const classrooms = allRooms.filter(r => r.type === 'classroom');
    const labs       = allRooms.filter(r => r.type === 'lab');

    // Track busy slots
    const facultyBusy = {};
    const roomBusy = {};
    const isFacultyFree = (d,s,f) => !facultyBusy[`${d}_${s}`]?.has(f);
    const isRoomFree    = (d,s,r) => !roomBusy[`${d}_${s}`]?.has(r);
    const markFaculty   = (d,s,f) => { const k=`${d}_${s}`; if(!facultyBusy[k]) facultyBusy[k]=new Set(); facultyBusy[k].add(f); };
    const markRoom      = (d,s,r) => { const k=`${d}_${s}`; if(!roomBusy[k]) roomBusy[k]=new Set(); roomBusy[k].add(r); };
    const shuffle = a => { const b=[...a]; for(let i=b.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[b[i],b[j]]=[b[j],b[i]];} return b; };

    for (const section of sections) {
      const subjects = await query('SELECT * FROM subjects WHERE year_id=$1', [section.year_id]);
      if (!subjects.length) continue;

      let periods = [];
      for (const subj of subjects)
        for (let i = 0; i < subj.hours_per_week; i++)
          periods.push(subj);
      periods = shuffle(periods);

      let slots = shuffle(days.flatMap(day => allSlots.map(slot => ({ day, slot }))));
      const usedSlots = new Set();
      const daySubjects = Object.fromEntries(days.map(d => [d, new Set()]));

      let pi = 0, si = 0;
      while (pi < periods.length && si < slots.length * 3) {
        const { day, slot } = slots[si % slots.length]; si++;
        const key = `${day}_${slot.id}`;
        if (usedSlots.has(key)) continue;

        const subj = periods[pi];
        if (daySubjects[day].has(subj.id)) continue;

        const eligible = allFaculty.filter(f => {
          try { return JSON.parse(f.subjects_can_teach||'[]').includes(subj.id); } catch { return false; }
        });
        const fPool = shuffle(eligible.length ? eligible : allFaculty);
        const chosenF = fPool.find(f => isFacultyFree(day, slot.id, f.id));
        if (!chosenF) continue;

        const rPool = shuffle(subj.type === 'lab' ? (labs.length ? labs : allRooms) : (classrooms.length ? classrooms : allRooms));
        const chosenR = rPool.find(r => isRoomFree(day, slot.id, r.id));
        if (!chosenR) continue;

        await run(
          'INSERT INTO timetable_entries (section_id,time_slot_id,day_of_week,subject_id,faculty_id,room_id) VALUES ($1,$2,$3,$4,$5,$6)',
          [section.id, slot.id, day, subj.id, chosenF.id, chosenR.id]
        );
        markFaculty(day, slot.id, chosenF.id);
        markRoom(day, slot.id, chosenR.id);
        usedSlots.add(key);
        daySubjects[day].add(subj.id);
        pi++;
      }
    }

    const totalRow = await queryOne(
      `SELECT COUNT(*) as cnt FROM timetable_entries WHERE section_id = ANY($1)`,
      [sections.map(s => s.id)]
    );
    res.json({ success: true, message: `Timetable generated for ${sections.length} section(s). Total entries: ${totalRow.cnt}` });
  } catch (err) {
    console.error('Generate error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==================== CLEAR ====================

router.post('/clear', requireAdmin, async (req, res) => {
  try {
    const { scope, year_id, section_id } = req.body;
    if (scope === 'section' && section_id) {
      await run('DELETE FROM timetable_entries WHERE section_id=$1', [section_id]);
    } else if (scope === 'year' && year_id) {
      const secs = await query('SELECT id FROM sections WHERE year_id=$1', [year_id]);
      for (const s of secs) await run('DELETE FROM timetable_entries WHERE section_id=$1', [s.id]);
    } else {
      await run('DELETE FROM timetable_entries');
    }
    res.json({ success: true, message: 'Timetable cleared' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
