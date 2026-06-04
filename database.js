/**
 * database.js
 * Uses sql.js (pure JavaScript SQLite) so it works on Vercel / any serverless platform.
 * Data is stored in /tmp/timetable.db when a writable filesystem is available.
 * On cold starts the DB is re-seeded from the in-memory seed data.
 */

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(require('os').tmpdir(), 'timetable.db');

let _db = null;

async function getDb() {
  if (_db) return _db;
  const SQL = await initSqlJs();

  // Try to load from disk (persists within the same serverless instance lifetime)
  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    _db = new SQL.Database(buf);
  } else {
    _db = new SQL.Database();
  }
  return _db;
}

function saveDb() {
  if (!_db) return;
  try {
    const data = _db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  } catch (e) {
    // /tmp may not always be writable — ignore silently
  }
}

// ─── Synchronous wrapper ──────────────────────────────────────────────────────
// sql.js is synchronous once initialised; we expose a sync API identical to
// better-sqlite3 so no routes need to change.

let _syncDb = null;
let _SQL = null;

function initSync() {
  // sql.js init is async, but we call this once at startup with await
  throw new Error('Call initializeDatabase() and await it before using getDb()');
}

function getDbSync() {
  if (!_syncDb) throw new Error('DB not initialised. Call initializeDatabase() first.');
  return _syncDb;
}

// Thin wrapper that makes sql.js look like better-sqlite3
class SyncDB {
  constructor(sqlDb) {
    this._db = sqlDb;
  }

  prepare(sql) {
    const db = this._db;
    return {
      run(...params) {
        db.run(sql, params);
        // get lastInsertRowid
        const [[rowid]] = db.exec('SELECT last_insert_rowid()')[0]?.values || [[0]];
        return { lastInsertRowid: rowid, changes: 1 };
      },
      get(...params) {
        const res = db.exec(sql, params);
        if (!res.length || !res[0].values.length) return undefined;
        const cols = res[0].columns;
        const row = res[0].values[0];
        const obj = {};
        cols.forEach((c, i) => obj[c] = row[i]);
        return obj;
      },
      all(...params) {
        const res = db.exec(sql, params);
        if (!res.length) return [];
        const cols = res[0].columns;
        return res[0].values.map(row => {
          const obj = {};
          cols.forEach((c, i) => obj[c] = row[i]);
          return obj;
        });
      }
    };
  }

  exec(sql) {
    this._db.run(sql);
    return this;
  }

  pragma(str) {
    try { this._db.run(`PRAGMA ${str}`); } catch {}
    return this;
  }
}

async function initializeDatabase() {
  if (_syncDb) return _syncDb;

  _SQL = await initSqlJs();

  let rawDb;
  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    rawDb = new _SQL.Database(buf);
  } else {
    rawDb = new _SQL.Database();
  }

  _syncDb = new SyncDB(rawDb);

  // Create tables
  rawDb.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin'
    );
    CREATE TABLE IF NOT EXISTS years (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      display_name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      year_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      FOREIGN KEY (year_id) REFERENCES years(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS subjects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      year_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      code TEXT,
      type TEXT NOT NULL DEFAULT 'theory',
      credits INTEGER DEFAULT 3,
      hours_per_week INTEGER DEFAULT 3,
      FOREIGN KEY (year_id) REFERENCES years(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS faculty (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      designation TEXT,
      role TEXT DEFAULT 'faculty',
      email TEXT,
      subjects_can_teach TEXT DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'classroom',
      capacity INTEGER DEFAULT 60
    );
    CREATE TABLE IF NOT EXISTS time_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slot_number INTEGER NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      is_break INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS timetable_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      section_id INTEGER NOT NULL,
      time_slot_id INTEGER NOT NULL,
      day_of_week TEXT NOT NULL,
      subject_id INTEGER,
      faculty_id INTEGER,
      room_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE CASCADE,
      FOREIGN KEY (time_slot_id) REFERENCES time_slots(id),
      FOREIGN KEY (subject_id) REFERENCES subjects(id),
      FOREIGN KEY (faculty_id) REFERENCES faculty(id),
      FOREIGN KEY (room_id) REFERENCES rooms(id)
    );
  `);

  // Seed only on truly first run
  const userCount    = _syncDb.prepare('SELECT COUNT(*) as cnt FROM users').get().cnt;
  const roomCount    = _syncDb.prepare('SELECT COUNT(*) as cnt FROM rooms').get().cnt;
  const facultyCount = _syncDb.prepare('SELECT COUNT(*) as cnt FROM faculty').get().cnt;
  if (userCount === 0 && roomCount === 0 && facultyCount === 0) {
    seedDatabase(_syncDb);
  }

  // Persist to /tmp
  saveDb();
  return _syncDb;
}

// Auto-save after every mutating request
function saveAfterWrite() {
  saveDb();
}

function seedDatabase(db) {
  db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run('admin', 'admin123', 'admin');

  const years = [
    { name: 'year1', display_name: 'B.Tech I Year' },
    { name: 'year2', display_name: 'B.Tech II Year' },
    { name: 'year3', display_name: 'B.Tech III Year' }
  ];
  for (const y of years) db.prepare('INSERT INTO years (name, display_name) VALUES (?, ?)').run(y.name, y.display_name);

  for (let yearId = 1; yearId <= 3; yearId++)
    for (const sec of ['A', 'B', 'C'])
      db.prepare('INSERT INTO sections (year_id, name) VALUES (?, ?)').run(yearId, sec);

  const subjects = [
    [1,'Engineering Mathematics-I','MA101','theory',4,4],[1,'Engineering Physics','PH101','theory',3,3],
    [1,'Engineering Chemistry','CH101','theory',3,3],[1,'Basic Electrical Engineering','EE101','theory',3,3],
    [1,'Programming in C','CS101','theory',3,3],[1,'Engineering Drawing','ME101','lab',2,2],
    [1,'English Communication','EN101','theory',2,2],[1,'Environmental Science','ES101','theory',2,2],
    [2,'Engineering Mathematics-III','MA201','theory',4,4],[2,'Data Structures','CS201','theory',4,4],
    [2,'Digital Electronics','EC201','theory',3,3],[2,'Object Oriented Programming','CS202','theory',3,3],
    [2,'Computer Organization','CS203','theory',3,3],[2,'Discrete Mathematics','MA202','theory',3,3],
    [2,'Database Management Systems','CS204','theory',3,3],[2,'Operating Systems','CS205','theory',3,3],
    [3,'Design and Analysis of Algorithms','CS301','theory',4,4],[3,'Computer Networks','CS302','theory',3,3],
    [3,'Software Engineering','CS303','theory',3,3],[3,'Compiler Design','CS304','theory',3,3],
    [3,'Artificial Intelligence','CS305','theory',3,3],[3,'Web Technologies','CS306','lab',2,2],
    [3,'Machine Learning','CS307','theory',3,3],[3,'Cloud Computing','CS308','theory',3,3]
  ];
  for (const s of subjects)
    db.prepare('INSERT INTO subjects (year_id, name, code, type, credits, hours_per_week) VALUES (?,?,?,?,?,?)').run(...s);

  const faculty = [
    ['Dr. Rajesh Kumar','Professor','faculty'],['Dr. Priya Sharma','Professor','faculty'],
    ['Dr. Amit Singh','Associate Professor','faculty'],['Dr. Sunita Patel','Associate Professor','faculty'],
    ['Dr. Vikram Rao','Professor','faculty'],['Dr. Meena Joshi','Associate Professor','faculty'],
    ['Dr. Suresh Nair','Professor','faculty'],['Dr. Kavitha Reddy','Associate Professor','faculty'],
    ['Dr. Arun Mehta','Associate Professor','faculty'],['Dr. Pooja Gupta','Assistant Professor','faculty'],
    ['Prof. Ravi Tiwari','Assistant Professor','faculty'],['Prof. Anita Desai','Assistant Professor','faculty'],
    ['Prof. Manoj Verma','Assistant Professor','faculty'],['Prof. Shalini Mishra','Assistant Professor','faculty'],
    ['Prof. Deepak Jain','Assistant Professor','faculty'],['Prof. Rekha Pillai','Assistant Professor','faculty'],
    ['Prof. Sanjay Bhatt','Assistant Professor','faculty'],['Prof. Nisha Agarwal','Assistant Professor','faculty'],
    ['Prof. Kiran Yadav','Assistant Professor','faculty'],['Prof. Rohit Saxena','Assistant Professor','faculty'],
    ['Prof. Divya Nair','Assistant Professor','faculty'],['Prof. Sunil Patil','Assistant Professor','faculty'],
    ['Prof. Geeta Sharma','Assistant Professor','faculty'],['Prof. Harish Chandra','Assistant Professor','faculty'],
    ['Prof. Lalitha Devi','Assistant Professor','faculty'],
    ['Dr. Venkat Raman','Professor','hod_mentor'],['Dr. Savitha Krishnan','Professor','hod_admin']
  ];
  const allIds = Array.from({length:24},(_,i)=>i+1);
  for (let i = 0; i < faculty.length; i++) {
    const [name, desig, role] = faculty[i];
    let canTeach = [];
    if (role === 'faculty') {
      const s = (i*3) % allIds.length;
      canTeach = [allIds[s], allIds[(s+1)%24], allIds[(s+2)%24]];
    }
    db.prepare('INSERT INTO faculty (name, designation, role, subjects_can_teach) VALUES (?,?,?,?)').run(name, desig, role, JSON.stringify(canTeach));
  }

  const rooms = [
    ['Room 101','classroom',60],['Room 102','classroom',60],['Room 103','classroom',60],
    ['Room 104','classroom',60],['Room 105','classroom',60],['Room 106','classroom',60],
    ['Room 107','classroom',60],['Room 108','classroom',60],['Room 109','classroom',60],
    ['Computer Lab 1','lab',40],['Computer Lab 2','lab',40],['Computer Lab 3','lab',40],
    ['Physics Lab','lab',30],['Chemistry Lab','lab',30],['Electronics Lab','lab',30],
    ['Seminar Hall','seminar',150],['Conference Room','conference',30]
  ];
  for (const r of rooms)
    db.prepare('INSERT INTO rooms (name, type, capacity) VALUES (?,?,?)').run(...r);

  const slots = [
    [1,'08:00','09:00',0],[2,'09:00','09:50',0],[3,'09:50','10:40',0],[4,'10:40','11:30',0],
    [5,'11:30','12:30',1],[6,'12:30','13:20',0],[7,'13:20','14:10',0],[8,'14:10','15:00',0]
  ];
  for (const s of slots)
    db.prepare('INSERT INTO time_slots (slot_number, start_time, end_time, is_break) VALUES (?,?,?,?)').run(...s);

  console.log('Database seeded successfully.');
  saveDb();
}

module.exports = { getDb: getDbSync, initializeDatabase, saveAfterWrite };
