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
    const { name, code, course_prefix, num_years } = req.body;
    if (!name || !code) return res.status(400).json({ error: 'name and code required' });
    const result = await run(
      'INSERT INTO departments (name, code) VALUES ($1, $2) RETURNING id',
      [name, code.toUpperCase()]
    );
    const newDeptId = result.rows[0].id;
    // Seed default time slots for new department
    const timeSlotsData = [
      [1,"08:00","09:00",0],[2,"09:00","09:50",0],[3,"09:50","10:40",0],
      [4,"10:40","11:30",0],[5,"11:30","12:30",1],[6,"12:30","13:20",0],
      [7,"13:20","14:10",0],[8,"14:10","15:00",0]
    ];
    for (const [slot,start,end,is_break] of timeSlotsData) {
      await run('INSERT INTO time_slots (department_id,slot_number,start_time,end_time,is_break) VALUES ($1,$2,$3,$4,$5)',
        [newDeptId, slot, start, end, is_break]);
    }
    // Seed years using custom course prefix
    const prefix = (course_prefix || 'B.Tech').trim();
    const years = parseInt(num_years) || 3;
    const ordinals = ['I','II','III','IV','V','VI'];
    for (let i = 0; i < years; i++) {
      const ord = ordinals[i] || `${i+1}`;
      const yearName = `year${i+1}`;
      const displayName = `${prefix} ${ord} Year`;
      await run('INSERT INTO years (department_id,name,display_name) VALUES ($1,$2,$3)', [newDeptId, yearName, displayName]);
    }
    res.json({ id: newDeptId, message: `Department created with ${years} years using prefix "${prefix}"` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/departments/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const { name, code } = req.body;
    await run('UPDATE departments SET name=$1, code=$2 WHERE id=$3', [name, code, req.params.id]);
    res.json({ message: 'Department updated' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Update year display name (e.g. change "B.Tech I Year" to "BCA I Year")
router.put('/years/:id', requireAuth, async (req, res) => {
  try {
    const { display_name } = req.body;
    if (!display_name) return res.status(400).json({ error: 'display_name required' });
    const deptId = getDeptId(req);
    if (!(await verifyDeptOwnership('years', req.params.id, deptId)))
      return res.status(403).json({ error: 'Year not in your department' });
    await run('UPDATE years SET display_name=$1 WHERE id=$2', [display_name.trim(), req.params.id]);
    res.json({ message: 'Year name updated' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Bulk rename years using a course prefix
router.put('/years/rename-all/:dept_id', requireAuth, async (req, res) => {
  try {
    const { course_prefix } = req.body;
    if (!course_prefix) return res.status(400).json({ error: 'course_prefix required' });
    const deptId = getDeptId(req);
    // Super admin can target specific dept; incharge targets own dept
    const targetDeptId = req.user.isSuperAdmin ? parseInt(req.params.dept_id) : deptId;
    const years = await query('SELECT * FROM years WHERE department_id=$1 ORDER BY id', [targetDeptId]);
    const ordinals = ['I','II','III','IV','V','VI'];
    for (let i = 0; i < years.length; i++) {
      const ord = ordinals[i] || `${i+1}`;
      const newDisplay = `${course_prefix.trim()} ${ord} Year`;
      await run('UPDATE years SET display_name=$1 WHERE id=$2', [newDisplay, years[i].id]);
    }
    res.json({ message: `Renamed ${years.length} years to "${course_prefix} ... Year" format` });
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
// ==================== YEARS CRUD =============================================
// =============================================================================

// POST — add a new year to the department
router.post('/years', requireAuth, async (req, res) => {
  try {
    const { name, display_name } = req.body;
    if (!name || !display_name) return res.status(400).json({ error: 'name and display_name required' });
    const deptId = getDeptId(req);
    // Check duplicate name within department
    const existing = await queryOne(
      'SELECT id FROM years WHERE department_id=$1 AND name=$2', [deptId, name.trim()]
    );
    if (existing) return res.status(409).json({ error: `Year "${name}" already exists in this department` });
    const result = await run(
      'INSERT INTO years (department_id, name, display_name) VALUES ($1,$2,$3) RETURNING id',
      [deptId, name.trim(), display_name.trim()]
    );
    res.json({ id: result.rows[0].id, message: `Year "${display_name}" added` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE — remove a year and all its sections/subjects/timetable entries (cascade)
router.delete('/years/:id', requireAuth, async (req, res) => {
  try {
    const deptId = getDeptId(req);
    if (!(await verifyDeptOwnership('years', req.params.id, deptId)))
      return res.status(403).json({ error: 'Year not in your department' });
    await run('DELETE FROM years WHERE id=$1', [req.params.id]);
    res.json({ message: 'Year deleted along with all its sections, subjects, and timetable entries' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// =============================================================================
// ==================== TIME SLOTS CRUD ========================================
// =============================================================================

// GET — list all time slots for this department (also available via public /api/timeslots)
router.get('/timeslots', requireAuth, async (req, res) => {
  try {
    const deptId = getDeptId(req);
    const rows = await query(
      'SELECT * FROM time_slots WHERE department_id=$1 ORDER BY slot_number', [deptId]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST — add a new time slot
router.post('/timeslots', requireAuth, async (req, res) => {
  try {
    const { slot_number, start_time, end_time, is_break } = req.body;
    if (!slot_number || !start_time || !end_time)
      return res.status(400).json({ error: 'slot_number, start_time, end_time required' });
    const deptId = getDeptId(req);
    // Check duplicate slot_number
    const existing = await queryOne(
      'SELECT id FROM time_slots WHERE department_id=$1 AND slot_number=$2', [deptId, slot_number]
    );
    if (existing) return res.status(409).json({ error: `Slot number ${slot_number} already exists` });
    const result = await run(
      'INSERT INTO time_slots (department_id, slot_number, start_time, end_time, is_break) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [deptId, parseInt(slot_number), start_time.trim(), end_time.trim(), is_break ? 1 : 0]
    );
    res.json({ id: result.rows[0].id, message: 'Time slot added' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT — update a time slot's times / break flag
router.put('/timeslots/:id', requireAuth, async (req, res) => {
  try {
    const { start_time, end_time, is_break, slot_number } = req.body;
    const deptId = getDeptId(req);
    if (!(await verifyDeptOwnership('time_slots', req.params.id, deptId)))
      return res.status(403).json({ error: 'Slot not in your department' });
    await run(
      `UPDATE time_slots SET
        start_time  = COALESCE($1, start_time),
        end_time    = COALESCE($2, end_time),
        is_break    = COALESCE($3, is_break),
        slot_number = COALESCE($4, slot_number)
       WHERE id=$5`,
      [start_time||null, end_time||null,
       is_break !== undefined ? (is_break ? 1 : 0) : null,
       slot_number !== undefined ? parseInt(slot_number) : null,
       req.params.id]
    );
    res.json({ message: 'Time slot updated' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE — remove a time slot (will fail gracefully if timetable entries reference it)
router.delete('/timeslots/:id', requireAuth, async (req, res) => {
  try {
    const deptId = getDeptId(req);
    if (!(await verifyDeptOwnership('time_slots', req.params.id, deptId)))
      return res.status(403).json({ error: 'Slot not in your department' });
    // Check if any timetable entries use this slot
    const inUse = await queryOne(
      'SELECT COUNT(*) as cnt FROM timetable_entries WHERE time_slot_id=$1', [req.params.id]
    );
    if (parseInt(inUse.cnt) > 0)
      return res.status(409).json({
        error: `Cannot delete: ${inUse.cnt} timetable entries use this slot. Clear or regenerate the timetable first.`
      });
    await run('DELETE FROM time_slots WHERE id=$1', [req.params.id]);
    res.json({ message: 'Time slot deleted' });
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

// ── Change super admin credentials (super admin only) ─────────────────────────
router.put('/change-credentials', requireAuth, async (req, res) => {
  try {
    if (!req.user.isSuperAdmin)
      return res.status(403).json({ error: 'Super admin access required' });

    const { current_password, new_username, new_password } = req.body;
    if (!current_password)
      return res.status(400).json({ error: 'Current password is required' });

    // Verify current password
    const user = await queryOne(
      'SELECT * FROM users WHERE id=$1', [req.user.id]
    );
    if (!user || user.password !== current_password)
      return res.status(401).json({ error: 'Current password is incorrect' });

    // Validate new values
    if (new_username && new_username.trim().length < 3)
      return res.status(400).json({ error: 'Username must be at least 3 characters' });
    if (new_password && new_password.length < 6)
      return res.status(400).json({ error: 'New password must be at least 6 characters' });

    if (!new_username && !new_password)
      return res.status(400).json({ error: 'Provide a new username or new password to update' });

    // Check username uniqueness if changing
    if (new_username && new_username.trim() !== user.username) {
      const existing = await queryOne('SELECT id FROM users WHERE username=$1', [new_username.trim()]);
      if (existing) return res.status(409).json({ error: 'Username already taken' });
    }

    const updatedUsername = (new_username && new_username.trim()) || user.username;
    const updatedPassword = new_password || user.password;

    await run(
      'UPDATE users SET username=$1, password=$2 WHERE id=$3',
      [updatedUsername, updatedPassword, user.id]
    );

    res.json({ message: 'Credentials updated successfully. Please log in again.', logout: true });
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
    // Remove timetable entries referencing this subject first (no CASCADE on that FK)
    await run('DELETE FROM timetable_entries WHERE subject_id=$1', [req.params.id]);
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
    // Normalize to array of integers
    const subjectsArray = Array.isArray(subjects_can_teach)
      ? subjects_can_teach.map(id => parseInt(id)).filter(id => !isNaN(id))
      : [];
    const result = await run(
      'INSERT INTO faculty (department_id,name,designation,role,email,subjects_can_teach) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [deptId, name, designation||'', role||'faculty', email||'', JSON.stringify(subjectsArray)]
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
    // Normalize to array of integers
    const subjectsArray = Array.isArray(subjects_can_teach)
      ? subjects_can_teach.map(id => parseInt(id)).filter(id => !isNaN(id))
      : [];
    await run('UPDATE faculty SET name=$1,designation=$2,role=$3,email=$4,subjects_can_teach=$5 WHERE id=$6',
      [name, designation, role, email, JSON.stringify(subjectsArray), req.params.id]);
    res.json({ message: 'Faculty updated' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/faculty/:id', requireAuth, async (req, res) => {
  try {
    const deptId = getDeptId(req);
    if (!(await verifyDeptOwnership('faculty', req.params.id, deptId)))
      return res.status(403).json({ error: 'Faculty does not belong to your department' });

    // Null-out faculty_id in all timetable entries so slots remain but show unassigned
    const affected = await run(
      'UPDATE timetable_entries SET faculty_id = NULL WHERE faculty_id = $1',
      [req.params.id]
    );

    // Also remove from lab_assignments
    await run('DELETE FROM lab_assignments WHERE faculty_id = $1', [req.params.id]);

    await run('DELETE FROM faculty WHERE id=$1', [req.params.id]);

    const count = affected.rowCount || 0;
    res.json({
      message: `Faculty deleted. ${count > 0 ? `${count} timetable slot(s) are now unassigned.` : 'No timetable entries were affected.'}`
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get count of timetable entries for a faculty (used before deletion)
router.get('/faculty/:id/timetable-count', requireAuth, async (req, res) => {
  try {
    const deptId = getDeptId(req);
    if (!(await verifyDeptOwnership('faculty', req.params.id, deptId)))
      return res.status(403).json({ error: 'Faculty does not belong to your department' });
    const row = await queryOne(
      'SELECT COUNT(*) as cnt FROM timetable_entries WHERE faculty_id = $1',
      [req.params.id]
    );
    res.json({ count: parseInt(row.cnt) });
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
    // Null-out room_id in timetable entries (no CASCADE on that FK)
    await run('UPDATE timetable_entries SET room_id = NULL WHERE room_id = $1', [req.params.id]);
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

// GET single section by ID (used for lab_subsections lookup)
router.get('/sections/:id', requireAuth, async (req, res) => {
  try {
    const deptId = getDeptId(req);
    if (!(await verifyDeptOwnership('sections', req.params.id, deptId)))
      return res.status(403).json({ error: 'Section does not belong to your department' });
    const row = await queryOne(
      'SELECT s.*, y.display_name as year_name FROM sections s JOIN years y ON s.year_id = y.id WHERE s.id = $1',
      [req.params.id]
    );
    if (!row) return res.status(404).json({ error: 'Section not found' });
    res.json(row);
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

    // Saving a new theory slot (no subsection, no entry_id):
    // If this slot already has lab batch entries, delete them ALL first
    // so the slot can be replaced with a theory class cleanly.
    if (!subsection) {
      const existingLab = await queryOne(
        'SELECT id FROM timetable_entries WHERE section_id=$1 AND time_slot_id=$2 AND day_of_week=$3 AND subsection IS NOT NULL LIMIT 1',
        [section_id, time_slot_id, day_of_week]
      );
      if (existingLab) {
        // Delete ALL batch entries for this slot (all subsections)
        await run(
          'DELETE FROM timetable_entries WHERE section_id=$1 AND time_slot_id=$2 AND day_of_week=$3',
          [section_id, time_slot_id, day_of_week]
        );
      }
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

// Delete ALL entries for a specific section+slot+day (used to clear an entire slot including all lab batches)
router.delete('/timetable/slot', requireAuth, async (req, res) => {
  try {
    const { section_id, time_slot_id, day_of_week } = req.body;
    if (!section_id || !time_slot_id || !day_of_week)
      return res.status(400).json({ error: 'section_id, time_slot_id, day_of_week required' });
    const deptId = getDeptId(req);
    if (!(await verifyDeptOwnership('sections', section_id, deptId)))
      return res.status(403).json({ error: 'Section does not belong to your department' });
    await run(
      'DELETE FROM timetable_entries WHERE section_id=$1 AND time_slot_id=$2 AND day_of_week=$3',
      [section_id, time_slot_id, day_of_week]
    );
    res.json({ message: 'Slot cleared' });
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
// ==================== GENERATION CONSTRAINTS =================================
// =============================================================================

// Supported constraint_type values:
//   faculty_unavailable  — faculty cannot be assigned to a specific day+slot
//   faculty_subject_lock — faculty must teach a specific subject (optionally for a specific section)

// GET constraints for a specific faculty member (must be before /constraints to avoid route ambiguity)
router.get('/constraints/faculty/:facultyId', requireAuth, async (req, res) => {
  try {
    const deptId = getDeptId(req);
    if (!(await verifyDeptOwnership('faculty', req.params.facultyId, deptId)))
      return res.status(403).json({ error: 'Faculty not in your department' });

    const rows = await query(`
      SELECT gc.*,
        sec.name        AS section_name,
        y.display_name  AS year_name,
        subj.name       AS subject_name,
        ts.start_time   AS slot_start,
        ts.end_time     AS slot_end,
        ts.slot_number  AS slot_number
      FROM generation_constraints gc
      LEFT JOIN sections  sec  ON gc.section_id  = sec.id
      LEFT JOIN years     y    ON sec.year_id     = y.id
      LEFT JOIN subjects  subj ON gc.subject_id   = subj.id
      LEFT JOIN time_slots ts  ON gc.slot_id      = ts.id
      WHERE gc.department_id = $1 AND gc.faculty_id = $2
      ORDER BY gc.constraint_type, gc.day, ts.slot_number
    `, [deptId, req.params.facultyId]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET all constraints for this department
router.get('/constraints', requireAuth, async (req, res) => {
  try {
    const deptId = getDeptId(req);
    const rows = await query(`
      SELECT gc.*,
        sec.name        AS section_name,
        y.display_name  AS year_name,
        subj.name       AS subject_name,
        f.name          AS faculty_name,
        ts.start_time   AS slot_start,
        ts.end_time     AS slot_end,
        ts.slot_number  AS slot_number
      FROM generation_constraints gc
      LEFT JOIN sections  sec  ON gc.section_id  = sec.id
      LEFT JOIN years     y    ON sec.year_id     = y.id
      LEFT JOIN subjects  subj ON gc.subject_id   = subj.id
      LEFT JOIN faculty   f    ON gc.faculty_id   = f.id
      LEFT JOIN time_slots ts  ON gc.slot_id      = ts.id
      WHERE gc.department_id = $1
      ORDER BY gc.constraint_type, f.name, gc.day, ts.slot_number
    `, [deptId]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST — create a constraint
// Body fields:
//   constraint_type  (required)  "faculty_unavailable" | "faculty_subject_lock" | "theory_batch_slot"
//
//   faculty_unavailable:
//     faculty_id, day, slot_id  (all required)
//
//   faculty_subject_lock:
//     faculty_id, subject_id    (required); section_id (optional — scopes to one section)
//
//   theory_batch_slot:
//     section_id, subject_id, day, slot_id  (all required)
//     value       (required — batch name, e.g. "A", "B", "C")
//     faculty_id  (optional — pre-assigns the faculty for this batch's pinned slot)
router.post('/constraints', requireAuth, async (req, res) => {
  try {
    const { section_id, subject_id, faculty_id, constraint_type, value, day, slot_id } = req.body;
    if (!constraint_type) return res.status(400).json({ error: 'constraint_type required' });
    const deptId = getDeptId(req);

    // Type-specific validation
    if (constraint_type === 'faculty_unavailable') {
      if (!faculty_id) return res.status(400).json({ error: 'faculty_id required for faculty_unavailable' });
      if (!day)        return res.status(400).json({ error: 'day required for faculty_unavailable' });
      if (!slot_id)    return res.status(400).json({ error: 'slot_id required for faculty_unavailable' });
    }
    if (constraint_type === 'faculty_subject_lock') {
      if (!faculty_id) return res.status(400).json({ error: 'faculty_id required for faculty_subject_lock' });
      if (!subject_id) return res.status(400).json({ error: 'subject_id required for faculty_subject_lock' });
    }
    if (constraint_type === 'theory_batch_slot') {
      if (!section_id) return res.status(400).json({ error: 'section_id required for theory_batch_slot' });
      if (!subject_id) return res.status(400).json({ error: 'subject_id required for theory_batch_slot' });
      if (!day)        return res.status(400).json({ error: 'day required for theory_batch_slot' });
      if (!slot_id)    return res.status(400).json({ error: 'slot_id required for theory_batch_slot' });
      if (!value)      return res.status(400).json({ error: 'value (batch name) required for theory_batch_slot' });
    }

    // Validate ownership of referenced entities
    if (section_id && !(await verifyDeptOwnership('sections', section_id, deptId)))
      return res.status(403).json({ error: 'Section not in your department' });
    if (subject_id && !(await verifyDeptOwnership('subjects', subject_id, deptId)))
      return res.status(403).json({ error: 'Subject not in your department' });
    if (faculty_id && !(await verifyDeptOwnership('faculty', faculty_id, deptId)))
      return res.status(403).json({ error: 'Faculty not in your department' });
    if (slot_id && !(await verifyDeptOwnership('time_slots', slot_id, deptId)))
      return res.status(403).json({ error: 'Time slot not in your department' });

    // Prevent exact duplicates
    if (constraint_type === 'faculty_unavailable') {
      const existing = await queryOne(
        `SELECT id FROM generation_constraints
         WHERE department_id=$1 AND faculty_id=$2 AND constraint_type='faculty_unavailable' AND day=$3 AND slot_id=$4`,
        [deptId, faculty_id, day, slot_id]
      );
      if (existing) return res.json({ id: existing.id, message: 'Constraint already exists' });
    }
    if (constraint_type === 'theory_batch_slot') {
      // One row per batch: dedup on section+subject+day+slot+batch_name(value)
      const existing = await queryOne(
        `SELECT id FROM generation_constraints
         WHERE department_id=$1 AND section_id=$2 AND subject_id=$3
           AND constraint_type='theory_batch_slot' AND day=$4 AND slot_id=$5 AND value=$6`,
        [deptId, section_id, subject_id, day, slot_id, value]
      );
      if (existing) return res.json({ id: existing.id, message: 'Constraint already exists' });
    }

    const result = await run(`
      INSERT INTO generation_constraints
        (department_id, section_id, subject_id, faculty_id, constraint_type, value, day, slot_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id
    `, [deptId, section_id||null, subject_id||null, faculty_id||null,
        constraint_type, value||null, day||null, slot_id||null]);

    res.json({ id: result.rows[0].id, message: 'Constraint saved' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE all constraints for a faculty member (must be before /:id to avoid route collision)
router.delete('/constraints/faculty/:facultyId', requireAuth, async (req, res) => {
  try {
    const deptId = getDeptId(req);
    if (!(await verifyDeptOwnership('faculty', req.params.facultyId, deptId)))
      return res.status(403).json({ error: 'Faculty not in your department' });
    await run(
      'DELETE FROM generation_constraints WHERE department_id=$1 AND faculty_id=$2',
      [deptId, req.params.facultyId]
    );
    res.json({ message: 'Faculty constraints cleared' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE a constraint by id
router.delete('/constraints/:id', requireAuth, async (req, res) => {
  try {
    const deptId = getDeptId(req);
    const row = await queryOne('SELECT department_id FROM generation_constraints WHERE id=$1', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Constraint not found' });
    if (!req.user.isSuperAdmin && row.department_id !== deptId)
      return res.status(403).json({ error: 'Not authorized' });
    await run('DELETE FROM generation_constraints WHERE id=$1', [req.params.id]);
    res.json({ message: 'Constraint deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE all constraints for this department (bulk reset)
router.delete('/constraints', requireAuth, async (req, res) => {
  try {
    const deptId = getDeptId(req);
    await run('DELETE FROM generation_constraints WHERE department_id=$1', [deptId]);
    res.json({ message: 'All constraints cleared' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// =============================================================================
// ==================== GENERATE ===============================================
// =============================================================================

router.post('/generate', requireAuth, async (req, res) => {
  try {
    const { scope, year_id, section_id, days_mode } = req.body;
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

    // days_mode: 'weekdays' = Mon–Fri only; default = Mon–Sat
    const days = days_mode === 'weekdays'
      ? ['Monday','Tuesday','Wednesday','Thursday','Friday']
      : ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

    for (const sec of sections)
      await run('DELETE FROM timetable_entries WHERE section_id=$1', [sec.id]);

    const allFaculty  = await query("SELECT * FROM faculty WHERE role='faculty' AND department_id=$1", [deptId]);
    const allRooms    = await query('SELECT * FROM rooms WHERE department_id=$1', [deptId]);
    const classrooms  = allRooms.filter(r => r.type === 'classroom');
    // Use dedicated lab rooms; fall back to classrooms if none configured
    const labRoomsRaw = allRooms.filter(r => r.type === 'lab');
    const labs        = labRoomsRaw.length > 0 ? labRoomsRaw : classrooms;

    // ── Load generation constraints ───────────────────────────────────────────
    const allConstraints = await query(
      'SELECT * FROM generation_constraints WHERE department_id=$1', [deptId]
    );

    // Set of "faculty_id|day|slot_id" keys where faculty is marked unavailable
    const unavailableSet = new Set();
    for (const c of allConstraints) {
      if (c.constraint_type === 'faculty_unavailable' && c.faculty_id && c.day && c.slot_id) {
        unavailableSet.add(`${c.faculty_id}|${c.day}|${c.slot_id}`);
      }
    }

    // Map: "subject_id|section_id" → faculty_id  (section_id may be null = applies to all sections)
    // More specific (section-scoped) locks override global ones
    const subjectLockMap = {}; // key: "subjectId" or "subjectId|sectionId" → facultyId
    for (const c of allConstraints) {
      if (c.constraint_type === 'faculty_subject_lock' && c.faculty_id && c.subject_id) {
        if (c.section_id) {
          subjectLockMap[`${c.subject_id}|${c.section_id}`] = c.faculty_id;
        } else {
          // Global (all-sections) lock — only set if no section-specific one exists yet
          if (!subjectLockMap[`${c.subject_id}`]) {
            subjectLockMap[`${c.subject_id}`] = c.faculty_id;
          }
        }
      }
    }

    // Returns true if faculty is blocked at this day+slot by a constraint
    const isFacultyUnavailable = (day, slotId, facultyId) =>
      unavailableSet.has(`${facultyId}|${day}|${slotId}`);

    // Map: "section_id|subject_id" → array of { day, slot_id, faculty_id|null }
    // Used by the generator to pre-place pinned theory tokens before the shuffle loop.
    const theoryBatchSlotMap = {}; // key: "sectionId|subjectId" → [{ day, slotId, facultyId }]
    for (const c of allConstraints) {
      if (c.constraint_type === 'theory_batch_slot' && c.section_id && c.subject_id && c.day && c.slot_id) {
        const key = `${c.section_id}|${c.subject_id}`;
        if (!theoryBatchSlotMap[key]) theoryBatchSlotMap[key] = [];
        theoryBatchSlotMap[key].push({
          day:       c.day,
          slotId:    parseInt(c.slot_id),
          facultyId: c.faculty_id ? parseInt(c.faculty_id) : null
        });
      }
    }

    // Returns the locked faculty object for a subject (+ optional section), or null
    const getLockedFaculty = (subjId, sectionId) => {
      const sectionKey = `${subjId}|${sectionId}`;
      const globalKey  = `${subjId}`;
      const lockedId   = subjectLockMap[sectionKey] ?? subjectLockMap[globalKey] ?? null;
      if (!lockedId) return null;
      return allFaculty.find(f => f.id === lockedId) || null;
    };

    const facultyBusy = {};
    const roomBusy    = {};
    const roomUsageCount = Object.fromEntries(labs.map(r => [r.id, 0]));
    const isFacultyFree = (d,s,f) => !facultyBusy[`${d}_${s}`]?.has(f);
    const isRoomFree    = (d,s,r) => !roomBusy[`${d}_${s}`]?.has(r);
    const markFaculty   = (d,s,f) => { const k=`${d}_${s}`; if(!facultyBusy[k]) facultyBusy[k]=new Set(); facultyBusy[k].add(f); };
    const markRoom      = (d,s,r) => { const k=`${d}_${s}`; if(!roomBusy[k]) roomBusy[k]=new Set(); roomBusy[k].add(r); };
    const shuffle = a => { const b=[...a]; for(let i=b.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[b[i],b[j]]=[b[j],b[i]];} return b; };

    // Normalize subjects_can_teach to string IDs for reliable matching
    const canTeach = (f, subjId) => {
      try {
        const arr = JSON.parse(f.subjects_can_teach || '[]');
        return arr.some(id => String(id) === String(subjId));
      } catch { return false; }
    };

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
      // - BTU sections: ONLY BTU labs (BTU labs are exclusive to BTU sections)
      // - Non-BTU sections: ONLY regular labs
      const labSubjects = isBtuSection ? [...btuLabs] : [...regularLabs];

      // Eligible theory for this section:
      // - BTU sections: BTU subjects (guaranteed) + regular subjects
      // - Non-BTU sections: only regular subjects (max 6)
      let cappedTheory;
      if (isBtuSection && btuTheory.length > 0) {
        // BTU subjects come first (guaranteed), then top regular subjects to fill to 7
        const remainingSlots = Math.max(0, 7 - btuTheory.length);
        const topRegular = [...regularTheory]
          .sort((a, b) => (b.credits || 0) - (a.credits || 0))
          .slice(0, remainingSlots);
        cappedTheory = [...btuTheory, ...topRegular];
      } else {
        cappedTheory = [...regularTheory]
          .sort((a, b) => (b.credits || 0) - (a.credits || 0))
          .slice(0, 6);
      }

      // ── Slot tracking ──────────────────────────────────────────────────────
      const usedSlots  = new Set();
      const dayLoad    = Object.fromEntries(days.map(d => [d, 0]));
      const dayLabLoad = Object.fromEntries(days.map(d => [d, 0]));

      // ── Schedule LAB subjects: all batches run simultaneously but each batch does a DIFFERENT lab ──
      // Batch A → Lab subject 1 in Room X, Batch B → Lab subject 2 in Room Y, etc.
      // We rotate through lab subjects across sessions so every batch covers every lab over the week.
      //
      // Algorithm:
      //   - Build a "token" list: for each lab subject, push it hours_per_week times (like theory tokens)
      //   - Each "session" = one consecutive slot group on one day
      //   - In each session, assign one DISTINCT lab subject per batch (round-robin from remaining tokens)
      //   - Each batch gets its pre-assigned faculty for that subject + a separate room

      // Build lab tokens: one entry per required session-hour for each lab subject
      // Each token = { subj, sessionIndex } — sessionIndex tracks which occurrence of this subject
      const labTokens = [];
      for (const subj of labSubjects) {
        const hoursNeeded = subj.hours_per_week || 2;
        labTokens.push({ subj, hoursNeeded });
      }

      // We need to schedule ceil(labTokens.length / numSubsections) sessions
      // In each session all numSubsections batches are busy simultaneously
      // Pair subjects to batches for each session: session 0 → [subj0→batchA, subj1→batchB, subj2→batchC]
      //                                             session 1 → [subj1→batchA, subj2→batchB, subj0→batchC] (rotate)
      // Actually simpler: just work through labTokens in order, assigning numSubsections per session

      // Flatten into sessions: group labTokens into groups of numSubsections (one per session)
      // If labSubjects.length < numSubsections, some batches in a session get null (no lab that session)
      const sessions = [];
      for (let i = 0; i < labTokens.length; i += numSubsections) {
        sessions.push(labTokens.slice(i, i + numSubsections));
      }

      // Sort days by lab load for even distribution
      for (const sessionSubjects of sessions) {
        const hoursNeeded = Math.max(...sessionSubjects.map(t => t.hoursNeeded));

        const sortedDays = [...days].sort((a, b) => dayLabLoad[a] - dayLabLoad[b]);
        let sessionPlaced = false;

        for (const day of sortedDays) {
          if (sessionPlaced) break;

          const freeSlots = allSlots.filter(sl => !usedSlots.has(`${day}_${sl.id}`));
          if (freeSlots.length < hoursNeeded) continue;

          // Build consecutive groups
          const groups = [];
          let cur = [freeSlots[0]];
          for (let i = 1; i < freeSlots.length; i++) {
            if (freeSlots[i].slot_number === freeSlots[i-1].slot_number + 1) {
              cur.push(freeSlots[i]);
            } else {
              if (cur.length >= hoursNeeded) groups.push([...cur]);
              cur = [freeSlots[i]];
            }
          }
          if (cur.length >= hoursNeeded) groups.push(cur);
          if (!groups.length) continue;

          for (const group of groups) {
            if (sessionPlaced) break;
            for (let start = 0; start <= group.length - hoursNeeded; start++) {
              const candidate = group.slice(start, start + hoursNeeded);

              // Resolve faculty per batch for this session
              // batchIndex bi → sessionSubjects[bi] (the lab subject assigned to that batch)
              const batchFacultyList = [];
              for (let bi = 0; bi < numSubsections; bi++) {
                const token = sessionSubjects[bi]; // may be undefined if fewer labs than batches
                if (!token) { batchFacultyList.push(null); continue; }
                const subj = token.subj;
                const preAssigned = assignedFaculty[subj.id] || {};
                const batchName = batchNames[bi];
                let batchFaculty = null;
                const preId = preAssigned[batchName];
                if (preId) {
                  const pre = allFaculty.find(f => f.id === preId);
                  if (pre) batchFaculty = pre;
                }
                if (!batchFaculty) {
                  const locked = getLockedFaculty(subj.id, section.id);
                  if (locked) batchFaculty = locked;
                }
                batchFacultyList.push(batchFaculty);
              }

              // Check all assigned faculty are free at this candidate
              const allFacultyFree = batchFacultyList.every((bf, bi) => {
                if (!bf) return true; // null faculty — no conflict
                return candidate.every(sl =>
                  isFacultyFree(day, sl.id, bf.id) && !isFacultyUnavailable(day, sl.id, bf.id)
                );
              });
              if (!allFacultyFree) continue;

              // Find separate free lab rooms for each batch
              const usedLabIds = new Set();
              const batchRooms = [];
              let roomsOk = true;
              for (let bi = 0; bi < numSubsections; bi++) {
                const availableLab = labs.filter(r =>
                  !usedLabIds.has(r.id) &&
                  candidate.every(sl => isRoomFree(day, sl.id, r.id))
                ).sort((a, b) => roomUsageCount[a.id] - roomUsageCount[b.id])[0];
                if (!availableLab) { roomsOk = false; break; }
                batchRooms.push(availableLab);
                usedLabIds.add(availableLab.id);
              }
              if (!roomsOk) continue;

              // Place all batches — each with its own subject, faculty, and room
              for (let bi = 0; bi < numSubsections; bi++) {
                const token = sessionSubjects[bi];
                if (!token) continue; // no lab assigned to this batch in this session
                const subj = token.subj;
                const batchName = batchNames[bi];
                const batchFaculty = batchFacultyList[bi];
                const labRoom = batchRooms[bi];

                for (const sl of candidate) {
                  await run(
                    'INSERT INTO timetable_entries (section_id,time_slot_id,day_of_week,subject_id,faculty_id,room_id,subsection) VALUES ($1,$2,$3,$4,$5,$6,$7)',
                    [section.id, sl.id, day, subj.id, batchFaculty ? batchFaculty.id : null, labRoom.id, batchName]
                  );
                  if (batchFaculty) markFaculty(day, sl.id, batchFaculty.id);
                  markRoom(day, sl.id, labRoom.id);
                }
                roomUsageCount[labRoom.id]++;
              }

              // Mark slots as used
              for (const sl of candidate) {
                usedSlots.add(`${day}_${sl.id}`);
                dayLabLoad[day]++;
                dayLoad[day]++;
              }

              sessionPlaced = true;
              break;
            }
          }
        }

        if (!sessionPlaced) {
          const names = sessionSubjects.map(t => t.subj.name).join(', ');
          console.warn(`Warning: Could not place lab session [${names}] for section ${section.name} — no free consecutive slots`);
        }
      }

      // ── Schedule THEORY subjects (max 6 for regular, max 7 for BTU, spread evenly) ──
      const MAX_THEORY = isBtuSection ? 7 : 6;
      let theoryTokens = [];
      for (const subj of cappedTheory) {
        for (let i = 0; i < (subj.hours_per_week || 1); i++) {
          theoryTokens.push(subj);
        }
      }
      theoryTokens = shuffle(theoryTokens);

      const daySubjects = Object.fromEntries(days.map(d => [d, new Set()]));
      const preferredRoomId = sectionRoomMap[section.id];
      const facultyTheoryCount = Object.fromEntries(allFaculty.map(f => [f.id, 0]));

      // ── Pre-place theory_batch_slot pinned entries ─────────────────────────
      // Each constraint row = one batch (value = batch name e.g. "A","B","C").
      // Rows sharing section+subject+day+slot are grouped and placed together
      // at that slot, like labs: one timetable entry per batch, subsection=batchName,
      // different rooms, different faculty. Consumes N tokens (one per batch row).

      // Collect all batch pins for this section, grouped by subject+day+slot
      const sectionPins = allConstraints.filter(c =>
        c.constraint_type === 'theory_batch_slot' &&
        parseInt(c.section_id) === section.id &&
        c.day && c.slot_id && c.value   // value = batch name
      );

      // Group by "subjectId|day|slotId" → array of batch rows
      const pinGroups = {};
      for (const pin of sectionPins) {
        const gk = `${pin.subject_id}|${pin.day}|${pin.slot_id}`;
        if (!pinGroups[gk]) pinGroups[gk] = [];
        pinGroups[gk].push(pin);
      }

      for (const [gk, batchPins] of Object.entries(pinGroups)) {
        const firstPin  = batchPins[0];
        const pinDay    = firstPin.day;
        const pinSlotId = parseInt(firstPin.slot_id);
        const pinSubj   = cappedTheory.find(s => s.id === parseInt(firstPin.subject_id));
        if (!pinSubj) continue;   // subject not in this section's capped theory list

        const slotKey = `${pinDay}_${pinSlotId}`;
        if (usedSlots.has(slotKey)) {
          console.warn(`theory_batch_slot: slot ${pinDay} #${pinSlotId} occupied for section ${section.name} — skipping ${pinSubj.name}`);
          continue;
        }
        const slotObj = allSlots.find(sl => sl.id === pinSlotId);
        if (!slotObj) continue;

        // Resolve faculty + room per batch — mirrors the lab placement logic
        const usedRoomIds  = new Set();
        const usedFacIds   = new Set();
        let   allBatchesOk = true;

        const resolvedBatches = [];
        for (const pin of batchPins) {
          const batchName = pin.value;

          // Faculty: pinned → subject-lock → eligible pool (must be free & not already used in another batch here)
          let chosenF = null;
          if (pin.faculty_id) {
            const fCandidate = allFaculty.find(f => f.id === parseInt(pin.faculty_id));
            if (fCandidate &&
                isFacultyFree(pinDay, pinSlotId, fCandidate.id) &&
                !isFacultyUnavailable(pinDay, pinSlotId, fCandidate.id) &&
                !usedFacIds.has(fCandidate.id)) {
              chosenF = fCandidate;
            } else if (fCandidate) {
              console.warn(`theory_batch_slot: pinned faculty ${fCandidate.name} unavailable for batch ${batchName} at ${pinDay} #${pinSlotId} — using fallback`);
            }
          }
          if (!chosenF) {
            const locked = getLockedFaculty(pinSubj.id, section.id);
            if (locked &&
                isFacultyFree(pinDay, pinSlotId, locked.id) &&
                !isFacultyUnavailable(pinDay, pinSlotId, locked.id) &&
                !usedFacIds.has(locked.id)) {
              chosenF = locked;
            }
          }
          if (!chosenF) {
            const eligible = allFaculty.filter(f => canTeach(f, pinSubj.id));
            chosenF = shuffle(eligible)
              .find(f =>
                isFacultyFree(pinDay, pinSlotId, f.id) &&
                !isFacultyUnavailable(pinDay, pinSlotId, f.id) &&
                !usedFacIds.has(f.id)
              ) || null;
          }
          if (chosenF) usedFacIds.add(chosenF.id);

          // Room: pick a free classroom not yet used by another batch in this group
          const chosenR = shuffle([...classrooms]).find(r =>
            !usedRoomIds.has(r.id) && isRoomFree(pinDay, pinSlotId, r.id)
          ) || null;

          if (!chosenR) {
            console.warn(`theory_batch_slot: no free room for batch ${batchName} at ${pinDay} #${pinSlotId} in section ${section.name}`);
            allBatchesOk = false;
            break;
          }
          usedRoomIds.add(chosenR.id);
          resolvedBatches.push({ batchName, chosenF, chosenR });
        }

        if (!allBatchesOk) continue;   // skip this group if any batch couldn't get a room

        // Insert one timetable entry per batch with subsection = batchName
        for (const { batchName, chosenF, chosenR } of resolvedBatches) {
          await run(
            'INSERT INTO timetable_entries (section_id,time_slot_id,day_of_week,subject_id,faculty_id,room_id,subsection) VALUES ($1,$2,$3,$4,$5,$6,$7)',
            [section.id, pinSlotId, pinDay, pinSubj.id, chosenF ? chosenF.id : null, chosenR.id, batchName]
          );
          if (chosenF) { markFaculty(pinDay, pinSlotId, chosenF.id); facultyTheoryCount[chosenF.id] = (facultyTheoryCount[chosenF.id] || 0) + 1; }
          markRoom(pinDay, pinSlotId, chosenR.id);
        }

        // Mark the slot used and remove ONE token per batch from theoryTokens
        usedSlots.add(slotKey);
        daySubjects[pinDay].add(pinSubj.id);
        dayLoad[pinDay]++;
        for (let bi = 0; bi < resolvedBatches.length; bi++) {
          const tokenIdx = theoryTokens.findIndex(t => t.id === pinSubj.id);
          if (tokenIdx !== -1) theoryTokens.splice(tokenIdx, 1);
        }
      }
      // ── End pre-placement ──────────────────────────────────────────────────

      // Target slots per day: spread tokens evenly across available days
      const targetPerDay = Math.ceil(theoryTokens.length / days.length);

      let pi = 0, attempts = 0;
      const maxAttempts = theoryTokens.length * days.length * allSlots.length * 2;

      while (pi < theoryTokens.length && attempts < maxAttempts) {
        attempts++;
        const subj = theoryTokens[pi];

        // Pick the least-loaded day that hasn't already scheduled this subject today
        // and hasn't hit its target yet (if possible)
        const sortedDays = [...days]
          .filter(d => !daySubjects[d].has(subj.id))
          .sort((a, b) => dayLoad[a] - dayLoad[b]);

        if (!sortedDays.length) {
          // All days already have this subject — skip (shouldn't happen, but safety)
          pi++;
          continue;
        }

        let placed = false;
        for (const day of sortedDays) {
          if (placed) break;
          // Prefer days below target first, then allow overflow
          if (dayLoad[day] >= targetPerDay + 1 && sortedDays.some(d => dayLoad[d] < targetPerDay)) continue;

          // Try slots on this day that are free
          const freeSlots = allSlots.filter(sl => !usedSlots.has(`${day}_${sl.id}`));
          const shuffledFree = shuffle(freeSlots);

          for (const slot of shuffledFree) {
            const key = `${day}_${slot.id}`;

            // Find eligible faculty — respect subject-lock and unavailability constraints
            const lockedF = getLockedFaculty(subj.id, section.id);
            let chosenF;
            if (lockedF) {
              // Use locked faculty if they are free and available at this slot
              chosenF = (isFacultyFree(day, slot.id, lockedF.id) && !isFacultyUnavailable(day, slot.id, lockedF.id))
                ? lockedF : null;
            } else {
              const eligible = allFaculty.filter(f => canTeach(f, subj.id));
              const candidateFaculty = shuffle(eligible)
                .sort((a, b) => facultyTheoryCount[a.id] - facultyTheoryCount[b.id]);
              chosenF = candidateFaculty.find(f =>
                isFacultyFree(day, slot.id, f.id) && !isFacultyUnavailable(day, slot.id, f.id)
              );
            }
            if (!chosenF) continue;

            const preferred = classrooms.find(r => r.id === preferredRoomId);
            const chosenR = (preferred && isRoomFree(day, slot.id, preferred.id))
              ? preferred
              : shuffle([...classrooms]).find(r => isRoomFree(day, slot.id, r.id));
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
            placed = true;
            break;
          }
        }

        if (!placed) {
          // Couldn't place on any preferred day — try any remaining day without subject restriction
          let forcePlaced = false;
          for (const day of [...days].sort((a,b) => dayLoad[a]-dayLoad[b])) {
            if (forcePlaced) break;
            const freeSlots = shuffle(allSlots.filter(sl => !usedSlots.has(`${day}_${sl.id}`)));
            for (const slot of freeSlots) {
              // Respect subject-lock and unavailability constraints in force-place too
              const lockedF2 = getLockedFaculty(subj.id, section.id);
              let chosenF;
              if (lockedF2) {
                chosenF = (isFacultyFree(day, slot.id, lockedF2.id) && !isFacultyUnavailable(day, slot.id, lockedF2.id))
                  ? lockedF2 : null;
              } else {
                const eligible = allFaculty.filter(f => canTeach(f, subj.id));
                chosenF = shuffle(eligible)
                  .find(f => isFacultyFree(day, slot.id, f.id) && !isFacultyUnavailable(day, slot.id, f.id));
              }
              if (!chosenF) continue;
              const preferred = classrooms.find(r => r.id === preferredRoomId);
              const chosenR = (preferred && isRoomFree(day, slot.id, preferred.id))
                ? preferred
                : shuffle([...classrooms]).find(r => isRoomFree(day, slot.id, r.id));
              if (!chosenR) continue;
              await run(
                'INSERT INTO timetable_entries (section_id,time_slot_id,day_of_week,subject_id,faculty_id,room_id,subsection) VALUES ($1,$2,$3,$4,$5,$6,NULL)',
                [section.id, slot.id, day, subj.id, chosenF.id, chosenR.id]
              );
              markFaculty(day, slot.id, chosenF.id);
              markRoom(day, slot.id, chosenR.id);
              usedSlots.add(`${day}_${slot.id}`);
              daySubjects[day].add(subj.id);
              dayLoad[day]++;
              facultyTheoryCount[chosenF.id]++;
              pi++;
              forcePlaced = true;
              break;
            }
          }
          if (!forcePlaced) {
            console.warn(`Could not place theory token for ${subj.name} in section ${section.name}`);
            pi++; // skip to avoid infinite loop
          }
        }
      }
    }

    const totalRow = await queryOne(
      'SELECT COUNT(*) as cnt FROM timetable_entries WHERE section_id = ANY($1)',
      [sections.map(s => s.id)]
    );
    
    // ── Quality check & auto-retry ──────────────────────────────────────────
    // For each section, check if day distribution is uneven (max - min > 3)
    // If so, clear that section and regenerate it (up to 2 retries per section)
    let retriedSections = 0;
    for (const section of sections) {
      let retries = 0;
      while (retries < 2) {
        const sectionEntries = await query(
          `SELECT day_of_week, COUNT(*) as cnt FROM timetable_entries WHERE section_id=$1 GROUP BY day_of_week`,
          [section.id]
        );
        if (!sectionEntries.length) break;

        const dayCounts = Object.fromEntries(days.map(d => [d, 0]));
        sectionEntries.forEach(r => { if (dayCounts[r.day_of_week] !== undefined) dayCounts[r.day_of_week] = parseInt(r.cnt); });
        const counts = Object.values(dayCounts);
        const maxC = Math.max(...counts);
        const minC = Math.min(...counts.filter(c => c > 0)); // ignore empty days (weekend in Mon-Fri mode)
        const activeDays = Object.entries(dayCounts).filter(([d]) => days.includes(d));
        const nonZeroCounts = activeDays.map(([,c]) => c).filter(c => c > 0);
        const spread = nonZeroCounts.length > 1 ? maxC - Math.min(...nonZeroCounts) : 0;

        if (spread <= 3) break; // acceptable distribution

        // Regenerate this section
        await run('DELETE FROM timetable_entries WHERE section_id=$1', [section.id]);
        retriedSections++;
        retries++;

        // Re-run the same generation logic for this one section
        // (inline call — we re-use all the same faculty/room busy maps)
        const subjects2 = await query('SELECT * FROM subjects WHERE year_id=$1', [section.year_id]);
        if (!subjects2.length) break;

        const isBtu2 = /btu/i.test(section.name);
        const theoryS2 = subjects2.filter(s => s.type !== 'lab');
        const labS2    = subjects2.filter(s => s.type === 'lab');
        const regLabs2 = labS2.filter(s => s.category !== 'btu');
        const btuLabs2 = labS2.filter(s => s.category === 'btu');
        const labSubjs2 = isBtu2 ? [...btuLabs2] : [...regLabs2];
        const regTh2 = theoryS2.filter(s => s.category !== 'btu');
        const btuTh2 = theoryS2.filter(s => s.category === 'btu');
        let capped2;
        if (isBtu2 && btuTh2.length > 0) {
          const rem = Math.max(0, 7 - btuTh2.length);
          capped2 = [...btuTh2, ...[...regTh2].sort((a,b)=>(b.credits||0)-(a.credits||0)).slice(0,rem)];
        } else {
          capped2 = [...regTh2].sort((a,b)=>(b.credits||0)-(a.credits||0)).slice(0,6);
        }

        let numSubs2 = section.lab_subsections || 2;
        let bNames2;
        try { bNames2 = JSON.parse(section.subsection_names || 'null'); } catch { bNames2 = null; }
        if (!Array.isArray(bNames2) || bNames2.length !== numSubs2)
          bNames2 = Array.from({ length: numSubs2 }, (_, i) => String.fromCharCode(65+i));

        const labAssign2 = await query('SELECT * FROM lab_assignments WHERE section_id=$1', [section.id]);
        const aFac2 = {};
        for (const a of labAssign2) {
          if (!aFac2[a.subject_id]) aFac2[a.subject_id] = {};
          aFac2[a.subject_id][a.batch_name] = a.faculty_id;
        }

        const used2  = new Set();
        const dLoad2 = Object.fromEntries(days.map(d=>[d,0]));
        const dLab2  = Object.fromEntries(days.map(d=>[d,0]));

        // Re-schedule labs (synchronized: all batches in same slots, different rooms)
        for (const subj of labSubjs2) {
          const hrs = subj.hours_per_week || 2;
          const pre2 = aFac2[subj.id] || {};
          const qFac2 = allFaculty.filter(f => canTeach(f, subj.id));
          const fPool2 = qFac2.length >= numSubs2 ? qFac2 : allFaculty;

          // Pre-resolve faculty per batch (same as main scheduling)
          const bFacList2 = [];
          for (let bi = 0; bi < numSubs2; bi++) {
            const bn = bNames2[bi];
            let bFac2 = null;
            if (pre2[bn]) { const p = allFaculty.find(f=>f.id===pre2[bn]); if(p) bFac2=p; }
            if (!bFac2 && fPool2.length > 0) {
              const usedFacIds2 = bFacList2.map(bf => bf && bf.id);
              bFac2 = shuffle(fPool2).find(f=>!usedFacIds2.includes(f.id)) || shuffle(fPool2)[0] || null;
            }
            bFacList2.push(bFac2);
          }

          let labPlaced2 = false;
          for (const day of [...days].sort((a,b)=>dLab2[a]-dLab2[b])) {
            if (labPlaced2) break;
            const fs2 = allSlots.filter(sl=>!used2.has(`${day}_${sl.id}`));
            if (fs2.length < hrs) continue;
            const grps2 = [];
            let c2 = [fs2[0]];
            for (let i=1;i<fs2.length;i++) {
              if (fs2[i].slot_number===fs2[i-1].slot_number+1) c2.push(fs2[i]);
              else { if(c2.length>=hrs) grps2.push([...c2]); c2=[fs2[i]]; }
            }
            if (c2.length>=hrs) grps2.push(c2);
            for (const g2 of grps2) {
              if (labPlaced2) break;
              for (let s2=0;s2<=g2.length-hrs;s2++) {
                const cand2 = g2.slice(s2,s2+hrs);
                // Check ALL batch faculty are free
                const allFacFree2 = bFacList2.every(bf => bf ? cand2.every(sl=>isFacultyFree(day,sl.id,bf.id)) : true);
                if (!allFacFree2) continue;
                // Find separate lab rooms for each batch
                const usedLabIds2 = new Set();
                const bRooms2 = [];
                let roomsOk2 = true;
                for (let bi=0;bi<numSubs2;bi++) {
                  const aLab2 = labs.filter(r=>!usedLabIds2.has(r.id)&&cand2.every(sl=>isRoomFree(day,sl.id,r.id))).sort((a,b)=>roomUsageCount[a.id]-roomUsageCount[b.id])[0];
                  if (!aLab2) { roomsOk2=false; break; }
                  bRooms2.push(aLab2); usedLabIds2.add(aLab2.id);
                }
                if (!roomsOk2) continue;
                // Place all batches in SAME slots, different rooms
                for (let bi=0;bi<numSubs2;bi++) {
                  const bn=bNames2[bi]; const bf=bFacList2[bi];
                  const lr=bRooms2[bi];
                  for (const sl of cand2) {
                    await run('INSERT INTO timetable_entries (section_id,time_slot_id,day_of_week,subject_id,faculty_id,room_id,subsection) VALUES ($1,$2,$3,$4,$5,$6,$7)',
                      [section.id,sl.id,day,subj.id,bf ? bf.id : null,lr.id,bn]);
                    if (bf) markFaculty(day,sl.id,bf.id);
                    markRoom(day,sl.id,lr.id);
                  }
                  roomUsageCount[lr.id]++;
                }
                for (const sl of cand2) { used2.add(`${day}_${sl.id}`); dLab2[day]++; dLoad2[day]++; }
                labPlaced2=true; break;
              }
            }
          }
        }

        // Re-schedule theory
        let tokens2 = [];
        for (const subj of capped2) for (let i=0;i<(subj.hours_per_week||1);i++) tokens2.push(subj);
        tokens2 = shuffle(tokens2);
        const daySubj2 = Object.fromEntries(days.map(d=>[d,new Set()]));
        const fThCnt2  = Object.fromEntries(allFaculty.map(f=>[f.id,0]));
        const tgt2     = Math.ceil(tokens2.length/days.length);
        const prefR2   = sectionRoomMap[section.id];
        let p2=0, att2=0;
        while (p2<tokens2.length && att2<tokens2.length*days.length*allSlots.length*2) {
          att2++;
          const subj = tokens2[p2];
          const sDays2 = [...days].filter(d=>!daySubj2[d].has(subj.id)).sort((a,b)=>dLoad2[a]-dLoad2[b]);
          if (!sDays2.length) { p2++; continue; }
          let placed2b = false;
          for (const day of sDays2) {
            if (placed2b) break;
            if (dLoad2[day]>=tgt2+1 && sDays2.some(d=>dLoad2[d]<tgt2)) continue;
            const fSlots2 = shuffle(allSlots.filter(sl=>!used2.has(`${day}_${sl.id}`)));
            for (const slot of fSlots2) {
              const elig2 = allFaculty.filter(f => canTeach(f, subj.id));
              const cF2 = shuffle(elig2.length?elig2:allFaculty).sort((a,b)=>fThCnt2[a.id]-fThCnt2[b.id]).find(f=>isFacultyFree(day,slot.id,f.id));
              if (!cF2) continue;
              const pref2 = classrooms.find(r=>r.id===prefR2);
              const cR2 = (pref2&&isRoomFree(day,slot.id,pref2.id)) ? pref2 : shuffle([...classrooms]).find(r=>isRoomFree(day,slot.id,r.id));
              if (!cR2) continue;
              await run('INSERT INTO timetable_entries (section_id,time_slot_id,day_of_week,subject_id,faculty_id,room_id,subsection) VALUES ($1,$2,$3,$4,$5,$6,NULL)',
                [section.id,slot.id,day,subj.id,cF2.id,cR2.id]);
              markFaculty(day,slot.id,cF2.id); markRoom(day,slot.id,cR2.id);
              used2.add(`${day}_${slot.id}`); daySubj2[day].add(subj.id);
              dLoad2[day]++; fThCnt2[cF2.id]++; p2++; placed2b=true; break;
            }
          }
          if (!placed2b) p2++;
        }
      }
    }

    const finalRow = await queryOne(
      'SELECT COUNT(*) as cnt FROM timetable_entries WHERE section_id = ANY($1)',
      [sections.map(s => s.id)]
    );

    const stats = {
      totalEntries: finalRow.cnt,
      sectionsGenerated: sections.length,
      avgEntriesPerSection: Math.round(finalRow.cnt / sections.length),
      retriedSections,
      generatedAt: new Date().toISOString()
    };
    
    res.json({ 
      success: true, 
      message: `Timetable generated for ${sections.length} section(s). Total entries: ${finalRow.cnt}${retriedSections > 0 ? ` (${retriedSections} section(s) auto-rebalanced)` : ''}`,
      stats
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
