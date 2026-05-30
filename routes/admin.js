const express = require('express');
const router = express.Router();
const { getDb } = require('../database');

// Auth middleware
function requireAdmin(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

// ==================== SUBJECTS ====================

router.post('/subjects', requireAdmin, (req, res) => {
  const db = getDb();
  const { year_id, name, code, type, credits, hours_per_week } = req.body;
  if (!year_id || !name) return res.status(400).json({ error: 'year_id and name required' });
  const result = db.prepare(
    'INSERT INTO subjects (year_id, name, code, type, credits, hours_per_week) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(year_id, name, code || '', type || 'theory', credits || 3, hours_per_week || 3);
  res.json({ id: result.lastInsertRowid, message: 'Subject created' });
});

router.put('/subjects/:id', requireAdmin, (req, res) => {
  const db = getDb();
  const { name, code, type, credits, hours_per_week } = req.body;
  db.prepare(
    'UPDATE subjects SET name=?, code=?, type=?, credits=?, hours_per_week=? WHERE id=?'
  ).run(name, code, type, credits, hours_per_week, req.params.id);
  res.json({ message: 'Subject updated' });
});

router.delete('/subjects/:id', requireAdmin, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM subjects WHERE id=?').run(req.params.id);
  res.json({ message: 'Subject deleted' });
});

// ==================== FACULTY ====================

router.post('/faculty', requireAdmin, (req, res) => {
  const db = getDb();
  const { name, designation, role, email, subjects_can_teach } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const result = db.prepare(
    'INSERT INTO faculty (name, designation, role, email, subjects_can_teach) VALUES (?, ?, ?, ?, ?)'
  ).run(name, designation || '', role || 'faculty', email || '', JSON.stringify(subjects_can_teach || []));
  res.json({ id: result.lastInsertRowid, message: 'Faculty created' });
});

router.put('/faculty/:id', requireAdmin, (req, res) => {
  const db = getDb();
  const { name, designation, role, email, subjects_can_teach } = req.body;
  db.prepare(
    'UPDATE faculty SET name=?, designation=?, role=?, email=?, subjects_can_teach=? WHERE id=?'
  ).run(name, designation, role, email, JSON.stringify(subjects_can_teach || []), req.params.id);
  res.json({ message: 'Faculty updated' });
});

router.delete('/faculty/:id', requireAdmin, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM faculty WHERE id=?').run(req.params.id);
  res.json({ message: 'Faculty deleted' });
});

// ==================== ROOMS ====================

router.post('/rooms', requireAdmin, (req, res) => {
  const db = getDb();
  const { name, type, capacity } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const result = db.prepare(
    'INSERT INTO rooms (name, type, capacity) VALUES (?, ?, ?)'
  ).run(name, type || 'classroom', capacity || 60);
  res.json({ id: result.lastInsertRowid, message: 'Room created' });
});

router.put('/rooms/:id', requireAdmin, (req, res) => {
  const db = getDb();
  const { name, type, capacity } = req.body;
  db.prepare('UPDATE rooms SET name=?, type=?, capacity=? WHERE id=?').run(name, type, capacity, req.params.id);
  res.json({ message: 'Room updated' });
});

router.delete('/rooms/:id', requireAdmin, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM rooms WHERE id=?').run(req.params.id);
  res.json({ message: 'Room deleted' });
});

// ==================== SECTIONS ====================

router.post('/sections', requireAdmin, (req, res) => {
  const db = getDb();
  const { year_id, name } = req.body;
  if (!year_id || !name) return res.status(400).json({ error: 'year_id and name required' });
  const result = db.prepare('INSERT INTO sections (year_id, name) VALUES (?, ?)').run(year_id, name);
  res.json({ id: result.lastInsertRowid, message: 'Section created' });
});

router.put('/sections/:id', requireAdmin, (req, res) => {
  const db = getDb();
  const { name } = req.body;
  db.prepare('UPDATE sections SET name=? WHERE id=?').run(name, req.params.id);
  res.json({ message: 'Section updated' });
});

router.delete('/sections/:id', requireAdmin, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM sections WHERE id=?').run(req.params.id);
  res.json({ message: 'Section deleted' });
});

// ==================== TIMETABLE ENTRY (manual) ====================

router.post('/timetable/entry', requireAdmin, (req, res) => {
  const db = getDb();
  const { section_id, time_slot_id, day_of_week, subject_id, faculty_id, room_id } = req.body;
  if (!section_id || !time_slot_id || !day_of_week) {
    return res.status(400).json({ error: 'section_id, time_slot_id, day_of_week required' });
  }

  // Check for existing entry and update or insert
  const existing = db.prepare(
    'SELECT id FROM timetable_entries WHERE section_id=? AND time_slot_id=? AND day_of_week=?'
  ).get(section_id, time_slot_id, day_of_week);

  if (existing) {
    db.prepare(
      'UPDATE timetable_entries SET subject_id=?, faculty_id=?, room_id=? WHERE id=?'
    ).run(subject_id || null, faculty_id || null, room_id || null, existing.id);
    res.json({ id: existing.id, message: 'Entry updated' });
  } else {
    const result = db.prepare(
      'INSERT INTO timetable_entries (section_id, time_slot_id, day_of_week, subject_id, faculty_id, room_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(section_id, time_slot_id, day_of_week, subject_id || null, faculty_id || null, room_id || null);
    res.json({ id: result.lastInsertRowid, message: 'Entry created' });
  }
});

router.delete('/timetable/entry/:id', requireAdmin, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM timetable_entries WHERE id=?').run(req.params.id);
  res.json({ message: 'Entry deleted' });
});

// ==================== CONFLICTS ====================

router.get('/conflicts', requireAdmin, (req, res) => {
  const db = getDb();
  const conflicts = [];

  // Faculty double-booked
  const facultyConflicts = db.prepare(`
    SELECT te1.id as id1, te2.id as id2, te1.day_of_week, ts.start_time, ts.end_time,
      f.name as faculty_name, te1.section_id as section1_id, te2.section_id as section2_id
    FROM timetable_entries te1
    JOIN timetable_entries te2 ON te1.faculty_id = te2.faculty_id
      AND te1.time_slot_id = te2.time_slot_id
      AND te1.day_of_week = te2.day_of_week
      AND te1.id < te2.id
    JOIN faculty f ON te1.faculty_id = f.id
    JOIN time_slots ts ON te1.time_slot_id = ts.id
    WHERE te1.faculty_id IS NOT NULL
  `).all();
  for (const c of facultyConflicts) {
    conflicts.push({ type: 'faculty', message: `Faculty ${c.faculty_name} double-booked on ${c.day_of_week} at ${c.start_time}`, ...c });
  }

  // Room double-booked
  const roomConflicts = db.prepare(`
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
  `).all();
  for (const c of roomConflicts) {
    conflicts.push({ type: 'room', message: `Room ${c.room_name} double-booked on ${c.day_of_week} at ${c.start_time}`, ...c });
  }

  res.json(conflicts);
});

// ==================== DASHBOARD STATS ====================

router.get('/stats', requireAdmin, (req, res) => {
  const db = getDb();
  const stats = {
    years: db.prepare('SELECT COUNT(*) as cnt FROM years').get().cnt,
    sections: db.prepare('SELECT COUNT(*) as cnt FROM sections').get().cnt,
    subjects: db.prepare('SELECT COUNT(*) as cnt FROM subjects').get().cnt,
    faculty: db.prepare('SELECT COUNT(*) as cnt FROM faculty').get().cnt,
    rooms: db.prepare('SELECT COUNT(*) as cnt FROM rooms').get().cnt,
    timetable_entries: db.prepare('SELECT COUNT(*) as cnt FROM timetable_entries').get().cnt
  };
  res.json(stats);
});

// ==================== AUTO-GENERATE TIMETABLE ====================

router.post('/generate', requireAdmin, (req, res) => {
  const db = getDb();
  const { scope, year_id, section_id } = req.body;

  try {
    // Get sections to generate for
    let sections = [];
    if (scope === 'section' && section_id) {
      sections = db.prepare('SELECT * FROM sections WHERE id=?').all(section_id);
    } else if (scope === 'year' && year_id) {
      sections = db.prepare('SELECT * FROM sections WHERE year_id=?').all(year_id);
    } else {
      sections = db.prepare('SELECT * FROM sections').all();
    }

    if (sections.length === 0) {
      return res.status(400).json({ error: 'No sections found for given scope' });
    }

    // Get all time slots (non-break)
    const allSlots = db.prepare('SELECT * FROM time_slots WHERE is_break=0 ORDER BY slot_number').all();
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    // Clear existing entries
    const deleteStmt = db.prepare('DELETE FROM timetable_entries WHERE section_id=?');
    for (const sec of sections) {
      deleteStmt.run(sec.id);
    }

    // Get all faculty (teaching faculty only - role = 'faculty')
    const allFaculty = db.prepare("SELECT * FROM faculty WHERE role = 'faculty'").all();
    // Get all rooms
    const allRooms = db.prepare('SELECT * FROM rooms').all();
    const classrooms = allRooms.filter(r => r.type === 'classroom');
    const labs = allRooms.filter(r => r.type === 'lab');

    const insertEntry = db.prepare(
      'INSERT INTO timetable_entries (section_id, time_slot_id, day_of_week, subject_id, faculty_id, room_id) VALUES (?, ?, ?, ?, ?, ?)'
    );

    // Track assignments to avoid conflicts
    // Key: `${day}_${slotId}` -> Set of faculty_ids, room_ids
    const facultyBusy = {}; // `${day}_${slotId}` -> Set<faculty_id>
    const roomBusy = {};    // `${day}_${slotId}` -> Set<room_id>

    function isFacultyFree(day, slotId, facultyId) {
      const key = `${day}_${slotId}`;
      return !facultyBusy[key] || !facultyBusy[key].has(facultyId);
    }

    function isRoomFree(day, slotId, roomId) {
      const key = `${day}_${slotId}`;
      return !roomBusy[key] || !roomBusy[key].has(roomId);
    }

    function markFacultyBusy(day, slotId, facultyId) {
      const key = `${day}_${slotId}`;
      if (!facultyBusy[key]) facultyBusy[key] = new Set();
      facultyBusy[key].add(facultyId);
    }

    function markRoomBusy(day, slotId, roomId) {
      const key = `${day}_${slotId}`;
      if (!roomBusy[key]) roomBusy[key] = new Set();
      roomBusy[key].add(roomId);
    }

    function shuffle(arr) {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    }

    // Generate for each section
    for (const section of sections) {
      const subjects = db.prepare('SELECT * FROM subjects WHERE year_id=?').all(section.year_id);
      if (subjects.length === 0) continue;

      // Build list of periods to assign: each subject repeated hours_per_week times
      let periodsToAssign = [];
      for (const subj of subjects) {
        for (let i = 0; i < subj.hours_per_week; i++) {
          periodsToAssign.push({ subject: subj, isLab: subj.type === 'lab' });
        }
      }

      // Shuffle periods
      periodsToAssign = shuffle(periodsToAssign);

      // Build available slots: day x slot combinations
      let availableSlots = [];
      for (const day of days) {
        for (const slot of allSlots) {
          availableSlots.push({ day, slot });
        }
      }
      availableSlots = shuffle(availableSlots);

      // Track which subjects are already assigned per day for this section
      const sectionDaySubjects = {}; // day -> Set<subject_id>
      for (const day of days) sectionDaySubjects[day] = new Set();

      // Track used slots for this section
      const sectionUsedSlots = new Set(); // `${day}_${slotId}`

      let periodIdx = 0;
      let slotIdx = 0;

      while (periodIdx < periodsToAssign.length && slotIdx < availableSlots.length * 3) {
        const { day, slot } = availableSlots[slotIdx % availableSlots.length];
        slotIdx++;

        const slotKey = `${day}_${slot.id}`;

        // Skip if this section already has this slot used
        if (sectionUsedSlots.has(slotKey)) continue;

        const period = periodsToAssign[periodIdx];
        const subj = period.subject;

        // Don't schedule same subject twice in same day for this section
        if (sectionDaySubjects[day].has(subj.id)) continue;

        // Find available faculty for this subject
        const eligibleFaculty = allFaculty.filter(f => {
          try {
            const canTeach = JSON.parse(f.subjects_can_teach || '[]');
            return canTeach.includes(subj.id);
          } catch { return false; }
        });

        // If no eligible faculty, use any faculty
        const facultyPool = eligibleFaculty.length > 0 ? eligibleFaculty : allFaculty;
        const shuffledFaculty = shuffle(facultyPool);
        let chosenFaculty = null;
        for (const f of shuffledFaculty) {
          if (isFacultyFree(day, slot.id, f.id)) {
            chosenFaculty = f;
            break;
          }
        }
        if (!chosenFaculty) continue;

        // Find available room
        const roomPool = subj.type === 'lab' ? (labs.length > 0 ? labs : allRooms) : (classrooms.length > 0 ? classrooms : allRooms);
        const shuffledRooms = shuffle(roomPool);
        let chosenRoom = null;
        for (const r of shuffledRooms) {
          if (isRoomFree(day, slot.id, r.id)) {
            chosenRoom = r;
            break;
          }
        }
        if (!chosenRoom) continue;

        // Assign
        insertEntry.run(section.id, slot.id, day, subj.id, chosenFaculty.id, chosenRoom.id);
        markFacultyBusy(day, slot.id, chosenFaculty.id);
        markRoomBusy(day, slot.id, chosenRoom.id);
        sectionUsedSlots.add(slotKey);
        sectionDaySubjects[day].add(subj.id);
        periodIdx++;
      }
    }

    const totalEntries = db.prepare('SELECT COUNT(*) as cnt FROM timetable_entries WHERE section_id IN (' +
      sections.map(() => '?').join(',') + ')').get(...sections.map(s => s.id)).cnt;

    res.json({
      success: true,
      message: `Timetable generated for ${sections.length} section(s). Total entries: ${totalEntries}`
    });
  } catch (err) {
    console.error('Generate error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==================== CLEAR TIMETABLE ====================

router.post('/clear', requireAdmin, (req, res) => {
  const db = getDb();
  const { scope, year_id, section_id } = req.body;

  if (scope === 'section' && section_id) {
    db.prepare('DELETE FROM timetable_entries WHERE section_id=?').run(section_id);
  } else if (scope === 'year' && year_id) {
    const sections = db.prepare('SELECT id FROM sections WHERE year_id=?').all(year_id);
    const stmt = db.prepare('DELETE FROM timetable_entries WHERE section_id=?');
    for (const s of sections) stmt.run(s.id);
  } else {
    db.prepare('DELETE FROM timetable_entries').run();
  }

  res.json({ success: true, message: 'Timetable cleared' });
});

module.exports = router;
