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
    const { section_id, time_slot_id, day_of_week, subject_id, faculty_id, room_id, entry_id, subsection } = req.body;
    if (!section_id || !time_slot_id || !day_of_week)
      return res.status(400).json({ error: 'section_id, time_slot_id, day_of_week required' });
    const deptId = getDeptId(req);
    if (!(await verifyDeptOwnership('sections', section_id, deptId)))
      return res.status(403).json({ error: 'Section does not belong to your department' });

    // If entry_id provided, update that specific entry directly (used for batch editing)
    if (entry_id) {
      await run('UPDATE timetable_entries SET subject_id=$1,faculty_id=$2,room_id=$3 WHERE id=$4',
        [subject_id||null, faculty_id||null, room_id||null, entry_id]);
      return res.json({ id: entry_id, message: 'Entry updated' });
    }

    // For theory (no subsection): find existing by section+slot+day where subsection IS NULL
    const existing = await queryOne(
      'SELECT id FROM timetable_entries WHERE section_id=$1 AND time_slot_id=$2 AND day_of_week=$3 AND subsection IS NULL',
      [section_id, time_slot_id, day_of_week]
    );
    if (existing) {
      await run('UPDATE timetable_entries SET subject_id=$1,faculty_id=$2,room_id=$3 WHERE id=$4',
        [subject_id||null, faculty_id||null, room_id||null, existing.id]);
      res.json({ id: existing.id, message: 'Entry updated' });
    } else {
      const result = await run(
        'INSERT INTO timetable_entries (section_id,time_slot_id,day_of_week,subject_id,faculty_id,room_id,subsection) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
        [section_id, time_slot_id, day_of_week, subject_id||null, faculty_id||null, room_id||null, subsection||null]
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

// Enhanced: Get all conflicts with detailed information
router.get('/conflicts', requireAuth, async (req, res) => {
  try {
    const deptId = getDeptId(req);
    const conflicts = [];

    // Find faculty conflicts (same faculty in multiple entries same day/slot)
    const facultyConflicts = await query(`
      SELECT 
        te1.day_of_week as day,
        te1.time_slot_id as slot_id,
        ts.start_time,
        ts.end_time,
        te1.faculty_id,
        f.name as faculty_name,
        COUNT(*) as conflict_count,
        JSON_AGG(JSON_BUILD_OBJECT(
          'entry_id', te1.id,
          'section_name', sec.name,
          'subject_name', subj.name
        )) as entries
      FROM timetable_entries te1
      JOIN faculty f ON te1.faculty_id = f.id
      JOIN time_slots ts ON te1.time_slot_id = ts.id
      JOIN sections sec ON te1.section_id = sec.id
      JOIN subjects subj ON te1.subject_id = subj.id
      WHERE f.department_id = $1 AND te1.faculty_id IS NOT NULL
      GROUP BY te1.day_of_week, te1.time_slot_id, te1.faculty_id, f.name, ts.start_time, ts.end_time
      HAVING COUNT(*) > 1
      ORDER BY te1.day_of_week, te1.time_slot_id
    `, [deptId]);

    for (const c of facultyConflicts) {
      conflicts.push({
        day: c.day,
        slot_id: c.slot_id,
        time: `${c.start_time}-${c.end_time}`,
        type: 'faculty',
        resource_name: c.faculty_name,
        conflict_count: c.conflict_count,
        faculty_duplicate_count: c.conflict_count - 1,
        room_duplicate_count: 0,
        faculty_entries: c.entries
      });
    }

    // Find room conflicts (same room in multiple entries same day/slot)
    const roomConflicts = await query(`
      SELECT 
        te1.day_of_week as day,
        te1.time_slot_id as slot_id,
        ts.start_time,
        ts.end_time,
        te1.room_id,
        r.name as room_name,
        COUNT(*) as conflict_count,
        JSON_AGG(JSON_BUILD_OBJECT(
          'entry_id', te1.id,
          'section_name', sec.name,
          'subject_name', subj.name
        )) as entries
      FROM timetable_entries te1
      JOIN rooms r ON te1.room_id = r.id
      JOIN time_slots ts ON te1.time_slot_id = ts.id
      JOIN sections sec ON te1.section_id = sec.id
      JOIN subjects subj ON te1.subject_id = subj.id
      WHERE r.department_id = $1 AND te1.room_id IS NOT NULL
      GROUP BY te1.day_of_week, te1.time_slot_id, te1.room_id, r.name, ts.start_time, ts.end_time
      HAVING COUNT(*) > 1
      ORDER BY te1.day_of_week, te1.time_slot_id
    `, [deptId]);

    for (const c of roomConflicts) {
      conflicts.push({
        day: c.day,
        slot_id: c.slot_id,
        time: `${c.start_time}-${c.end_time}`,
        type: 'room',
        resource_name: c.room_name,
        conflict_count: c.conflict_count,
        faculty_duplicate_count: 0,
        room_duplicate_count: c.conflict_count - 1,
        room_entries: c.entries
      });
    }

    res.json(conflicts);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Scan for conflicts and return summary statistics
router.post('/scan-conflicts', requireAuth, async (req, res) => {
  try {
    const deptId = getDeptId(req);
    
    // Faculty conflicts
    const facultyConflicts = await query(`
      SELECT COUNT(DISTINCT te1.faculty_id || '_' || te1.day_of_week || '_' || te1.time_slot_id) as count
      FROM timetable_entries te1
      JOIN faculty f ON te1.faculty_id = f.id
      WHERE f.department_id = $1 AND te1.faculty_id IS NOT NULL
      GROUP BY te1.day_of_week, te1.time_slot_id, te1.faculty_id
      HAVING COUNT(*) > 1
    `, [deptId]);

    // Room conflicts
    const roomConflicts = await query(`
      SELECT COUNT(DISTINCT te1.room_id || '_' || te1.day_of_week || '_' || te1.time_slot_id) as count
      FROM timetable_entries te1
      JOIN rooms r ON te1.room_id = r.id
      WHERE r.department_id = $1 AND te1.room_id IS NOT NULL
      GROUP BY te1.day_of_week, te1.time_slot_id, te1.room_id
      HAVING COUNT(*) > 1
    `, [deptId]);

    // Affected sections
    const affectedSections = await query(`
      SELECT DISTINCT sec.id
      FROM timetable_entries te1
      JOIN sections sec ON te1.section_id = sec.id
      JOIN years y ON sec.year_id = y.id
      WHERE y.department_id = $1
      AND (
        (te1.faculty_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM timetable_entries te2
          WHERE te2.faculty_id = te1.faculty_id
          AND te2.day_of_week = te1.day_of_week
          AND te2.time_slot_id = te1.time_slot_id
          AND te2.id != te1.id
        ))
        OR
        (te1.room_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM timetable_entries te2
          WHERE te2.room_id = te1.room_id
          AND te2.day_of_week = te1.day_of_week
          AND te2.time_slot_id = te1.time_slot_id
          AND te2.id != te1.id
        ))
      )
    `, [deptId]);

    res.json({
      success: true,
      stats: {
        totalConflicts: (facultyConflicts.length || 0) + (roomConflicts.length || 0),
        facultyConflicts: facultyConflicts.length || 0,
        roomConflicts: roomConflicts.length || 0,
        affectedSections: affectedSections.length || 0
      }
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Suggest a fix for a specific conflict
router.post('/suggest-fix', requireAuth, async (req, res) => {
  try {
    const { day, slot_id, department_id } = req.body;
    const deptId = getDeptId(req);
    
    if (!day || !slot_id) {
      return res.status(400).json({ error: 'day and slot_id required' });
    }

    // Get all entries for this day/slot
    const entries = await query(`
      SELECT te.*, sec.name as section_name, subj.name as subject_name, 
             f.name as faculty_name, r.name as room_name
      FROM timetable_entries te
      JOIN sections sec ON te.section_id = sec.id
      JOIN years y ON sec.year_id = y.id
      JOIN subjects subj ON te.subject_id = subj.id
      LEFT JOIN faculty f ON te.faculty_id = f.id
      LEFT JOIN rooms r ON te.room_id = r.id
      WHERE te.day_of_week = $1 AND te.time_slot_id = $2 AND y.department_id = $3
      ORDER BY te.id
    `, [day, slot_id, deptId]);

    if (entries.length <= 1) {
      return res.json({ suggestion: 'No conflict found for this slot' });
    }

    // Analyze the conflict
    const facultyMap = {};
    const roomMap = {};
    for (const entry of entries) {
      if (entry.faculty_id) {
        if (!facultyMap[entry.faculty_id]) facultyMap[entry.faculty_id] = [];
        facultyMap[entry.faculty_id].push(entry.section_name);
      }
      if (entry.room_id) {
        if (!roomMap[entry.room_id]) roomMap[entry.room_id] = [];
        roomMap[entry.room_id].push(entry.section_name);
      }
    }

    // Find duplicate entries
    const duplicateFaculty = Object.entries(facultyMap).filter(([_, sections]) => sections.length > 1);
    const duplicateRooms = Object.entries(roomMap).filter(([_, sections]) => sections.length > 1);

    // Generate suggestion
    let suggestion = '';
    if (duplicateFaculty.length > 0) {
      suggestion += `Faculty conflict: Move one of the sections assigned to the same faculty to a different time slot. `;
    }
    if (duplicateRooms.length > 0) {
      suggestion += `Room conflict: Relocate one of the sections to use a different room. `;
    }
    if (!suggestion) {
      suggestion = 'Review the entries manually - no clear conflict pattern detected.';
    }

    res.json({
      suggestion: suggestion.trim(),
      conflictDetails: {
        day, slot_id,
        totalEntries: entries.length,
        duplicateFaculty: duplicateFaculty.map(([fId, secs]) => ({ facultyId: fId, sections: secs })),
        duplicateRooms: duplicateRooms.map(([rId, secs]) => ({ roomId: rId, sections: secs }))
      }
    });
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
// Validates that the same faculty is NOT assigned to multiple batches of the same subject
router.post('/lab-assignments', requireAuth, async (req, res) => {
  try {
    const { section_id, subject_id, batch_name, faculty_id } = req.body;
    if (!section_id || !subject_id || !batch_name)
      return res.status(400).json({ error: 'section_id, subject_id, batch_name required' });
    const deptId = getDeptId(req);
    if (!(await verifyDeptOwnership('sections', section_id, deptId)))
      return res.status(403).json({ error: 'Section not in your department' });

    if (faculty_id) {
      // Check if this faculty is already assigned to another batch of the same subject
      const existing = await queryOne(`
        SELECT batch_name FROM lab_assignments
        WHERE section_id = $1 AND subject_id = $2 AND faculty_id = $3 AND batch_name != $4
        LIMIT 1
      `, [section_id, subject_id, faculty_id, batch_name]);

      if (existing) {
        return res.status(400).json({ 
          error: `Faculty is already assigned to batch ${existing.batch_name} of this subject. Each faculty can teach only one batch per lab subject.`
        });
      }

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
    res.json({ message: 'Assignment saved successfully' });
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

// ── GET lab entries organized by subject and batch (for editor view) ────────
router.get('/lab-entries/:sectionId', requireAuth, async (req, res) => {
  try {
    const deptId = getDeptId(req);
    if (!(await verifyDeptOwnership('sections', req.params.sectionId, deptId)))
      return res.status(403).json({ error: 'Section not in your department' });

    const entries = await query(`
      SELECT 
        te.id,
        te.section_id,
        te.day_of_week,
        te.time_slot_id,
        te.subject_id,
        te.subsection as batch_name,
        te.faculty_id,
        te.room_id,
        s.name as subject_name,
        s.type as subject_type,
        s.hours_per_week,
        f.name as faculty_name,
        r.name as room_name,
        ts.start_time,
        ts.end_time,
        ts.slot_number
      FROM timetable_entries te
      JOIN subjects s ON te.subject_id = s.id
      JOIN time_slots ts ON te.time_slot_id = ts.id
      LEFT JOIN faculty f ON te.faculty_id = f.id
      LEFT JOIN rooms r ON te.room_id = r.id
      WHERE te.section_id = $1 AND s.type = 'lab'
      ORDER BY s.name, te.day_of_week, ts.slot_number, te.subsection
    `, [req.params.sectionId]);

    // Group by subject → by slot → by batch
    const grouped = {};
    for (const entry of entries) {
      if (!grouped[entry.subject_id]) {
        grouped[entry.subject_id] = {
          subject_id: entry.subject_id,
          subject_name: entry.subject_name,
          hours_per_week: entry.hours_per_week,
          slots: {}
        };
      }

      const slotKey = `${entry.day_of_week}_${entry.time_slot_id}`;
      if (!grouped[entry.subject_id].slots[slotKey]) {
        grouped[entry.subject_id].slots[slotKey] = {
          day: entry.day_of_week,
          slot_id: entry.time_slot_id,
          slot_number: entry.slot_number,
          start_time: entry.start_time,
          end_time: entry.end_time,
          batches: []
        };
      }

      grouped[entry.subject_id].slots[slotKey].batches.push({
        entry_id: entry.id,
        batch_name: entry.batch_name,
        faculty_id: entry.faculty_id,
        faculty_name: entry.faculty_name,
        room_id: entry.room_id,
        room_name: entry.room_name
      });
    }

    // Convert to array format for frontend
    const result = Object.values(grouped).map(subj => ({
      ...subj,
      slots: Object.values(subj.slots)
    }));

    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Validate that no faculty is assigned to multiple batches of same lab subject ──
router.post('/validate-lab-assignments', requireAuth, async (req, res) => {
  try {
    const { section_id } = req.body;
    if (!section_id) return res.status(400).json({ error: 'section_id required' });
    
    const deptId = getDeptId(req);
    if (!(await verifyDeptOwnership('sections', section_id, deptId)))
      return res.status(403).json({ error: 'Section not in your department' });

    // Find if any faculty is assigned to multiple batches of the same lab subject
    const violations = await query(`
      SELECT subject_id, faculty_id, COUNT(DISTINCT batch_name) as batch_count,
             STRING_AGG(batch_name, ', ') as batches,
             (SELECT name FROM subjects WHERE id = subject_id LIMIT 1) as subject_name,
             (SELECT name FROM faculty WHERE id = faculty_id LIMIT 1) as faculty_name
      FROM lab_assignments
      WHERE section_id = $1 AND faculty_id IS NOT NULL
      GROUP BY subject_id, faculty_id
      HAVING COUNT(DISTINCT batch_name) > 1
    `, [section_id]);

    res.json({
      valid: violations.length === 0,
      violations: violations,
      message: violations.length === 0 
        ? 'All lab assignments are valid' 
        : `${violations.length} faculty assignment violation(s) found`
    });
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
    const roomUsageCount = Object.fromEntries(labs.map(r => [r.id, 0]));
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
      const allLabSubjects = subjects.filter(s => s.type === 'lab');

      // ── Determine if this section is a BTU section ─────────────────────
      // BTU section: name contains "BTU" (case-insensitive)
      const isBtuSection = /btu/i.test(section.name);

      // Separate regular and BTU theory subjects
      const regularTheory = theorySubjects.filter(s => s.category !== 'btu');
      const btuTheory     = theorySubjects.filter(s => s.category === 'btu');

      // Separate regular and BTU lab subjects
      const regularLabs = allLabSubjects.filter(s => s.category !== 'btu');
      const btuLabs     = allLabSubjects.filter(s => s.category === 'btu');

      // Eligible lab subjects for this section:
      // - BTU sections: both regular and BTU labs
      // - Non-BTU sections: only regular labs
      const labSubjects = isBtuSection 
        ? [...regularLabs, ...btuLabs]
        : [...regularLabs];

      // Eligible theory for this section:
      // - BTU sections: regular subjects + BTU subjects (max 6 total)
      // - Non-BTU sections: only regular subjects (max 6)
      let eligibleTheory = [];
      if (isBtuSection) {
        // BTU section gets both regular and BTU subjects (up to 6 total)
        eligibleTheory = [...regularTheory, ...btuTheory];
      } else {
        // Non-BTU section gets only regular subjects
        eligibleTheory = [...regularTheory];
      }

      // ── Cap theory subjects (BTU subjects guaranteed for BTU sections) ──
      // For BTU sections: always include all BTU subjects (they are mandatory),
      // then fill remaining slots (up to 7 total) with highest-credit regular subjects.
      // For non-BTU sections: top 6 regular subjects by credits.
      let cappedTheory;
      if (isBtuSection && btuTheory.length > 0) {
        // BTU subjects come first (guaranteed), then top regular subjects to fill to 7
        const remainingSlots = Math.max(0, 7 - btuTheory.length);
        const topRegular = [...regularTheory]
          .sort((a, b) => (b.credits || 0) - (a.credits || 0))
          .slice(0, remainingSlots);
        cappedTheory = [...btuTheory, ...topRegular];
      } else {
        cappedTheory = [...eligibleTheory]
          .sort((a, b) => (b.credits || 0) - (a.credits || 0))
          .slice(0, 6);
      }

      // ── Slot tracking ──────────────────────────────────────────────────────
      const usedSlots  = new Set(); // "day_slotId" — slot used by THIS section
      const dayLoad    = Object.fromEntries(days.map(d => [d, 0]));
      const dayLabLoad = Object.fromEntries(days.map(d => [d, 0]));

      // ── Schedule LAB subjects: each BATCH gets its own separate slot ────────
      // Rule: since one faculty can teach multiple batches, batches must be staggered —
      // each batch of a subject occupies different slots (can be same or diff day).
      // Each batch still occupies hours_per_week consecutive slots.
      // IMPORTANT: Same faculty CAN teach multiple batches of same subject
      // Same lab room MUST be used for all consecutive slots of a batch

      for (const subj of labSubjects) {
        const hoursNeeded = subj.hours_per_week || 2;
        const preAssigned = assignedFaculty[subj.id] || {};

        // Build qualified faculty pool for this subject
        const qualifiedFac = allFaculty.filter(f => {
          try { return JSON.parse(f.subjects_can_teach || '[]').includes(subj.id); } catch { return false; }
        });
        const facPool = qualifiedFac.length >= numSubsections
          ? qualifiedFac
          : allFaculty;

        // Schedule each batch independently into its own consecutive slot window
        for (let bi = 0; bi < numSubsections; bi++) {
          const batchName = batchNames[bi];
          let batchPlaced = false;

          // Determine faculty for this batch
          let batchFaculty = null;
          const preId = preAssigned[batchName];
          if (preId) {
            const pre = allFaculty.find(f => f.id === preId);
            // Use pre-assigned faculty (same faculty CAN teach multiple batches of same subject)
            if (pre) batchFaculty = pre;
          }
          if (!batchFaculty) {
            // Find any qualified faculty (same faculty can teach multiple batches)
            const pool = shuffle(facPool);
            batchFaculty = pool[0] || null;
          }
          if (!batchFaculty) {
            console.warn(`No faculty for ${subj.name} batch ${batchName}`);
            continue;
          }

          // Note: Same faculty can teach multiple batches of same subject
          // (removed the restriction that prevented this)

          // Find a consecutive window where: faculty is free + at least 1 lab room free
          for (const day of shuffle([...days])) {
            if (batchPlaced) break;
            const freeSlots = allSlots.filter(sl => !usedSlots.has(`${day}_${sl.id}`));
            if (freeSlots.length < hoursNeeded) continue;

            // Build consecutive groups (respecting lunch breaks)
            const groups = [];
            let cur = [freeSlots[0]];
            for (let i = 1; i < freeSlots.length; i++) {
              if (freeSlots[i].slot_number === freeSlots[i-1].slot_number + 1) {
                cur.push(freeSlots[i]);
              } else {
                // Gap detected - likely lunch break
                if (cur.length >= hoursNeeded) groups.push([...cur]);
                cur = [freeSlots[i]];
              }
            }
            if (cur.length >= hoursNeeded) groups.push(cur);
            if (!groups.length) continue;

            for (const group of groups) {
              if (batchPlaced) break;
              for (let start = 0; start <= group.length - hoursNeeded; start++) {
                const candidate = group.slice(start, start + hoursNeeded);

                // Faculty must be free for all slots in window
                if (!candidate.every(sl => isFacultyFree(day, sl.id, batchFaculty.id))) continue;

                // Need at least one lab free for all slots in window (same lab across all)
                // Prefer labs that are less frequently used
                const availableLabs = labs.filter(r =>
                  candidate.every(sl => isRoomFree(day, sl.id, r.id))
                ).sort((a, b) => roomUsageCount[a.id] - roomUsageCount[b.id]);
                
                const labFreeAll = availableLabs[0];
                if (!labFreeAll) continue;

                // Place this batch in all consecutive slots with same faculty + same lab
                for (const sl of candidate) {
                  await run(
                    'INSERT INTO timetable_entries (section_id,time_slot_id,day_of_week,subject_id,faculty_id,room_id,subsection) VALUES ($1,$2,$3,$4,$5,$6,$7)',
                    [section.id, sl.id, day, subj.id, batchFaculty.id, labFreeAll.id, batchName]
                  );
                  markFaculty(day, sl.id, batchFaculty.id);
                  markRoom(day, sl.id, labFreeAll.id);
                  usedSlots.add(`${day}_${sl.id}`);
                  dayLabLoad[day]++;
                }
                roomUsageCount[labFreeAll.id]++;
                batchPlaced = true;
                break;
              }
            }
          }

          if (!batchPlaced) {
            console.warn(`Warning: Could not place ${subj.name} batch ${batchName} for section ${section.name} — no free consecutive window found after trying all days`);
          }
        }
      }

      // ── Schedule THEORY subjects (max 6 for regular, max 7 for BTU, spread evenly across week) ────────
      const MAX_THEORY = isBtuSection ? 7 : 6;
      let theoryTokens = [];
      for (const subj of cappedTheory) {
        for (let i = 0; i < subj.hours_per_week; i++) {
          theoryTokens.push(subj);
        }
      }
      theoryTokens = shuffle(theoryTokens);

      // Build ordered slot list, sort by day load for even distribution
      const orderedSlots = [];
      for (const day of days)
        for (const slot of shuffle([...allSlots]))
          orderedSlots.push({ day, slot });
      orderedSlots.sort((a, b) => dayLoad[a.day] - dayLoad[b.day]);

      const daySubjects = Object.fromEntries(days.map(d => [d, new Set()]));
      const preferredRoomId = sectionRoomMap[section.id];

      // For theory subjects: track faculty usage to balance workload
      const facultyTheoryCount = Object.fromEntries(allFaculty.map(f => [f.id, 0]));

      let pi = 0, oi = 0;
      while (pi < theoryTokens.length && oi < orderedSlots.length * 3) {
        const { day, slot } = orderedSlots[oi % orderedSlots.length]; oi++;
        const key = `${day}_${slot.id}`;
        if (usedSlots.has(key)) continue; // already used by a lab batch

        const subj = theoryTokens[pi];
        if (daySubjects[day].has(subj.id)) continue; // same subject twice on same day

        // Find eligible faculty (qualified + free) and prefer less-loaded ones
        const eligible = allFaculty.filter(f => {
          try { return JSON.parse(f.subjects_can_teach || '[]').includes(subj.id); } catch { return false; }
        });
        const candidateFaculty = shuffle(eligible.length ? eligible : allFaculty)
          .sort((a, b) => facultyTheoryCount[a.id] - facultyTheoryCount[b.id]);
        
        const chosenF = candidateFaculty.find(f => isFacultyFree(day, slot.id, f.id));
        if (!chosenF) continue;

        const preferred = classrooms.find(r => r.id === preferredRoomId);
        const chosenR = (preferred && isRoomFree(day, slot.id, preferred.id))
          ? preferred
          : shuffle([...classrooms, ...allRooms.filter(r => r.type !== 'lab')])
              .find(r => isRoomFree(day, slot.id, r.id));
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
        facultyTheoryCount[chosenF.id]++;
        pi++;
      }
    }

    const totalRow = await queryOne(
      'SELECT COUNT(*) as cnt FROM timetable_entries WHERE section_id = ANY($1)',
      [sections.map(s => s.id)]
    );
    
    // Generate quality metrics
    const stats = {
      totalEntries: totalRow.cnt,
      sectionsGenerated: sections.length,
      avgEntriesPerSection: Math.round(totalRow.cnt / sections.length),
      generatedAt: new Date().toISOString()
    };
    
    res.json({ 
      success: true, 
      message: `Timetable generated for ${sections.length} section(s). Total entries: ${totalRow.cnt}`,
      stats: stats
    });
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

// =============================================================================
// ==================== VALIDATION =============================================
// =============================================================================

// Get timetable validation report for a section
router.get('/validate/:sectionId', requireAuth, async (req, res) => {
  try {
    const deptId = getDeptId(req);
    const sectionId = parseInt(req.params.sectionId);
    
    if (!(await verifyDeptOwnership('sections', sectionId, deptId)))
      return res.status(403).json({ error: 'Section not in your department' });
    
    const entries = await query(
      `SELECT te.*, s.name as subject_name, s.type as subject_type, s.category, 
              f.name as faculty_name, r.name as room_name
       FROM timetable_entries te
       LEFT JOIN subjects s ON te.subject_id = s.id
       LEFT JOIN faculty f ON te.faculty_id = f.id
       LEFT JOIN rooms r ON te.room_id = r.id
       WHERE te.section_id = $1
       ORDER BY te.day_of_week, te.time_slot_id`,
      [sectionId]
    );
    
    // Validation checks
    const checks = {
      totalSlots: entries.length,
      labBatches: entries.filter(e => e.subsection).length,
      theorySlots: entries.filter(e => !e.subsection).length,
      btuSubjectsScheduled: entries.filter(e => e.category === 'btu').length,
      emptySlots: entries.filter(e => !e.subject_id).length,
      uniqueSubjects: [...new Set(entries.map(e => e.subject_id))].length,
      allFilled: entries.every(e => e.subject_id && e.faculty_id && e.room_id)
    };
    
    res.json({
      success: true,
      validation: checks,
      entries: entries.length,
      message: checks.allFilled ? 'All slots properly filled' : 'Some slots are incomplete'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
