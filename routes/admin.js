const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { query, queryOne, run } = require('../database');
const { JWT_SECRET, COOKIE_NAME } = require('./auth');

// ── Auth middleware: any logged-in user ───────────────────────────────────────
function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired, please login again' });
  }
}

// ── Super admin only middleware ───────────────────────────────────────────────
function requireSuperAdmin(req, res, next) {
  if (!req.user || !req.user.isSuperAdmin) {
    return res.status(403).json({ error: 'Super admin access required' });
  }
  next();
}

// ── Resolve department_id: incharge sees only their dept, super admin can specify ──
function getDeptId(req) {
  if (req.user.isSuperAdmin) {
    // Super admin can pass ?department_id or body.department_id
    return parseInt(req.query.department_id || req.body.department_id || 1);
  }
  // Incharge always scoped to their own department
  return req.user.department_id;
}

// ── Verify a resource belongs to the user's department ───────────────────────
async function verifyDeptOwnership(table, id, deptId) {
  let row;
  if (table === 'years' || table === 'faculty' || table === 'rooms' || table === 'time_slots') {
    row = await queryOne(`SELECT id FROM ${table} WHERE id=$1 AND department_id=$2`, [id, deptId]);
  } else if (table === 'sections') {
    row = await queryOne(
      `SELECT s.id FROM sections s JOIN years y ON s.year_id=y.id WHERE s.id=$1 AND y.department_id=$2`,
      [id, deptId]
    );
  } else if (table === 'subjects') {
    row = await queryOne(
      `SELECT s.id FROM subjects s JOIN years y ON s.year_id=y.id WHERE s.id=$1 AND y.department_id=$2`,
      [id, deptId]
    );
  }
  return !!row;
}

// =============================================================================
// ==================== SUPER ADMIN: INCHARGE MANAGEMENT ======================
// =============================================================================

// List all incharges (super admin only)
router.get('/incharges', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const rows = await query(`
      SELECT di.*, d.name as dept_name, d.code as dept_code
      FROM dept_incharges di
      JOIN departments d ON di.department_id = d.id
      ORDER BY d.name, di.name
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Add incharge for a department (super admin only)
router.post('/incharges', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const { department_id, email, name } = req.body;
    if (!department_id || !email) return res.status(400).json({ error: 'department_id and email required' });

    // Validate email format
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    const result = await run(
      `INSERT INTO dept_incharges (department_id, email, name, is_active, added_by)
       VALUES ($1, $2, $3, true, 'super_admin')
       ON CONFLICT (department_id, email) DO UPDATE SET is_active=true, name=EXCLUDED.name
       RETURNING id`,
      [department_id, email.toLowerCase().trim(), name || email]
    );
    res.json({ id: result.rows[0].id, message: 'Incharge added successfully' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Update incharge (super admin only)
router.put('/incharges/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const { name, is_active, department_id } = req.body;
    await run(
      `UPDATE dept_incharges SET name=$1, is_active=$2, department_id=$3 WHERE id=$4`,
      [name, is_active, department_id, req.params.id]
    );
    res.json({ message: 'Incharge updated' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Remove incharge (super admin only)
router.delete('/incharges/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    await run('DELETE FROM dept_incharges WHERE id=$1', [req.params.id]);
    res.json({ message: 'Incharge removed' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// =============================================================================
// ==================== SUPER ADMIN: DEPARTMENT MANAGEMENT ====================
// =============================================================================

router.get('/departments', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const rows = await query(`
      SELECT d.*, 
        COUNT(DISTINCT di.id) as incharge_count,
        COUNT(DISTINCT f.id) as faculty_count
      FROM departments d
      LEFT JOIN dept_incharges di ON di.department_id = d.id AND di.is_active = true
      LEFT JOIN faculty f ON f.department_id = d.id
      GROUP BY d.id ORDER BY d.id
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/departments', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const { name, code } = req.body;
    if (!name || !code) return res.status(400).json({ error: 'name and code required' });
    const result = await run(
      'INSERT INTO departments (name, code) VALUES ($1, $2) RETURNING id',
      [name, code.toUpperCase()]
    );
    // Seed default time slots for new department
    const timeSlotsData = [
      [1,"08:00","09:00",0],[2,"09:00","09:50",0],[3,"09:50","10:40",0],
      [4,"10:40","11:30",0],[5,"11:30","12:30",1],[6,"12:30","13:20",0],
      [7,"13:20","14:10",0],[8,"14:10","15:00",0]
    ];
    const newDeptId = result.rows[0].id;
    for (const [slot,start,end,is_break] of timeSlotsData) {
      await run('INSERT INTO time_slots (department_id,slot_number,start_time,end_time,is_break) VALUES ($1,$2,$3,$4,$5)',
        [newDeptId, slot, start, end, is_break]);
    }
    // Seed default years
    await run('INSERT INTO years (department_id,name,display_name) VALUES ($1,$2,$3)', [newDeptId,"year1","B.Tech I Year"]);
    await run('INSERT INTO years (department_id,name,display_name) VALUES ($1,$2,$3)', [newDeptId,"year2","B.Tech II Year"]);
    await run('INSERT INTO years (department_id,name,display_name) VALUES ($1,$2,$3)', [newDeptId,"year3","B.Tech III Year"]);
    res.json({ id: newDeptId, message: 'Department created with default years and time slots' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/departments/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const { name, code } = req.body;
    await run('UPDATE departments SET name=$1, code=$2 WHERE id=$3', [name, code, req.params.id]);
    res.json({ message: 'Department updated' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/departments/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    if (req.params.id == 1) return res.status(400).json({ error: 'Cannot delete the default department' });
    await run('DELETE FROM departments WHERE id=$1', [req.params.id]);
    res.json({ message: 'Department deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// =============================================================================
// ==================== SETTINGS (scoped by department) ========================
// =============================================================================

router.get('/settings', requireAuth, async (req, res) => {
  try {
    const rows = await query('SELECT key, value FROM settings');
    const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));
    // Also return current department info
    const deptId = getDeptId(req);
    const dept = await queryOne('SELECT * FROM departments WHERE id=$1', [deptId]);
    settings.current_department = dept;
    res.json(settings);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/settings', requireAuth, async (req, res) => {
  try {
    const updates = req.body;
    // college_name is global (super admin only)
    if (updates.college_name && !req.user.isSuperAdmin) {
      delete updates.college_name;
    }
    for (const [key, value] of Object.entries(updates)) {
      if (key === 'current_department') continue; // skip non-settings fields
      await run(
        'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value',
        [key, value]
      );
    }
    // Update department name if provided
    if (updates.department_name) {
      const deptId = getDeptId(req);
      await run('UPDATE departments SET name=$1 WHERE id=$2', [updates.department_name, deptId]);
    }
    res.json({ message: 'Settings saved' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// =============================================================================
// ==================== SUBJECTS ===============================================
// =============================================================================

router.post('/subjects', requireAuth, async (req, res) => {
  try {
    const { year_id, name, code, type, category, credits, hours_per_week } = req.body;
    if (!year_id || !name) return res.status(400).json({ error: 'year_id and name required' });
    const deptId = getDeptId(req);
    if (!(await verifyDeptOwnership('years', year_id, deptId)))
      return res.status(403).json({ error: 'Year does not belong to your department' });
    const result = await run(
      'INSERT INTO subjects (year_id,name,code,type,category,credits,hours_per_week) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [year_id, name, code||'', type||'theory', category||'regular', credits||3, hours_per_week||3]
    );
    res.json({ id: result.rows[0].id, message: 'Subject created' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/subjects/:id', requireAuth, async (req, res) => {
  try {
    const deptId = getDeptId(req);
    if (!(await verifyDeptOwnership('subjects', req.params.id, deptId)))
      return res.status(403).json({ error: 'Subject does not belong to your department' });
    const { name, code, type, category, credits, hours_per_week } = req.body;
    await run('UPDATE subjects SET name=$1,code=$2,type=$3,category=$4,credits=$5,hours_per_week=$6 WHERE id=$7',
      [name, code, type, category||'regular', credits, hours_per_week, req.params.id]);
    res.json({ message: 'Subject updated' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/subjects/:id', requireAuth, async (req, res) => {
  try {
    const deptId = getDeptId(req);
    if (!(await verifyDeptOwnership('subjects', req.params.id, deptId)))
      return res.status(403).json({ error: 'Subject does not belong to your department' });
    await run('DELETE FROM subjects WHERE id=$1', [req.params.id]);
    res.json({ message: 'Subject deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// =============================================================================
// ==================== FACULTY ================================================
// =============================================================================

router.post('/faculty', requireAuth, async (req, res) => {
  try {
    const { name, designation, role, email, subjects_can_teach } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const deptId = getDeptId(req);
    const result = await run(
      'INSERT INTO faculty (department_id,name,designation,role,email,subjects_can_teach) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [deptId, name, designation||'', role||'faculty', email||'', JSON.stringify(subjects_can_teach||[])]
    );
    res.json({ id: result.rows[0].id, message: 'Faculty created' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/faculty/:id', requireAuth, async (req, res) => {
  try {
    const deptId = getDeptId(req);
    if (!(await verifyDeptOwnership('faculty', req.params.id, deptId)))
      return res.status(403).json({ error: 'Faculty does not belong to your department' });
    const { name, designation, role, email, subjects_can_teach } = req.body;
    await run('UPDATE faculty SET name=$1,designation=$2,role=$3,email=$4,subjects_can_teach=$5 WHERE id=$6',
      [name, designation, role, email, JSON.stringify(subjects_can_teach||[]), req.params.id]);
    res.json({ message: 'Faculty updated' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/faculty/:id', requireAuth, async (req, res) => {
  try {
    const deptId = getDeptId(req);
    if (!(await verifyDeptOwnership('faculty', req.params.id, deptId)))
      return res.status(403).json({ error: 'Faculty does not belong to your department' });
    await run('DELETE FROM faculty WHERE id=$1', [req.params.id]);
    res.json({ message: 'Faculty deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// =============================================================================
// ==================== ROOMS ==================================================
// =============================================================================

router.post('/rooms', requireAuth, async (req, res) => {
  try {
    const { name, type, capacity } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const deptId = getDeptId(req);
    const result = await run(
      'INSERT INTO rooms (department_id,name,type,capacity) VALUES ($1,$2,$3,$4) RETURNING id',
      [deptId, name, type||'classroom', capacity||60]
    );
    res.json({ id: result.rows[0].id, message: 'Room created' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/rooms/:id', requireAuth, async (req, res) => {
  try {
    const deptId = getDeptId(req);
    if (!(await verifyDeptOwnership('rooms', req.params.id, deptId)))
      return res.status(403).json({ error: 'Room does not belong to your department' });
    const { name, type, capacity } = req.body;
    await run('UPDATE rooms SET name=$1,type=$2,capacity=$3 WHERE id=$4', [name, type, capacity, req.params.id]);
    res.json({ message: 'Room updated' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/rooms/:id', requireAuth, async (req, res) => {
  try {
    const deptId = getDeptId(req);
    if (!(await verifyDeptOwnership('rooms', req.params.id, deptId)))
      return res.status(403).json({ error: 'Room does not belong to your department' });
    await run('DELETE FROM rooms WHERE id=$1', [req.params.id]);
    res.json({ message: 'Room deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// =============================================================================
// ==================== SECTIONS ===============================================
// =============================================================================

router.post('/sections', requireAuth, async (req, res) => {
  try {
    const { year_id, name } = req.body;
    if (!year_id || !name) return res.status(400).json({ error: 'year_id and name required' });
    const deptId = getDeptId(req);
    if (!(await verifyDeptOwnership('years', year_id, deptId)))
      return res.status(403).json({ error: 'Year does not belong to your department' });
    const result = await run('INSERT INTO sections (year_id,name) VALUES ($1,$2) RETURNING id', [year_id, name]);
    res.json({ id: result.rows[0].id, message: 'Section created' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/sections/:id', requireAuth, async (req, res) => {
  try {
    const deptId = getDeptId(req);
    if (!(await verifyDeptOwnership('sections', req.params.id, deptId)))
      return res.status(403).json({ error: 'Section does not belong to your department' });
    const { name, lab_subsections, subsection_names } = req.body;
    const sets = [], vals = [];
    if (name             !== undefined) { sets.push(`name=$${sets.length+1}`);             vals.push(name); }
    if (lab_subsections  !== undefined) { sets.push(`lab_subsections=$${sets.length+1}`);  vals.push(lab_subsections); }
    if (subsection_names !== undefined) { sets.push(`subsection_names=$${sets.length+1}`); vals.push(JSON.stringify(subsection_names)); }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    vals.push(req.params.id);
    await run(`UPDATE sections SET ${sets.join(',')} WHERE id=$${vals.length}`, vals);
    res.json({ message: 'Section updated' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/sections/:id', requireAuth, async (req, res) => {
  try {
    const deptId = getDeptId(req);
    if (!(await verifyDeptOwnership('sections', req.params.id, deptId)))
      return res.status(403).json({ error: 'Section does not belong to your department' });
    await run('DELETE FROM sections WHERE id=$1', [req.params.id]);
    res.json({ message: 'Section deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// =============================================================================
// ==================== TIMETABLE ENTRY ========================================
// =============================================================================

router.post('/timetable/entry', requireAuth, async (req, res) => {
  try {
    const { section_id, time_slot_id, day_of_week, subject_id, faculty_id, room_id } = req.body;
    if (!section_id || !time_slot_id || !day_of_week)
      return res.status(400).json({ error: 'section_id, time_slot_id, day_of_week required' });
    const deptId = getDeptId(req);
    if (!(await verifyDeptOwnership('sections', section_id, deptId)))
      return res.status(403).json({ error: 'Section does not belong to your department' });
    const existing = await queryOne(
      'SELECT id FROM timetable_entries WHERE section_id=$1 AND time_slot_id=$2 AND day_of_week=$3',
      [section_id, time_slot_id, day_of_week]
    );
    if (existing) {
      await run('UPDATE timetable_entries SET subject_id=$1,faculty_id=$2,room_id=$3 WHERE id=$4',
        [subject_id||null, faculty_id||null, room_id||null, existing.id]);
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

router.delete('/timetable/entry/:id', requireAuth, async (req, res) => {
  try {
    await run('DELETE FROM timetable_entries WHERE id=$1', [req.params.id]);
    res.json({ message: 'Entry deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// =============================================================================
// ==================== CONFLICTS ==============================================
// =============================================================================

router.get('/conflicts', requireAuth, async (req, res) => {
  try {
    const deptId = getDeptId(req);
    const conflicts = [];

    const facultyConflicts = await query(`
      SELECT te1.id as id1, te2.id as id2, te1.day_of_week, ts.start_time,
        f.name as faculty_name
      FROM timetable_entries te1
      JOIN timetable_entries te2 ON te1.faculty_id=te2.faculty_id
        AND te1.time_slot_id=te2.time_slot_id AND te1.day_of_week=te2.day_of_week AND te1.id<te2.id
      JOIN faculty f ON te1.faculty_id=f.id AND f.department_id=$1
      JOIN time_slots ts ON te1.time_slot_id=ts.id
      WHERE te1.faculty_id IS NOT NULL
    `, [deptId]);
    for (const c of facultyConflicts)
      conflicts.push({ type: 'faculty', message: `Faculty ${c.faculty_name} double-booked on ${c.day_of_week} at ${c.start_time}` });

    const roomConflicts = await query(`
      SELECT te1.id as id1, te2.id as id2, te1.day_of_week, ts.start_time,
        r.name as room_name
      FROM timetable_entries te1
      JOIN timetable_entries te2 ON te1.room_id=te2.room_id
        AND te1.time_slot_id=te2.time_slot_id AND te1.day_of_week=te2.day_of_week AND te1.id<te2.id
      JOIN rooms r ON te1.room_id=r.id AND r.department_id=$1
      JOIN time_slots ts ON te1.time_slot_id=ts.id
      WHERE te1.room_id IS NOT NULL
    `, [deptId]);
    for (const c of roomConflicts)
      conflicts.push({ type: 'room', message: `Room ${c.room_name} double-booked on ${c.day_of_week} at ${c.start_time}` });

    res.json(conflicts);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// =============================================================================
// ==================== STATS ==================================================
// =============================================================================

router.get('/stats', requireAuth, async (req, res) => {
  try {
    const deptId = getDeptId(req);
    const [years, sections, subjects, faculty, rooms, entries] = await Promise.all([
      queryOne('SELECT COUNT(*) as cnt FROM years WHERE department_id=$1', [deptId]),
      queryOne('SELECT COUNT(*) as cnt FROM sections s JOIN years y ON s.year_id=y.id WHERE y.department_id=$1', [deptId]),
      queryOne('SELECT COUNT(*) as cnt FROM subjects s JOIN years y ON s.year_id=y.id WHERE y.department_id=$1', [deptId]),
      queryOne('SELECT COUNT(*) as cnt FROM faculty WHERE department_id=$1', [deptId]),
      queryOne('SELECT COUNT(*) as cnt FROM rooms WHERE department_id=$1', [deptId]),
      queryOne('SELECT COUNT(*) as cnt FROM timetable_entries te JOIN sections sec ON te.section_id=sec.id JOIN years y ON sec.year_id=y.id WHERE y.department_id=$1', [deptId])
    ]);
    res.json({
      years: parseInt(years.cnt), sections: parseInt(sections.cnt),
      subjects: parseInt(subjects.cnt), faculty: parseInt(faculty.cnt),
      rooms: parseInt(rooms.cnt), timetable_entries: parseInt(entries.cnt)
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// =============================================================================
// ==================== LAB BATCH FACULTY ASSIGNMENTS ==========================
// =============================================================================

// GET all assignments for a section
router.get('/lab-assignments/:sectionId', requireAuth, async (req, res) => {
  try {
    const deptId = getDeptId(req);
    if (!(await verifyDeptOwnership('sections', req.params.sectionId, deptId)))
      return res.status(403).json({ error: 'Section not in your department' });

    const rows = await query(`
      SELECT la.*, s.name as subject_name, s.type as subject_type,
             f.name as faculty_name
      FROM lab_assignments la
      JOIN subjects s ON la.subject_id = s.id
      LEFT JOIN faculty f ON la.faculty_id = f.id
      WHERE la.section_id = $1
      ORDER BY s.name, la.batch_name
    `, [req.params.sectionId]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// UPSERT a single batch assignment
router.post('/lab-assignments', requireAuth, async (req, res) => {
  try {
    const { section_id, subject_id, batch_name, faculty_id } = req.body;
    if (!section_id || !subject_id || !batch_name)
      return res.status(400).json({ error: 'section_id, subject_id, batch_name required' });
    const deptId = getDeptId(req);
    if (!(await verifyDeptOwnership('sections', section_id, deptId)))
      return res.status(403).json({ error: 'Section not in your department' });

    if (faculty_id) {
      await run(`
        INSERT INTO lab_assignments (section_id, subject_id, batch_name, faculty_id)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (section_id, subject_id, batch_name)
        DO UPDATE SET faculty_id = EXCLUDED.faculty_id
      `, [section_id, subject_id, batch_name, faculty_id]);
    } else {
      // faculty_id = null means "remove assignment"
      await run(
        'DELETE FROM lab_assignments WHERE section_id=$1 AND subject_id=$2 AND batch_name=$3',
        [section_id, subject_id, batch_name]
      );
    }
    res.json({ message: 'Assignment saved' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE all assignments for a section (bulk reset)
router.delete('/lab-assignments/:sectionId', requireAuth, async (req, res) => {
  try {
    const deptId = getDeptId(req);
    if (!(await verifyDeptOwnership('sections', req.params.sectionId, deptId)))
      return res.status(403).json({ error: 'Section not in your department' });
    await run('DELETE FROM lab_assignments WHERE section_id=$1', [req.params.sectionId]);
    res.json({ message: 'All lab assignments cleared for this section' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// =============================================================================
// ==================== GENERATE ===============================================
// =============================================================================

router.post('/generate', requireAuth, async (req, res) => {
  try {
    const { scope, year_id, section_id } = req.body;
    const deptId = getDeptId(req);

    let sections = [];
    if (scope === 'section' && section_id) {
      if (!(await verifyDeptOwnership('sections', section_id, deptId)))
        return res.status(403).json({ error: 'Section not in your department' });
      sections = await query('SELECT * FROM sections WHERE id=$1', [section_id]);
    } else if (scope === 'year' && year_id) {
      if (!(await verifyDeptOwnership('years', year_id, deptId)))
        return res.status(403).json({ error: 'Year not in your department' });
      sections = await query('SELECT * FROM sections WHERE year_id=$1', [year_id]);
    } else {
      sections = await query(
        'SELECT s.*, s.lab_subsections FROM sections s JOIN years y ON s.year_id=y.id WHERE y.department_id=$1', [deptId]
      );
    }

    if (!sections.length) return res.status(400).json({ error: 'No sections found for this department' });

    const allSlots = await query('SELECT * FROM time_slots WHERE is_break=0 AND department_id=$1 ORDER BY slot_number', [deptId]);
    const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

    for (const sec of sections)
      await run('DELETE FROM timetable_entries WHERE section_id=$1', [sec.id]);

    const allFaculty  = await query("SELECT * FROM faculty WHERE role='faculty' AND department_id=$1", [deptId]);
    const allRooms    = await query('SELECT * FROM rooms WHERE department_id=$1', [deptId]);
    const classrooms  = allRooms.filter(r => r.type === 'classroom');
    const labs        = allRooms.filter(r => r.type === 'lab');

    const facultyBusy = {};
    const roomBusy    = {};
    const isFacultyFree = (d,s,f) => !facultyBusy[`${d}_${s}`]?.has(f);
    const isRoomFree    = (d,s,r) => !roomBusy[`${d}_${s}`]?.has(r);
    const markFaculty   = (d,s,f) => { const k=`${d}_${s}`; if(!facultyBusy[k]) facultyBusy[k]=new Set(); facultyBusy[k].add(f); };
    const markRoom      = (d,s,r) => { const k=`${d}_${s}`; if(!roomBusy[k]) roomBusy[k]=new Set(); roomBusy[k].add(r); };
    const shuffle = a => { const b=[...a]; for(let i=b.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[b[i],b[j]]=[b[j],b[i]];} return b; };

    const shuffledClassrooms = shuffle([...classrooms]);
    const sectionRoomMap = {};
    sections.forEach((sec,idx) => {
      if (shuffledClassrooms.length > 0)
        sectionRoomMap[sec.id] = shuffledClassrooms[idx % shuffledClassrooms.length].id;
    });

    for (const section of sections) {
      const subjects = await query('SELECT * FROM subjects WHERE year_id=$1', [section.year_id]);
      if (!subjects.length) continue;

      const numSubsections = section.lab_subsections || 2;
      let batchNames;
      try { batchNames = JSON.parse(section.subsection_names || 'null'); } catch { batchNames = null; }
      if (!Array.isArray(batchNames) || batchNames.length !== numSubsections) {
        batchNames = Array.from({ length: numSubsections }, (_, i) => String.fromCharCode(65 + i));
      }

      // Load pre-assigned lab faculty for this section
      const labAssignments = await query(
        'SELECT * FROM lab_assignments WHERE section_id=$1', [section.id]
      );
      // Map: subjectId → { batchName → facultyId }
      const assignedFaculty = {};
      for (const a of labAssignments) {
        if (!assignedFaculty[a.subject_id]) assignedFaculty[a.subject_id] = {};
        assignedFaculty[a.subject_id][a.batch_name] = a.faculty_id;
      }

      // ── Separate theory/BTU and lab subjects ─────────────────────────────
      const theorySubjects = subjects.filter(s => s.type !== 'lab');
      const labSubjects    = subjects.filter(s => s.type === 'lab');

      // ── Build slot grid: day → [slot, slot, ...] ─────────────────────────
      // For labs: assign ALL hours of a subject on the SAME day, back-to-back if possible
      const usedSlots   = new Set(); // "day_slotId"
      const dayLoad     = Object.fromEntries(days.map(d => [d, 0])); // theory count per day
      const dayLabLoad  = Object.fromEntries(days.map(d => [d, 0])); // lab count per day

      // ── Schedule LAB subjects first (consecutive on one day, no lunch break between) ──
      for (const subj of labSubjects) {
        const hoursNeeded = subj.hours_per_week; // usually 2
        let placed = false;

        for (const day of shuffle([...days])) {
          // Get free teaching slots for this day
          const freeSlots = allSlots.filter(slot => !usedSlots.has(`${day}_${slot.id}`));
          if (freeSlots.length < hoursNeeded) continue;

          // ── Build consecutive groups that don't straddle the lunch break ──
          // "Consecutive" = slot_number increases by exactly 1 (no gap).
          // e.g. slots: [1,2,3,4] | LUNCH gap | [6,7,8]
          // slot 4 → slot 6 is a gap of 2, so they are NOT consecutive.
          const consecutiveGroups = [];
          let cur = [freeSlots[0]];
          for (let i = 1; i < freeSlots.length; i++) {
            if (freeSlots[i].slot_number === freeSlots[i-1].slot_number + 1) {
              cur.push(freeSlots[i]);
            } else {
              if (cur.length >= hoursNeeded) consecutiveGroups.push(cur);
              cur = [freeSlots[i]];
            }
          }
          if (cur.length >= hoursNeeded) consecutiveGroups.push(cur);
          if (!consecutiveGroups.length) continue;

          // ── Try each consecutive group for a valid placement window ──────
          let slotGroup = null;
          outer:
          for (const group of consecutiveGroups) {
            for (let start = 0; start <= group.length - hoursNeeded; start++) {
              const candidate = group.slice(start, start + hoursNeeded);
              let canPlace = true;
              const tmpRoom = {}, tmpFac = {};

              for (const sl of candidate) {
                // Check enough free labs for all batches
                const availR = labs.filter(r =>
                  isRoomFree(day, sl.id, r.id) && !tmpRoom[sl.id]?.has(r.id)
                );
                if (availR.length < numSubsections) { canPlace = false; break; }

                // Check enough free qualified faculty for all batches
                const eligible = allFaculty.filter(f => {
                  try { return JSON.parse(f.subjects_can_teach || '[]').includes(subj.id); } catch { return false; }
                });
                const fPool = eligible.length >= numSubsections ? eligible : allFaculty;
                const availF = fPool.filter(f =>
                  isFacultyFree(day, sl.id, f.id) && !tmpFac[sl.id]?.has(f.id)
                );
                if (availF.length < numSubsections) { canPlace = false; break; }

                // Reserve in tmp maps to avoid double-counting across slots in candidate
                if (!tmpRoom[sl.id]) tmpRoom[sl.id] = new Set();
                if (!tmpFac[sl.id])  tmpFac[sl.id]  = new Set();
                availR.slice(0, numSubsections).forEach(r => tmpRoom[sl.id].add(r.id));
                availF.slice(0, numSubsections).forEach(f => tmpFac[sl.id].add(f.id));
              }

              if (canPlace) { slotGroup = candidate; break outer; }
            }
          }
          if (!slotGroup) continue;

          // ── Place all hours in the validated consecutive, lunch-safe group ─
          for (const sl of slotGroup) {
            const availLabs = shuffle(labs.filter(r => isRoomFree(day, sl.id, r.id)));

            // Build per-batch faculty list: honour pre-assignments, fill rest auto
            const chosenFaculties = [];
            const chosenRooms     = [];
            const preAssigned = assignedFaculty[subj.id] || {};

            for (let bi = 0; bi < numSubsections; bi++) {
              const batchName = batchNames[bi];

              // Try pre-assigned faculty first
              let chosenF = null;
              const preId = preAssigned[batchName];
              if (preId) {
                const pre = allFaculty.find(f => f.id === preId);
                if (pre && isFacultyFree(day, sl.id, pre.id) && !chosenFaculties.includes(pre)) {
                  chosenF = pre;
                }
              }
              // Fall back to any free qualified faculty
              if (!chosenF) {
                const eligible = allFaculty.filter(f => {
                  try { return JSON.parse(f.subjects_can_teach || '[]').includes(subj.id); } catch { return false; }
                });
                const pool = shuffle(eligible.length >= 1 ? eligible : allFaculty);
                chosenF = pool.find(f => isFacultyFree(day, sl.id, f.id) && !chosenFaculties.includes(f));
              }

              const chosenR = availLabs.find(r => !chosenRooms.includes(r));
              if (!chosenF || !chosenR) {
                console.warn(`Not enough resources for ${subj.name} batch ${batchName} on ${day}`);
                break;
              }
              chosenFaculties.push(chosenF);
              chosenRooms.push(chosenR);
            }

            for (let bi = 0; bi < chosenFaculties.length; bi++) {
              await run(
                'INSERT INTO timetable_entries (section_id,time_slot_id,day_of_week,subject_id,faculty_id,room_id,subsection) VALUES ($1,$2,$3,$4,$5,$6,$7)',
                [section.id, sl.id, day, subj.id, chosenFaculties[bi].id, chosenRooms[bi].id, batchNames[bi]]
              );
              markRoom(day, sl.id, chosenRooms[bi].id);
              markFaculty(day, sl.id, chosenFaculties[bi].id);
            }
            usedSlots.add(`${day}_${sl.id}`);
            dayLabLoad[day]++;
          }
          placed = true;
          break; // done with this lab subject
        }
      }

      // ── Schedule THEORY subjects (spread across week) ─────────────────────
      let theoryPeriods = [];
      for (const subj of theorySubjects)
        for (let i = 0; i < subj.hours_per_week; i++) theoryPeriods.push(subj);
      theoryPeriods = shuffle(theoryPeriods);

      // Build ordered slot list, preferring days with lighter theory load
      const orderedSlots = [];
      for (const day of days)
        for (const slot of shuffle([...allSlots]))
          orderedSlots.push({ day, slot });
      // Sort by day load so we spread evenly
      orderedSlots.sort((a, b) => dayLoad[a.day] - dayLoad[b.day]);

      const daySubjects = Object.fromEntries(days.map(d => [d, new Set()]));
      const preferredRoomId = sectionRoomMap[section.id];

      let pi = 0, oi = 0;
      while (pi < theoryPeriods.length && oi < orderedSlots.length * 3) {
        const { day, slot } = orderedSlots[oi % orderedSlots.length]; oi++;
        const key = `${day}_${slot.id}`;
        if (usedSlots.has(key)) continue;

        const subj = theoryPeriods[pi];
        if (daySubjects[day].has(subj.id)) continue;

        const eligible = allFaculty.filter(f => {
          try { return JSON.parse(f.subjects_can_teach||'[]').includes(subj.id); } catch { return false; }
        });
        const fPool = shuffle(eligible.length ? eligible : allFaculty);
        const chosenF = fPool.find(f => isFacultyFree(day, slot.id, f.id));
        if (!chosenF) continue;

        const preferred = classrooms.find(r => r.id === preferredRoomId);
        let chosenR = (preferred && isRoomFree(day, slot.id, preferred.id))
          ? preferred
          : shuffle(classrooms.length ? classrooms : allRooms).find(r => isRoomFree(day, slot.id, r.id));
        if (!chosenR) continue;

        await run(
          'INSERT INTO timetable_entries (section_id,time_slot_id,day_of_week,subject_id,faculty_id,room_id,subsection) VALUES ($1,$2,$3,$4,$5,$6,NULL)',
          [section.id, slot.id, day, subj.id, chosenF.id, chosenR.id]
        );
        markFaculty(day, slot.id, chosenF.id);
        markRoom(day, slot.id, chosenR.id);
        usedSlots.add(key);
        daySubjects[day].add(subj.id);
        dayLoad[day]++;
        pi++;
      }
    }

    const totalRow = await queryOne(
      'SELECT COUNT(*) as cnt FROM timetable_entries WHERE section_id = ANY($1)',
      [sections.map(s => s.id)]
    );
    res.json({ success: true, message: `Timetable generated for ${sections.length} section(s). Total entries: ${totalRow.cnt}` });
  } catch (err) {
    console.error('Generate error:', err);
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// ==================== CLEAR ==================================================
// =============================================================================

router.post('/clear', requireAuth, async (req, res) => {
  try {
    const { scope, year_id, section_id } = req.body;
    const deptId = getDeptId(req);
    if (scope === 'section' && section_id) {
      if (!(await verifyDeptOwnership('sections', section_id, deptId)))
        return res.status(403).json({ error: 'Section not in your department' });
      await run('DELETE FROM timetable_entries WHERE section_id=$1', [section_id]);
    } else if (scope === 'year' && year_id) {
      if (!(await verifyDeptOwnership('years', year_id, deptId)))
        return res.status(403).json({ error: 'Year not in your department' });
      const secs = await query('SELECT id FROM sections WHERE year_id=$1', [year_id]);
      for (const s of secs) await run('DELETE FROM timetable_entries WHERE section_id=$1', [s.id]);
    } else {
      // Clear only this department's sections
      const secs = await query(
        'SELECT s.id FROM sections s JOIN years y ON s.year_id=y.id WHERE y.department_id=$1', [deptId]
      );
      for (const s of secs) await run('DELETE FROM timetable_entries WHERE section_id=$1', [s.id]);
    }
    res.json({ success: true, message: 'Timetable cleared' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
