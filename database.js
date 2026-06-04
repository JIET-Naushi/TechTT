/**
 * database.js — Postgres (Neon) backend
 * Uses the pg (node-postgres) library.
 * Connection string comes from POSTGRES_URL env variable (set in Vercel dashboard).
 */

const { Pool } = require('pg');

let pool;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.POSTGRES_URL,
      ssl: { rejectUnauthorized: false }
    });
  }
  return pool;
}

// Helper: run a query and return rows
async function query(sql, params = []) {
  const client = getPool();
  const res = await client.query(sql, params);
  return res.rows;
}

// Helper: run a query and return first row
async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

// Helper: run INSERT/UPDATE/DELETE and return lastID or rowCount
async function run(sql, params = []) {
  const client = getPool();
  const res = await client.query(sql, params);
  return { rowCount: res.rowCount, rows: res.rows };
}

async function initializeDatabase() {
  // Create all tables
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin'
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS years (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      display_name TEXT NOT NULL
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS sections (
      id SERIAL PRIMARY KEY,
      year_id INTEGER NOT NULL REFERENCES years(id) ON DELETE CASCADE,
      name TEXT NOT NULL
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS subjects (
      id SERIAL PRIMARY KEY,
      year_id INTEGER NOT NULL REFERENCES years(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      code TEXT,
      type TEXT NOT NULL DEFAULT 'theory',
      credits INTEGER DEFAULT 3,
      hours_per_week INTEGER DEFAULT 3
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS faculty (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      designation TEXT,
      role TEXT DEFAULT 'faculty',
      email TEXT,
      subjects_can_teach TEXT DEFAULT '[]'
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS rooms (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'classroom',
      capacity INTEGER DEFAULT 60
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS time_slots (
      id SERIAL PRIMARY KEY,
      slot_number INTEGER NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      is_break INTEGER NOT NULL DEFAULT 0
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS timetable_entries (
      id SERIAL PRIMARY KEY,
      section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
      time_slot_id INTEGER NOT NULL REFERENCES time_slots(id),
      day_of_week TEXT NOT NULL,
      subject_id INTEGER REFERENCES subjects(id),
      faculty_id INTEGER REFERENCES faculty(id),
      room_id INTEGER REFERENCES rooms(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Seed only on first run
  const userCount    = await queryOne('SELECT COUNT(*) as cnt FROM users');
  const roomCount    = await queryOne('SELECT COUNT(*) as cnt FROM rooms');
  const facultyCount = await queryOne('SELECT COUNT(*) as cnt FROM faculty');

  if (parseInt(userCount.cnt) === 0 && parseInt(roomCount.cnt) === 0 && parseInt(facultyCount.cnt) === 0) {
    await seedDatabase();
    console.log('Database seeded successfully.');
  }
}

async function seedDatabase() {
  await run(`INSERT INTO users (username, password, role) VALUES ($1, $2, $3)`, ['admin', 'admin123', 'admin']);

  const years = [['year1','B.Tech I Year'],['year2','B.Tech II Year'],['year3','B.Tech III Year']];
  for (const [name, display_name] of years)
    await run(`INSERT INTO years (name, display_name) VALUES ($1, $2)`, [name, display_name]);

  for (let yearId = 1; yearId <= 3; yearId++)
    for (const sec of ['A','B','C'])
      await run(`INSERT INTO sections (year_id, name) VALUES ($1, $2)`, [yearId, sec]);

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
    await run(`INSERT INTO subjects (year_id,name,code,type,credits,hours_per_week) VALUES ($1,$2,$3,$4,$5,$6)`, s);

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
      const s = (i*3) % 24;
      canTeach = [allIds[s], allIds[(s+1)%24], allIds[(s+2)%24]];
    }
    await run(`INSERT INTO faculty (name,designation,role,subjects_can_teach) VALUES ($1,$2,$3,$4)`,
      [name, desig, role, JSON.stringify(canTeach)]);
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
    await run(`INSERT INTO rooms (name,type,capacity) VALUES ($1,$2,$3)`, r);

  const slots = [
    [1,'08:00','09:00',0],[2,'09:00','09:50',0],[3,'09:50','10:40',0],[4,'10:40','11:30',0],
    [5,'11:30','12:30',1],[6,'12:30','13:20',0],[7,'13:20','14:10',0],[8,'14:10','15:00',0]
  ];
  for (const s of slots)
    await run(`INSERT INTO time_slots (slot_number,start_time,end_time,is_break) VALUES ($1,$2,$3,$4)`, s);
}

module.exports = { query, queryOne, run, initializeDatabase };
