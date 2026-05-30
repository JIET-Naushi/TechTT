const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'timetable.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function initializeDatabase() {
  const db = getDb();

  // Create tables
  db.exec(`
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

  // Seed data if empty
  const userCount = db.prepare('SELECT COUNT(*) as cnt FROM users').get();
  if (userCount.cnt === 0) {
    seedDatabase(db);
  }

  return db;
}

function seedDatabase(db) {
  // Insert admin user
  db.prepare(`INSERT INTO users (username, password, role) VALUES (?, ?, ?)`).run('admin', 'admin123', 'admin');

  // Insert years
  const years = [
    { name: 'year1', display_name: 'B.Tech I Year' },
    { name: 'year2', display_name: 'B.Tech II Year' },
    { name: 'year3', display_name: 'B.Tech III Year' }
  ];
  const insertYear = db.prepare(`INSERT INTO years (name, display_name) VALUES (?, ?)`);
  for (const y of years) {
    insertYear.run(y.name, y.display_name);
  }

  // Insert sections A, B, C for each year
  const insertSection = db.prepare(`INSERT INTO sections (year_id, name) VALUES (?, ?)`);
  for (let yearId = 1; yearId <= 3; yearId++) {
    for (const sec of ['A', 'B', 'C']) {
      insertSection.run(yearId, sec);
    }
  }

  // Insert subjects
  const subjectsData = [
    // Year 1
    { year_id: 1, name: 'Engineering Mathematics-I', code: 'MA101', type: 'theory', credits: 4, hours_per_week: 4 },
    { year_id: 1, name: 'Engineering Physics', code: 'PH101', type: 'theory', credits: 3, hours_per_week: 3 },
    { year_id: 1, name: 'Engineering Chemistry', code: 'CH101', type: 'theory', credits: 3, hours_per_week: 3 },
    { year_id: 1, name: 'Basic Electrical Engineering', code: 'EE101', type: 'theory', credits: 3, hours_per_week: 3 },
    { year_id: 1, name: 'Programming in C', code: 'CS101', type: 'theory', credits: 3, hours_per_week: 3 },
    { year_id: 1, name: 'Engineering Drawing', code: 'ME101', type: 'lab', credits: 2, hours_per_week: 2 },
    { year_id: 1, name: 'English Communication', code: 'EN101', type: 'theory', credits: 2, hours_per_week: 2 },
    { year_id: 1, name: 'Environmental Science', code: 'ES101', type: 'theory', credits: 2, hours_per_week: 2 },
    // Year 2
    { year_id: 2, name: 'Engineering Mathematics-III', code: 'MA201', type: 'theory', credits: 4, hours_per_week: 4 },
    { year_id: 2, name: 'Data Structures', code: 'CS201', type: 'theory', credits: 4, hours_per_week: 4 },
    { year_id: 2, name: 'Digital Electronics', code: 'EC201', type: 'theory', credits: 3, hours_per_week: 3 },
    { year_id: 2, name: 'Object Oriented Programming', code: 'CS202', type: 'theory', credits: 3, hours_per_week: 3 },
    { year_id: 2, name: 'Computer Organization', code: 'CS203', type: 'theory', credits: 3, hours_per_week: 3 },
    { year_id: 2, name: 'Discrete Mathematics', code: 'MA202', type: 'theory', credits: 3, hours_per_week: 3 },
    { year_id: 2, name: 'Database Management Systems', code: 'CS204', type: 'theory', credits: 3, hours_per_week: 3 },
    { year_id: 2, name: 'Operating Systems', code: 'CS205', type: 'theory', credits: 3, hours_per_week: 3 },
    // Year 3
    { year_id: 3, name: 'Design and Analysis of Algorithms', code: 'CS301', type: 'theory', credits: 4, hours_per_week: 4 },
    { year_id: 3, name: 'Computer Networks', code: 'CS302', type: 'theory', credits: 3, hours_per_week: 3 },
    { year_id: 3, name: 'Software Engineering', code: 'CS303', type: 'theory', credits: 3, hours_per_week: 3 },
    { year_id: 3, name: 'Compiler Design', code: 'CS304', type: 'theory', credits: 3, hours_per_week: 3 },
    { year_id: 3, name: 'Artificial Intelligence', code: 'CS305', type: 'theory', credits: 3, hours_per_week: 3 },
    { year_id: 3, name: 'Web Technologies', code: 'CS306', type: 'lab', credits: 2, hours_per_week: 2 },
    { year_id: 3, name: 'Machine Learning', code: 'CS307', type: 'theory', credits: 3, hours_per_week: 3 },
    { year_id: 3, name: 'Cloud Computing', code: 'CS308', type: 'theory', credits: 3, hours_per_week: 3 }
  ];
  const insertSubject = db.prepare(`INSERT INTO subjects (year_id, name, code, type, credits, hours_per_week) VALUES (?, ?, ?, ?, ?, ?)`);
  for (const s of subjectsData) {
    insertSubject.run(s.year_id, s.name, s.code, s.type, s.credits, s.hours_per_week);
  }

  // Insert faculty
  const facultyData = [
    { name: 'Dr. Rajesh Kumar', designation: 'Professor', role: 'faculty' },
    { name: 'Dr. Priya Sharma', designation: 'Professor', role: 'faculty' },
    { name: 'Dr. Amit Singh', designation: 'Associate Professor', role: 'faculty' },
    { name: 'Dr. Sunita Patel', designation: 'Associate Professor', role: 'faculty' },
    { name: 'Dr. Vikram Rao', designation: 'Professor', role: 'faculty' },
    { name: 'Dr. Meena Joshi', designation: 'Associate Professor', role: 'faculty' },
    { name: 'Dr. Suresh Nair', designation: 'Professor', role: 'faculty' },
    { name: 'Dr. Kavitha Reddy', designation: 'Associate Professor', role: 'faculty' },
    { name: 'Dr. Arun Mehta', designation: 'Associate Professor', role: 'faculty' },
    { name: 'Dr. Pooja Gupta', designation: 'Assistant Professor', role: 'faculty' },
    { name: 'Prof. Ravi Tiwari', designation: 'Assistant Professor', role: 'faculty' },
    { name: 'Prof. Anita Desai', designation: 'Assistant Professor', role: 'faculty' },
    { name: 'Prof. Manoj Verma', designation: 'Assistant Professor', role: 'faculty' },
    { name: 'Prof. Shalini Mishra', designation: 'Assistant Professor', role: 'faculty' },
    { name: 'Prof. Deepak Jain', designation: 'Assistant Professor', role: 'faculty' },
    { name: 'Prof. Rekha Pillai', designation: 'Assistant Professor', role: 'faculty' },
    { name: 'Prof. Sanjay Bhatt', designation: 'Assistant Professor', role: 'faculty' },
    { name: 'Prof. Nisha Agarwal', designation: 'Assistant Professor', role: 'faculty' },
    { name: 'Prof. Kiran Yadav', designation: 'Assistant Professor', role: 'faculty' },
    { name: 'Prof. Rohit Saxena', designation: 'Assistant Professor', role: 'faculty' },
    { name: 'Prof. Divya Nair', designation: 'Assistant Professor', role: 'faculty' },
    { name: 'Prof. Sunil Patil', designation: 'Assistant Professor', role: 'faculty' },
    { name: 'Prof. Geeta Sharma', designation: 'Assistant Professor', role: 'faculty' },
    { name: 'Prof. Harish Chandra', designation: 'Assistant Professor', role: 'faculty' },
    { name: 'Prof. Lalitha Devi', designation: 'Assistant Professor', role: 'faculty' },
    { name: 'Dr. Venkat Raman', designation: 'Professor', role: 'hod_mentor' },
    { name: 'Dr. Savitha Krishnan', designation: 'Professor', role: 'hod_admin' }
  ];

  // Assign subjects to faculty (distribute subjects among faculty)
  // All 24 subjects, 25 teaching faculty
  const allSubjectIds = Array.from({ length: 24 }, (_, i) => i + 1);
  const insertFaculty = db.prepare(`INSERT INTO faculty (name, designation, role, subjects_can_teach) VALUES (?, ?, ?, ?)`);

  for (let i = 0; i < facultyData.length; i++) {
    const f = facultyData[i];
    let subjectsCanTeach = [];
    if (f.role === 'faculty') {
      // Each faculty gets ~3-4 subjects, cycling through all subjects
      const startIdx = (i * 3) % allSubjectIds.length;
      for (let j = 0; j < 3; j++) {
        subjectsCanTeach.push(allSubjectIds[(startIdx + j) % allSubjectIds.length]);
      }
    }
    insertFaculty.run(f.name, f.designation, f.role, JSON.stringify(subjectsCanTeach));
  }

  // Insert rooms
  const roomsData = [
    { name: 'Room 101', type: 'classroom', capacity: 60 },
    { name: 'Room 102', type: 'classroom', capacity: 60 },
    { name: 'Room 103', type: 'classroom', capacity: 60 },
    { name: 'Room 104', type: 'classroom', capacity: 60 },
    { name: 'Room 105', type: 'classroom', capacity: 60 },
    { name: 'Room 106', type: 'classroom', capacity: 60 },
    { name: 'Room 107', type: 'classroom', capacity: 60 },
    { name: 'Room 108', type: 'classroom', capacity: 60 },
    { name: 'Room 109', type: 'classroom', capacity: 60 },
    { name: 'Computer Lab 1', type: 'lab', capacity: 40 },
    { name: 'Computer Lab 2', type: 'lab', capacity: 40 },
    { name: 'Computer Lab 3', type: 'lab', capacity: 40 },
    { name: 'Physics Lab', type: 'lab', capacity: 30 },
    { name: 'Chemistry Lab', type: 'lab', capacity: 30 },
    { name: 'Electronics Lab', type: 'lab', capacity: 30 },
    { name: 'Seminar Hall', type: 'seminar', capacity: 150 },
    { name: 'Conference Room', type: 'conference', capacity: 30 }
  ];
  const insertRoom = db.prepare(`INSERT INTO rooms (name, type, capacity) VALUES (?, ?, ?)`);
  for (const r of roomsData) {
    insertRoom.run(r.name, r.type, r.capacity);
  }

  // Insert time slots
  const timeSlots = [
    { slot_number: 1, start_time: '08:00', end_time: '09:00', is_break: 0 },
    { slot_number: 2, start_time: '09:00', end_time: '09:50', is_break: 0 },
    { slot_number: 3, start_time: '09:50', end_time: '10:40', is_break: 0 },
    { slot_number: 4, start_time: '10:40', end_time: '11:30', is_break: 0 },
    { slot_number: 5, start_time: '11:30', end_time: '12:30', is_break: 1 },
    { slot_number: 6, start_time: '12:30', end_time: '13:20', is_break: 0 },
    { slot_number: 7, start_time: '13:20', end_time: '14:10', is_break: 0 },
    { slot_number: 8, start_time: '14:10', end_time: '15:00', is_break: 0 }
  ];
  const insertSlot = db.prepare(`INSERT INTO time_slots (slot_number, start_time, end_time, is_break) VALUES (?, ?, ?, ?)`);
  for (const ts of timeSlots) {
    insertSlot.run(ts.slot_number, ts.start_time, ts.end_time, ts.is_break);
  }

  console.log('Database seeded successfully.');
}

module.exports = { getDb, initializeDatabase };
