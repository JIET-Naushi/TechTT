# TechTT — Department of Technology Timetable System

A full-stack college timetable management system for B.Tech I, II & III Year students.

## Features

- **Class-wise Timetable** — View weekly schedule for any year & section
- **Faculty-wise Timetable** — View teaching schedule for any faculty member
- **Location-wise Timetable** — View room/lab occupancy schedule
- **Admin Panel** — Full CRUD for faculty, subjects, rooms, sections
- **Auto-Generate** — Smart timetable generation with conflict detection
- **Manual Editor** — Click any cell to edit subject/faculty/room
- **Print Support** — Print any timetable view

## Schedule

| Period | Time |
|--------|------|
| Period 1 | 8:00 AM – 9:00 AM |
| Period 2 | 9:00 AM – 9:50 AM |
| Period 3 | 9:50 AM – 10:40 AM |
| Period 4 | 10:40 AM – 11:30 AM |
| **Lunch** | **11:30 AM – 12:30 PM** |
| Period 5 | 12:30 PM – 1:20 PM |
| Period 6 | 1:20 PM – 2:10 PM |
| Period 7 | 2:10 PM – 3:00 PM |

## Tech Stack

- **Backend:** Node.js, Express, better-sqlite3
- **Frontend:** Vanilla HTML/CSS/JS
- **Database:** SQLite

## Getting Started

```bash
npm install
node server.js
```

Open [http://localhost:3000](http://localhost:3000)

**Admin login:** `admin` / `admin123`

## Department Info

- 25 Teaching Faculty + 2 HODs (Mentor & Admin)
- B.Tech I, II, III Year — Sections A, B, C
- 24 Subjects across all years
- 17 Rooms & Labs
