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

  // Settings table (department name, etc.)
  await run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // Google OAuth users table (email-based, multi-account)
  await run(`
    CREATE TABLE IF NOT EXISTS oauth_users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      picture TEXT,
      role TEXT NOT NULL DEFAULT 'admin',
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

  // Ensure default settings exist
  await run(`INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
    ['department_name', 'Department of Technology']);
  await run(`INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
    ['college_name', 'JIET Universe']);
}

async function seedDatabase() {
  // ── Seeded from live Neon DB ──────────────────────────────────────────────

  // Users
  await run('INSERT INTO users (username,password,role) VALUES ($1,$2,$3)', ["admin","admin123","admin"]);

  // Years
  await run('INSERT INTO years (name,display_name) VALUES ($1,$2)', ["year1","B.Tech I Year"]);
  await run('INSERT INTO years (name,display_name) VALUES ($1,$2)', ["year2","B.Tech II Year"]);
  await run('INSERT INTO years (name,display_name) VALUES ($1,$2)', ["year3","B.Tech III Year"]);

  // Sections
  await run('INSERT INTO sections (year_id,name) VALUES ($1,$2)', [1,"A"]);
  await run('INSERT INTO sections (year_id,name) VALUES ($1,$2)', [1,"B"]);
  await run('INSERT INTO sections (year_id,name) VALUES ($1,$2)', [1,"C"]);
  await run('INSERT INTO sections (year_id,name) VALUES ($1,$2)', [2,"E"]);
  await run('INSERT INTO sections (year_id,name) VALUES ($1,$2)', [2,"F"]);
  await run('INSERT INTO sections (year_id,name) VALUES ($1,$2)', [2,"G"]);
  await run('INSERT INTO sections (year_id,name) VALUES ($1,$2)', [3,"E"]);
  await run('INSERT INTO sections (year_id,name) VALUES ($1,$2)', [3,"F"]);
  await run('INSERT INTO sections (year_id,name) VALUES ($1,$2)', [3,"G"]);
  await run('INSERT INTO sections (year_id,name) VALUES ($1,$2)', [3,"H"]);

  // Subjects
  await run('INSERT INTO subjects (year_id,name,code,type,credits,hours_per_week) VALUES ($1,$2,$3,$4,$5,$6)', [1,"Engineering Mathematics-I","MA101","theory",4,4]);
  await run('INSERT INTO subjects (year_id,name,code,type,credits,hours_per_week) VALUES ($1,$2,$3,$4,$5,$6)', [1,"Engineering Physics","PH101","theory",3,3]);
  await run('INSERT INTO subjects (year_id,name,code,type,credits,hours_per_week) VALUES ($1,$2,$3,$4,$5,$6)', [1,"Engineering Chemistry","CH101","theory",3,3]);
  await run('INSERT INTO subjects (year_id,name,code,type,credits,hours_per_week) VALUES ($1,$2,$3,$4,$5,$6)', [1,"Basic Electronic Engineering","EE101","theory",3,3]);
  await run('INSERT INTO subjects (year_id,name,code,type,credits,hours_per_week) VALUES ($1,$2,$3,$4,$5,$6)', [1,"Programming in C","CS101","theory",3,3]);
  await run('INSERT INTO subjects (year_id,name,code,type,credits,hours_per_week) VALUES ($1,$2,$3,$4,$5,$6)', [1,"Engineering Drawing","ME101","lab",2,2]);
  await run('INSERT INTO subjects (year_id,name,code,type,credits,hours_per_week) VALUES ($1,$2,$3,$4,$5,$6)', [1,"English Communication","EN101","theory",2,2]);
  await run('INSERT INTO subjects (year_id,name,code,type,credits,hours_per_week) VALUES ($1,$2,$3,$4,$5,$6)', [1,"Environmental Science","ES101","theory",2,2]);
  await run('INSERT INTO subjects (year_id,name,code,type,credits,hours_per_week) VALUES ($1,$2,$3,$4,$5,$6)', [2,"Engineering Mathematics-III","MA201","theory",4,4]);
  await run('INSERT INTO subjects (year_id,name,code,type,credits,hours_per_week) VALUES ($1,$2,$3,$4,$5,$6)', [2,"Data Structures","CS201","theory",4,4]);
  await run('INSERT INTO subjects (year_id,name,code,type,credits,hours_per_week) VALUES ($1,$2,$3,$4,$5,$6)', [2,"Digital Electronics","EC201","theory",3,3]);
  await run('INSERT INTO subjects (year_id,name,code,type,credits,hours_per_week) VALUES ($1,$2,$3,$4,$5,$6)', [2,"Object Oriented Programming","CS202","theory",3,3]);
  await run('INSERT INTO subjects (year_id,name,code,type,credits,hours_per_week) VALUES ($1,$2,$3,$4,$5,$6)', [2,"Computer Organization","CS203","theory",3,3]);
  await run('INSERT INTO subjects (year_id,name,code,type,credits,hours_per_week) VALUES ($1,$2,$3,$4,$5,$6)', [2,"Discrete Mathematics","MA202","theory",3,3]);
  await run('INSERT INTO subjects (year_id,name,code,type,credits,hours_per_week) VALUES ($1,$2,$3,$4,$5,$6)', [2,"Database Management Systems","CS204","theory",3,3]);
  await run('INSERT INTO subjects (year_id,name,code,type,credits,hours_per_week) VALUES ($1,$2,$3,$4,$5,$6)', [2,"Operating Systems","CS205","theory",3,3]);
  await run('INSERT INTO subjects (year_id,name,code,type,credits,hours_per_week) VALUES ($1,$2,$3,$4,$5,$6)', [3,"Design and Analysis of Algorithms","CS301","theory",4,4]);
  await run('INSERT INTO subjects (year_id,name,code,type,credits,hours_per_week) VALUES ($1,$2,$3,$4,$5,$6)', [3,"Computer Networks","CS302","theory",3,3]);
  await run('INSERT INTO subjects (year_id,name,code,type,credits,hours_per_week) VALUES ($1,$2,$3,$4,$5,$6)', [3,"Software Engineering","CS303","theory",3,3]);
  await run('INSERT INTO subjects (year_id,name,code,type,credits,hours_per_week) VALUES ($1,$2,$3,$4,$5,$6)', [3,"Compiler Design","CS304","theory",3,3]);
  await run('INSERT INTO subjects (year_id,name,code,type,credits,hours_per_week) VALUES ($1,$2,$3,$4,$5,$6)', [3,"Artificial Intelligence","CS305","theory",3,3]);
  await run('INSERT INTO subjects (year_id,name,code,type,credits,hours_per_week) VALUES ($1,$2,$3,$4,$5,$6)', [3,"Web Technologies","CS306","lab",2,2]);
  await run('INSERT INTO subjects (year_id,name,code,type,credits,hours_per_week) VALUES ($1,$2,$3,$4,$5,$6)', [3,"Machine Learning","CS307","theory",3,3]);
  await run('INSERT INTO subjects (year_id,name,code,type,credits,hours_per_week) VALUES ($1,$2,$3,$4,$5,$6)', [3,"Cloud Computing","CS308","theory",3,3]);

  // Faculty
  await run('INSERT INTO faculty (name,designation,role,email,subjects_can_teach) VALUES ($1,$2,$3,$4,$5)', ["Sunita Godara","Assistant Professor","faculty","","[15,24,19]"]);
  await run('INSERT INTO faculty (name,designation,role,email,subjects_can_teach) VALUES ($1,$2,$3,$4,$5)', ["Nausheen Khilji","Assistant Professor","faculty","","[13,24,22]"]);
  await run('INSERT INTO faculty (name,designation,role,email,subjects_can_teach) VALUES ($1,$2,$3,$4,$5)', ["Dr. Ashish Sharma","Professor","faculty","","[10,12,20,17]"]);
  await run('INSERT INTO faculty (name,designation,role,email,subjects_can_teach) VALUES ($1,$2,$3,$4,$5)', ["Hemant Jain","Assistant Professor","faculty","","[18]"]);
  await run('INSERT INTO faculty (name,designation,role,email,subjects_can_teach) VALUES ($1,$2,$3,$4,$5)', ["Anil Raghav","Assistant Professor","faculty","","[11]"]);
  await run('INSERT INTO faculty (name,designation,role,email,subjects_can_teach) VALUES ($1,$2,$3,$4,$5)', ["Pawan Gupta","Assistant Professor","faculty","","[6]"]);
  await run('INSERT INTO faculty (name,designation,role,email,subjects_can_teach) VALUES ($1,$2,$3,$4,$5)', ["Arshi Riyaz","Assistant Professor","faculty","","[10,20]"]);
  await run('INSERT INTO faculty (name,designation,role,email,subjects_can_teach) VALUES ($1,$2,$3,$4,$5)', ["Dr. Chetan Jalendra","Assistant Professor","faculty","","[21]"]);
  await run('INSERT INTO faculty (name,designation,role,email,subjects_can_teach) VALUES ($1,$2,$3,$4,$5)', ["Dr. Bhuvnesh Rathore","Professor","faculty","","[23]"]);
  await run('INSERT INTO faculty (name,designation,role,email,subjects_can_teach) VALUES ($1,$2,$3,$4,$5)', ["Shweta Solanki","Assistant Professor","faculty","","[15,19]"]);
  await run('INSERT INTO faculty (name,designation,role,email,subjects_can_teach) VALUES ($1,$2,$3,$4,$5)', ["Vidushi Gupta","Assistant Professor","faculty","","[7]"]);
  await run('INSERT INTO faculty (name,designation,role,email,subjects_can_teach) VALUES ($1,$2,$3,$4,$5)', ["Lakshita Singh","Assistant Professor","faculty","","[11]"]);
  await run('INSERT INTO faculty (name,designation,role,email,subjects_can_teach) VALUES ($1,$2,$3,$4,$5)', ["Lalita Mistry","Assistant Professor","faculty","","[1]"]);
  await run('INSERT INTO faculty (name,designation,role,email,subjects_can_teach) VALUES ($1,$2,$3,$4,$5)', ["Dr. Rajendra Kachhwaha","Professor","faculty","","[16]"]);
  await run('INSERT INTO faculty (name,designation,role,email,subjects_can_teach) VALUES ($1,$2,$3,$4,$5)', ["Khushboo Parashar","Assistant Professor","faculty","","[16,21]"]);
  await run('INSERT INTO faculty (name,designation,role,email,subjects_can_teach) VALUES ($1,$2,$3,$4,$5)', ["Dr. Sushmana Sharma","Professor","faculty","","[2]"]);
  await run('INSERT INTO faculty (name,designation,role,email,subjects_can_teach) VALUES ($1,$2,$3,$4,$5)', ["Renu Purohit","Assistant Professor","faculty","","[4]"]);
  await run('INSERT INTO faculty (name,designation,role,email,subjects_can_teach) VALUES ($1,$2,$3,$4,$5)', ["Dr. Kamlesh Bhandari","Professor","faculty","","[1,9]"]);
  await run('INSERT INTO faculty (name,designation,role,email,subjects_can_teach) VALUES ($1,$2,$3,$4,$5)', ["Dr. Rajni Bora","Professor","faculty","","[8]"]);
  await run('INSERT INTO faculty (name,designation,role,email,subjects_can_teach) VALUES ($1,$2,$3,$4,$5)', ["Sushma Dave","Assistant Professor","faculty","","[3]"]);
  await run('INSERT INTO faculty (name,designation,role,email,subjects_can_teach) VALUES ($1,$2,$3,$4,$5)', ["Rajshri Jodha","Assistant Professor","faculty","","[13]"]);
  await run('INSERT INTO faculty (name,designation,role,email,subjects_can_teach) VALUES ($1,$2,$3,$4,$5)', ["Vinay Mathur","Assistant Professor","faculty","","[5]"]);
  await run('INSERT INTO faculty (name,designation,role,email,subjects_can_teach) VALUES ($1,$2,$3,$4,$5)', ["Nakul Bohra","Assistant Professor","faculty","","[5,10]"]);
  await run('INSERT INTO faculty (name,designation,role,email,subjects_can_teach) VALUES ($1,$2,$3,$4,$5)', ["Dr. A M Khan","Professor","faculty","","[1]"]);
  await run('INSERT INTO faculty (name,designation,role,email,subjects_can_teach) VALUES ($1,$2,$3,$4,$5)', ["Dr. Pooja Rakhecha","Professor","faculty","","[7]"]);
  await run('INSERT INTO faculty (name,designation,role,email,subjects_can_teach) VALUES ($1,$2,$3,$4,$5)', ["Dr. Pratibha Peshwa Swami","Professor","hod_mentor","","[15,19]"]);
  await run('INSERT INTO faculty (name,designation,role,email,subjects_can_teach) VALUES ($1,$2,$3,$4,$5)', ["Dr. Chandershekhar Singh","Professor","hod_admin","","[21,23]"]);
  await run('INSERT INTO faculty (name,designation,role,email,subjects_can_teach) VALUES ($1,$2,$3,$4,$5)', ["Krishan Pal Singh","Assistant Professor","faculty","","[12]"]);
  await run('INSERT INTO faculty (name,designation,role,email,subjects_can_teach) VALUES ($1,$2,$3,$4,$5)', ["Ehtesham Pathan","Assistant Professor","faculty","","[5,10,12,22]"]);

  // Rooms
  await run('INSERT INTO rooms (name,type,capacity) VALUES ($1,$2,$3)', ["LT9","classroom",60]);
  await run('INSERT INTO rooms (name,type,capacity) VALUES ($1,$2,$3)', ["LT10","classroom",60]);
  await run('INSERT INTO rooms (name,type,capacity) VALUES ($1,$2,$3)', ["LT11","classroom",60]);
  await run('INSERT INTO rooms (name,type,capacity) VALUES ($1,$2,$3)', ["LT12","classroom",60]);
  await run('INSERT INTO rooms (name,type,capacity) VALUES ($1,$2,$3)', ["LT13","classroom",60]);
  await run('INSERT INTO rooms (name,type,capacity) VALUES ($1,$2,$3)', ["LT14","classroom",60]);
  await run('INSERT INTO rooms (name,type,capacity) VALUES ($1,$2,$3)', ["LTN3","classroom",60]);
  await run('INSERT INTO rooms (name,type,capacity) VALUES ($1,$2,$3)', ["LTN4","classroom",60]);
  await run('INSERT INTO rooms (name,type,capacity) VALUES ($1,$2,$3)', ["LTN5","classroom",60]);
  await run('INSERT INTO rooms (name,type,capacity) VALUES ($1,$2,$3)', ["Lab2","lab",24]);
  await run('INSERT INTO rooms (name,type,capacity) VALUES ($1,$2,$3)', ["Lab3","lab",24]);
  await run('INSERT INTO rooms (name,type,capacity) VALUES ($1,$2,$3)', ["Lab4","lab",24]);
  await run('INSERT INTO rooms (name,type,capacity) VALUES ($1,$2,$3)', ["Lab6","lab",24]);
  await run('INSERT INTO rooms (name,type,capacity) VALUES ($1,$2,$3)', ["Lab1","lab",24]);
  await run('INSERT INTO rooms (name,type,capacity) VALUES ($1,$2,$3)', ["Lab5","lab",24]);
  await run('INSERT INTO rooms (name,type,capacity) VALUES ($1,$2,$3)', ["Seminar Hall","seminar",150]);
  await run('INSERT INTO rooms (name,type,capacity) VALUES ($1,$2,$3)', ["Tech Conference Room","conference",100]);
  await run('INSERT INTO rooms (name,type,capacity) VALUES ($1,$2,$3)', ["LT33","classroom",60]);
  await run('INSERT INTO rooms (name,type,capacity) VALUES ($1,$2,$3)', ["LT34","classroom",60]);
  await run('INSERT INTO rooms (name,type,capacity) VALUES ($1,$2,$3)', ["LT35","classroom",60]);
  await run('INSERT INTO rooms (name,type,capacity) VALUES ($1,$2,$3)', ["Lab7","lab",24]);
  await run('INSERT INTO rooms (name,type,capacity) VALUES ($1,$2,$3)', ["Lab8","lab",24]);
  await run('INSERT INTO rooms (name,type,capacity) VALUES ($1,$2,$3)', ["Lab9","lab",24]);

  // Time Slots
  await run('INSERT INTO time_slots (slot_number,start_time,end_time,is_break) VALUES ($1,$2,$3,$4)', [1,"08:00","09:00",0]);
  await run('INSERT INTO time_slots (slot_number,start_time,end_time,is_break) VALUES ($1,$2,$3,$4)', [2,"09:00","09:50",0]);
  await run('INSERT INTO time_slots (slot_number,start_time,end_time,is_break) VALUES ($1,$2,$3,$4)', [3,"09:50","10:40",0]);
  await run('INSERT INTO time_slots (slot_number,start_time,end_time,is_break) VALUES ($1,$2,$3,$4)', [4,"10:40","11:30",0]);
  await run('INSERT INTO time_slots (slot_number,start_time,end_time,is_break) VALUES ($1,$2,$3,$4)', [5,"11:30","12:30",1]);
  await run('INSERT INTO time_slots (slot_number,start_time,end_time,is_break) VALUES ($1,$2,$3,$4)', [6,"12:30","13:20",0]);
  await run('INSERT INTO time_slots (slot_number,start_time,end_time,is_break) VALUES ($1,$2,$3,$4)', [7,"13:20","14:10",0]);
  await run('INSERT INTO time_slots (slot_number,start_time,end_time,is_break) VALUES ($1,$2,$3,$4)', [8,"14:10","15:00",0]);
}

module.exports = { query, queryOne, run, initializeDatabase };
