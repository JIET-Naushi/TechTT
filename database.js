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
  // Create departments table FIRST (other tables will reference it)
  await run(`
    CREATE TABLE IF NOT EXISTS departments (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      code TEXT NOT NULL UNIQUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Ensure default department exists (for backward compatibility)
  await run(`
    INSERT INTO departments (id, name, code) 
    VALUES (1, 'Department of Technology', 'TECH')
    ON CONFLICT (id) DO NOTHING
  `);

  // Create all tables with department_id (DEFAULT 1 for backward compatibility)
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin'
    )
  `);

  // Check if years table exists and if it has department_id column
  const yearsTableExists = await queryOne(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_name = 'years'
    ) as exists
  `);

  if (yearsTableExists.exists) {
    // Check if department_id column exists
    const deptIdExists = await queryOne(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'years' AND column_name = 'department_id'
      ) as exists
    `);
    
    if (!deptIdExists.exists) {
      // Add department_id to existing table (backward compatible migration)
      await run(`ALTER TABLE years ADD COLUMN department_id INTEGER DEFAULT 1 REFERENCES departments(id) ON DELETE CASCADE`);
      // Update existing rows to department 1
      await run(`UPDATE years SET department_id = 1 WHERE department_id IS NULL`);
      console.log('✅ Migrated years table: added department_id');
    }
  } else {
    // Create new table with department_id
    await run(`
      CREATE TABLE IF NOT EXISTS years (
        id SERIAL PRIMARY KEY,
        department_id INTEGER DEFAULT 1 REFERENCES departments(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        display_name TEXT NOT NULL
      )
    `);
  }

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

  // Check and migrate faculty table
  const facultyTableExists = await queryOne(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_name = 'faculty'
    ) as exists
  `);

  if (facultyTableExists.exists) {
    const deptIdExists = await queryOne(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'faculty' AND column_name = 'department_id'
      ) as exists
    `);
    
    if (!deptIdExists.exists) {
      await run(`ALTER TABLE faculty ADD COLUMN department_id INTEGER DEFAULT 1 REFERENCES departments(id) ON DELETE CASCADE`);
      await run(`UPDATE faculty SET department_id = 1 WHERE department_id IS NULL`);
      console.log('✅ Migrated faculty table: added department_id');
    }
  } else {
    await run(`
      CREATE TABLE IF NOT EXISTS faculty (
        id SERIAL PRIMARY KEY,
        department_id INTEGER DEFAULT 1 REFERENCES departments(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        designation TEXT,
        role TEXT DEFAULT 'faculty',
        email TEXT,
        subjects_can_teach TEXT DEFAULT '[]'
      )
    `);
  }

  // Check and migrate rooms table
  const roomsTableExists = await queryOne(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_name = 'rooms'
    ) as exists
  `);

  if (roomsTableExists.exists) {
    const deptIdExists = await queryOne(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'rooms' AND column_name = 'department_id'
      ) as exists
    `);
    
    if (!deptIdExists.exists) {
      await run(`ALTER TABLE rooms ADD COLUMN department_id INTEGER DEFAULT 1 REFERENCES departments(id) ON DELETE CASCADE`);
      await run(`UPDATE rooms SET department_id = 1 WHERE department_id IS NULL`);
      console.log('✅ Migrated rooms table: added department_id');
    }
  } else {
    await run(`
      CREATE TABLE IF NOT EXISTS rooms (
        id SERIAL PRIMARY KEY,
        department_id INTEGER DEFAULT 1 REFERENCES departments(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'classroom',
        capacity INTEGER DEFAULT 60
      )
    `);
  }

  // Check and migrate time_slots table
  const timeSlotsTableExists = await queryOne(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_name = 'time_slots'
    ) as exists
  `);

  if (timeSlotsTableExists.exists) {
    const deptIdExists = await queryOne(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'time_slots' AND column_name = 'department_id'
      ) as exists
    `);
    
    if (!deptIdExists.exists) {
      await run(`ALTER TABLE time_slots ADD COLUMN department_id INTEGER DEFAULT 1 REFERENCES departments(id) ON DELETE CASCADE`);
      await run(`UPDATE time_slots SET department_id = 1 WHERE department_id IS NULL`);
      console.log('✅ Migrated time_slots table: added department_id');
    }
  } else {
    await run(`
      CREATE TABLE IF NOT EXISTS time_slots (
        id SERIAL PRIMARY KEY,
        department_id INTEGER DEFAULT 1 REFERENCES departments(id) ON DELETE CASCADE,
        slot_number INTEGER NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        is_break INTEGER NOT NULL DEFAULT 0
      )
    `);
  }

  await run(`
    CREATE TABLE IF NOT EXISTS timetable_entries (
      id SERIAL PRIMARY KEY,
      section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
      time_slot_id INTEGER NOT NULL REFERENCES time_slots(id),
      day_of_week TEXT NOT NULL,
      subject_id INTEGER REFERENCES subjects(id),
      faculty_id INTEGER REFERENCES faculty(id),
      room_id INTEGER REFERENCES rooms(id),
      subsection TEXT DEFAULT NULL,
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
      role TEXT NOT NULL DEFAULT 'incharge',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Department Incharges — who can login to which department admin
  await run(`
    CREATE TABLE IF NOT EXISTS dept_incharges (
      id SERIAL PRIMARY KEY,
      department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      name TEXT,
      is_active BOOLEAN DEFAULT true,
      added_by TEXT DEFAULT 'super_admin',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(department_id, email)
    )
  `);

  // Add subsection column to timetable_entries if missing (backward compat)
  const ttSubsectionExists = await queryOne(`
    SELECT EXISTS (
      SELECT FROM information_schema.columns 
      WHERE table_name = 'timetable_entries' AND column_name = 'subsection'
    ) as exists
  `);
  if (!ttSubsectionExists.exists) {
    await run(`ALTER TABLE timetable_entries ADD COLUMN subsection TEXT DEFAULT NULL`);
    console.log('✅ Migrated timetable_entries: added subsection column');
  }

  // Add lab_subsections column to sections if missing
  const labSubExists = await queryOne(`
    SELECT EXISTS (
      SELECT FROM information_schema.columns 
      WHERE table_name = 'sections' AND column_name = 'lab_subsections'
    ) as exists
  `);
  if (!labSubExists.exists) {
    await run(`ALTER TABLE sections ADD COLUMN lab_subsections INTEGER DEFAULT 2`);
    console.log('✅ Migrated sections: added lab_subsections column (default 2)');
  }

  // Add subsection_names column to sections if missing (JSON array of batch names)
  const subNamesExists = await queryOne(`
    SELECT EXISTS (
      SELECT FROM information_schema.columns 
      WHERE table_name = 'sections' AND column_name = 'subsection_names'
    ) as exists
  `);
  if (!subNamesExists.exists) {
    await run(`ALTER TABLE sections ADD COLUMN subsection_names TEXT DEFAULT NULL`);
    console.log('✅ Migrated sections: added subsection_names column');
  }

  // Add category column to subjects if missing (regular | btu)
  const subjCategoryExists = await queryOne(`
    SELECT EXISTS (
      SELECT FROM information_schema.columns 
      WHERE table_name = 'subjects' AND column_name = 'category'
    ) as exists
  `);
  if (!subjCategoryExists.exists) {
    await run(`ALTER TABLE subjects ADD COLUMN category TEXT DEFAULT 'regular'`);
    // Mark existing subjects that had type='btu' (from previous attempt) as category='btu', type='theory'
    await run(`UPDATE subjects SET category='btu', type='theory' WHERE type='btu'`);
    console.log('✅ Migrated subjects: added category column (regular/btu)');
  }
  await run(`
    INSERT INTO departments (name, code) 
    VALUES ('Department of Computer Science', 'CS')
    ON CONFLICT (code) DO NOTHING
  `);
  await run(`
    INSERT INTO departments (name, code) 
    VALUES ('Department of Mechanical Engineering', 'MECH')
    ON CONFLICT (code) DO NOTHING
  `);

  // Lab batch-faculty assignments: pre-assign a specific faculty to each batch
  await run(`
    CREATE TABLE IF NOT EXISTS lab_assignments (
      id SERIAL PRIMARY KEY,
      section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
      subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      batch_name TEXT NOT NULL,
      faculty_id INTEGER REFERENCES faculty(id) ON DELETE SET NULL,
      UNIQUE(section_id, subject_id, batch_name)
    )
  `);

  // Password reset tokens for super admin forgot-password flow
  await run(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMP NOT NULL,
      used BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Seed only on first run
  const userCount = await queryOne('SELECT COUNT(*) as cnt FROM users');
  const deptCount = await queryOne('SELECT COUNT(*) as cnt FROM departments');

  if (parseInt(userCount.cnt) === 0) {
    await seedDatabase();
    console.log('Database seeded successfully with Department of Technology data.');
  }

  // Ensure default settings exist  
  await run(`INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
    ['college_name', 'JIET Universe']);
  
  console.log(`✅ Multi-department system ready. ${parseInt((await queryOne('SELECT COUNT(*) as cnt FROM departments')).cnt)} departments available.`);
}

async function seedDatabase() {
  // ── Seed Department of Technology (department_id = 1, already exists) ─────

  // Users (shared across all departments)
  await run('INSERT INTO users (username,password,role) VALUES ($1,$2,$3)', 
    ["admin","admin123","admin"]);

  // Years for TECH (department_id defaults to 1)
  await run('INSERT INTO years (department_id,name,display_name) VALUES ($1,$2,$3)', 
    [1,"year1","B.Tech I Year"]);
  await run('INSERT INTO years (department_id,name,display_name) VALUES ($1,$2,$3)', 
    [1,"year2","B.Tech II Year"]);
  await run('INSERT INTO years (department_id,name,display_name) VALUES ($1,$2,$3)', 
    [1,"year3","B.Tech III Year"]);

  // Sections for TECH (year_ids 1,2,3)
  const sectionsData = [
    [1,"A"], [1,"B"], [1,"C"],
    [2,"E"], [2,"F"], [2,"G"],
    [3,"E"], [3,"F"], [3,"G"], [3,"H"]
  ];
  for (const [year_id, name] of sectionsData) {
    await run('INSERT INTO sections (year_id,name) VALUES ($1,$2)', [year_id, name]);
  }

  // Subjects for TECH (keep year_id references - they now point to TECH department years)
  const subjectsData = [
    [1,"Engineering Mathematics-I","MA101","theory",4,4],
    [1,"Engineering Physics","PH101","theory",3,3],
    [1,"Engineering Chemistry","CH101","theory",3,3],
    [1,"Basic Electronic Engineering","EE101","theory",3,3],
    [1,"Programming in C","CS101","theory",3,3],
    [1,"Engineering Drawing","ME101","lab",2,2],
    [1,"English Communication","EN101","theory",2,2],
    [1,"Environmental Science","ES101","theory",2,2],
    [2,"Engineering Mathematics-III","MA201","theory",4,4],
    [2,"Data Structures","CS201","theory",4,4],
    [2,"Digital Electronics","EC201","theory",3,3],
    [2,"Object Oriented Programming","CS202","theory",3,3],
    [2,"Computer Organization","CS203","theory",3,3],
    [2,"Discrete Mathematics","MA202","theory",3,3],
    [2,"Database Management Systems","CS204","theory",3,3],
    [2,"Operating Systems","CS205","theory",3,3],
    [3,"Design and Analysis of Algorithms","CS301","theory",4,4],
    [3,"Computer Networks","CS302","theory",3,3],
    [3,"Software Engineering","CS303","theory",3,3],
    [3,"Compiler Design","CS304","theory",3,3],
    [3,"Artificial Intelligence","CS305","theory",3,3],
    [3,"Web Technologies","CS306","lab",2,2],
    [3,"Machine Learning","CS307","theory",3,3],
    [3,"Cloud Computing","CS308","theory",3,3]
  ];
  for (const [year_id, name, code, type, credits, hours] of subjectsData) {
    await run('INSERT INTO subjects (year_id,name,code,type,credits,hours_per_week) VALUES ($1,$2,$3,$4,$5,$6)',
      [year_id, name, code, type, credits, hours]);
  }

  // Faculty for TECH (department_id = 1)
  const facultyData = [
    ["Sunita Godara","Assistant Professor","faculty","","[15,24,19]"],
    ["Nausheen Khilji","Assistant Professor","faculty","","[13,24,22]"],
    ["Dr. Ashish Sharma","Professor","faculty","","[10,12,20,17]"],
    ["Hemant Jain","Assistant Professor","faculty","","[18]"],
    ["Anil Raghav","Assistant Professor","faculty","","[11]"],
    ["Pawan Gupta","Assistant Professor","faculty","","[6]"],
    ["Arshi Riyaz","Assistant Professor","faculty","","[10,20]"],
    ["Dr. Chetan Jalendra","Assistant Professor","faculty","","[21]"],
    ["Dr. Bhuvnesh Rathore","Professor","faculty","","[23]"],
    ["Shweta Solanki","Assistant Professor","faculty","","[15,19]"],
    ["Vidushi Gupta","Assistant Professor","faculty","","[7]"],
    ["Lakshita Singh","Assistant Professor","faculty","","[11]"],
    ["Lalita Mistry","Assistant Professor","faculty","","[1]"],
    ["Dr. Rajendra Kachhwaha","Professor","faculty","","[16]"],
    ["Khushboo Parashar","Assistant Professor","faculty","","[16,21]"],
    ["Dr. Sushmana Sharma","Professor","faculty","","[2]"],
    ["Renu Purohit","Assistant Professor","faculty","","[4]"],
    ["Dr. Kamlesh Bhandari","Professor","faculty","","[1,9]"],
    ["Dr. Rajni Bora","Professor","faculty","","[8]"],
    ["Sushma Dave","Assistant Professor","faculty","","[3]"],
    ["Rajshri Jodha","Assistant Professor","faculty","","[13]"],
    ["Vinay Mathur","Assistant Professor","faculty","","[5]"],
    ["Nakul Bohra","Assistant Professor","faculty","","[5,10]"],
    ["Dr. A M Khan","Professor","faculty","","[1]"],
    ["Dr. Pooja Rakhecha","Professor","faculty","","[7]"],
    ["Dr. Pratibha Peshwa Swami","Professor","hod_mentor","","[15,19]"],
    ["Dr. Chandershekhar Singh","Professor","hod_admin","","[21,23]"],
    ["Krishan Pal Singh","Assistant Professor","faculty","","[12]"],
    ["Ehtesham Pathan","Assistant Professor","faculty","","[5,10,12,22]"]
  ];
  for (const [name, designation, role, email, subjects] of facultyData) {
    await run('INSERT INTO faculty (department_id,name,designation,role,email,subjects_can_teach) VALUES ($1,$2,$3,$4,$5,$6)',
      [1, name, designation, role, email, subjects]);
  }

  // Rooms for TECH (department_id = 1)
  const roomsData = [
    ["LT9","classroom",60], ["LT10","classroom",60], ["LT11","classroom",60],
    ["LT12","classroom",60], ["LT13","classroom",60], ["LT14","classroom",60],
    ["LTN3","classroom",60], ["LTN4","classroom",60], ["LTN5","classroom",60],
    ["Lab2","lab",24], ["Lab3","lab",24], ["Lab4","lab",24],
    ["Lab6","lab",24], ["Lab1","lab",24], ["Lab5","lab",24],
    ["Seminar Hall","seminar",150], ["Tech Conference Room","conference",100],
    ["LT33","classroom",60], ["LT34","classroom",60], ["LT35","classroom",60],
    ["Lab7","lab",24], ["Lab8","lab",24], ["Lab9","lab",24]
  ];
  for (const [name, type, capacity] of roomsData) {
    await run('INSERT INTO rooms (department_id,name,type,capacity) VALUES ($1,$2,$3,$4)',
      [1, name, type, capacity]);
  }

  // Time Slots for TECH (department_id = 1)
  const timeSlotsData = [
    [1,"08:00","09:00",0], [2,"09:00","09:50",0], [3,"09:50","10:40",0],
    [4,"10:40","11:30",0], [5,"11:30","12:30",1], [6,"12:30","13:20",0],
    [7,"13:20","14:10",0], [8,"14:10","15:00",0]
  ];
  for (const [slot, start, end, is_break] of timeSlotsData) {
    await run('INSERT INTO time_slots (department_id,slot_number,start_time,end_time,is_break) VALUES ($1,$2,$3,$4,$5)',
      [1, slot, start, end, is_break]);
  }

  console.log('✅ Seeded: Department of Technology with full data');
}

module.exports = { query, queryOne, run, initializeDatabase };
