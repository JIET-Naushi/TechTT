# JIET Universe Timetable

A full-stack college timetable management system for JIET — covering B.Tech I, II & III Year across multiple departments.

## Features

### Views (Public)
- **Class Timetable** — Weekly schedule for any year & section, with lab batch display
- **Faculty Timetable** — Full teaching schedule for any faculty member
- **Location Timetable** — Room/lab occupancy across the week
- **Excel Export** — Download any timetable as `.xlsx`
- **Print Support** — Print-optimized layout for any view

### Admin Panel
- **Google OAuth + Password Login** — Sign in with Google or `admin / admin123`
- **Multi-Department Support** — Super admin manages multiple departments; each dept has its own incharge
- **Years & Sections** — Add/rename sections, configure lab batch count and names
- **Subjects** — CRUD with type (theory/lab), category (regular/B.T.U.), credits, hours/week
- **Faculty** — Assign subjects each faculty can teach
- **Rooms** — Classrooms and labs with capacity
- **Lab Faculty Assignment** — Pre-assign specific faculty to each lab batch per section
- **Auto-Generate** — Smart timetable generation algorithm
- **Manual Editor** — Click any cell to edit; lab batch cells are fully editable inline
- **Conflicts Page** — Detect and review faculty/room double-bookings

---

## Scheduling Algorithm

### Lab Subjects
- Each **batch** (A, B, C…) gets its **own separate consecutive time window** — they are staggered, not parallel
- One faculty teaches **only one batch** of each lab subject — no faculty is assigned to multiple batches of the same lab
- Same faculty and same lab room are used across all consecutive slots of that batch
- Consecutive slots never straddle the lunch break
- Pre-assigned faculty (set via Lab Faculty Assignment) take priority; unassigned batches auto-fill

### Theory / B.T.U. Subjects
- **B.T.U. (Bikaner Technical University)** subjects are scheduled **only for BTU sections** — sections whose name contains "BTU" (e.g., "Section BTU", "BTU-A", or "A-BTU")
- Non-BTU sections receive only regular (non-BTU) theory subjects
- Maximum **6 theory subjects total** are scheduled per section (highest-credit subjects prioritized)
- Subjects spread evenly across Mon–Sat; no subject appears twice on the same day
- Faculty assigned from their "subjects can teach" list; rooms prefer the section's dedicated classroom

### Conflict Avoidance
- No faculty or room is double-booked at any point
- Faculty workload is balanced across available slots
- Lab rooms are matched by type; theory uses classrooms

---

## Schedule

| Period | Time |
|--------|------|
| Period 1 | 8:00 – 9:00 |
| Period 2 | 9:00 – 9:50 |
| Period 3 | 9:50 – 10:40 |
| Period 4 | 10:40 – 11:30 |
| **Lunch** | **11:30 – 12:30** |
| Period 5 | 12:30 – 13:20 |
| Period 6 | 13:20 – 14:10 |
| Period 7 | 14:10 – 15:00 |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js, Express |
| Database | PostgreSQL (Neon) |
| Frontend | Vanilla HTML / CSS / JS |
| Auth | JWT + Google OAuth 2.0 |
| Deployment | Vercel |

---

## Getting Started

### Local Development

```bash
npm install
cp .env.template .env
# Fill in .env:
#   POSTGRES_URL  — from Neon dashboard
#   JWT_SECRET    — any strong random string
#   GOOGLE_CLIENT_ID — from Google Cloud Console (optional)
node server.js
```

Open [http://localhost:3000](http://localhost:3000)

Default admin: **admin / admin123**

### Google OAuth Setup (Optional)

1. Go to [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials)
2. Create **OAuth 2.0 Client ID** (Web application)
3. Authorized JavaScript origins:
   - `http://localhost:3000`
   - `https://your-vercel-app.vercel.app`
4. Copy the Client ID → add to `.env` as `GOOGLE_CLIENT_ID`
5. Add the same value to Vercel environment variables

### Vercel Deployment

1. Push repository to GitHub
2. Import in Vercel → set environment variables:
   - `POSTGRES_URL` — from Neon
   - `JWT_SECRET` — `openssl rand -base64 32`
   - `GOOGLE_CLIENT_ID` — optional
3. Deploy — database tables are created automatically on first request

---

## Admin Workflow

### 1. Setup Sections & Lab Batches

```
Admin → Years & Sections
  → Add section (e.g., "A", "B", "BTU", "BTU-A", or "A-BTU")
  → Click ⚙️ on a section to set batch count and names
    e.g., 2 batches named "A" and "B"
```

> To create a BTU section, include "BTU" anywhere in the section name (e.g., "Section BTU", "BTU-A", "A-BTU"). BTU sections will receive BTU theory subjects during auto-generation.

### 2. Assign Lab Faculty (Optional)

```
Admin → Years & Sections
  → Click 🧑‍🔬 Lab Faculty on a section
  → Pick a faculty for each subject × batch combination
```

Pre-assigned faculty are used during generation. Unassigned batches auto-fill.

### 3. Generate Timetable

```
Admin → Generate
  → Select scope: All / By Year / Single Section
  → Click "Generate Timetable"
  → Or "Reset & Regenerate" to clear first
```

### 4. Edit Manually

```
Admin → Editor
  → Select Year + Section → Load
  → Click any theory cell to change subject / faculty / room
  → Click any batch row in a lab cell to change faculty / room
```

### 5. Check Conflicts

```
Admin → Conflicts
  → Click "Scan Now"
  → Filter by type (faculty / room) or day
  → Click "Suggest Fix" for resolution hints
```

---

## File Structure

```
college-timetable/
├── public/
│   ├── admin/
│   │   ├── conflicts.html       — Conflict detection & review
│   │   ├── dashboard.html       — Stats, quick actions, settings
│   │   ├── editor.html          — Manual timetable editor
│   │   ├── faculty.html         — Faculty CRUD
│   │   ├── generate.html        — Auto-generation controls
│   │   ├── incharges.html       — Dept incharge management (super admin)
│   │   ├── rooms.html           — Room CRUD
│   │   ├── sections.html        — Sections + lab batch config
│   │   └── subjects.html        — Subject CRUD
│   ├── views/
│   │   ├── class-timetable.html
│   │   ├── faculty-timetable.html
│   │   └── location-timetable.html
│   ├── css/style.css
│   ├── index.html
│   └── login.html
├── routes/
│   ├── admin.js                 — All admin API endpoints
│   ├── auth.js                  — Login / logout / OAuth
│   └── timetable.js             — Public timetable read endpoints
├── database.js                  — DB init + query helpers
├── server.js                    — Express app entry point
├── vercel.json
└── package.json
```

---

## API Reference

### Timetable (Public)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/timetable/class?section_id=` | Class timetable entries |
| GET | `/api/timetable/faculty?faculty_id=` | Faculty timetable |
| GET | `/api/timetable/location?room_id=` | Room/location timetable |
| GET | `/api/sections?year_id=` | Sections list |
| GET | `/api/faculty?department_id=` | Faculty list |
| GET | `/api/rooms?department_id=` | Rooms list |
| GET | `/api/timeslots?department_id=` | Time slots |

### Timetable Management (Admin)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/admin/generate` | Auto-generate timetable |
| POST | `/api/admin/clear` | Clear timetable |
| POST | `/api/admin/timetable/entry` | Add / update a cell entry |
| DELETE | `/api/admin/timetable/entry/:id` | Delete an entry |

### Lab Assignments (Admin)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/lab-assignments/:sectionId` | Get batch–faculty map |
| POST | `/api/admin/lab-assignments` | Save one batch assignment |
| DELETE | `/api/admin/lab-assignments/:sectionId` | Clear all for section |
| GET | `/api/admin/lab-entries/:sectionId` | Grouped lab schedule (editor) |

### Conflicts (Admin)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/conflicts` | All current conflicts with details |
| POST | `/api/admin/scan-conflicts` | Scan and return summary stats |
| POST | `/api/admin/suggest-fix` | Suggestion for a specific slot conflict |

### CRUD (Admin)
| Method | Endpoint |
|--------|----------|
| POST/PUT/DELETE | `/api/admin/sections/:id` |
| POST/PUT/DELETE | `/api/admin/subjects/:id` |
| POST/PUT/DELETE | `/api/admin/faculty/:id` |
| POST/PUT/DELETE | `/api/admin/rooms/:id` |
| GET/POST/PUT/DELETE | `/api/admin/incharges/:id` |
| GET/POST/PUT/DELETE | `/api/admin/departments/:id` |

---

## Database Schema

### Core Tables
```sql
sections   (id, year_id, name, lab_subsections, subsection_names)
subjects   (id, year_id, name, code, type, category, credits, hours_per_week)
           -- type: 'theory' | 'lab'
           -- category: 'regular' | 'btu'
faculty    (id, department_id, name, designation, role, email, subjects_can_teach)
rooms      (id, department_id, name, type, capacity)
           -- type: 'classroom' | 'lab'
time_slots (id, department_id, slot_number, start_time, end_time, is_break)
timetable_entries (id, section_id, time_slot_id, day_of_week,
                   subject_id, faculty_id, room_id, subsection)
           -- subsection: batch name (A/B/C) for lab entries, NULL for theory
```

### Supporting Tables
```sql
lab_assignments (id, section_id, subject_id, batch_name, faculty_id)
  UNIQUE (section_id, subject_id, batch_name)

departments   (id, name, code)
dept_incharges (id, department_id, email, name, is_active)
years         (id, department_id, name, display_name)
settings      (key, value)
```

---

## Troubleshooting

**Lab batches overlapping in editor?**
- Batches now display in a scrollable container if there are many per slot
- Click the batch row (not the lab subject header) to edit each batch's faculty/room
- If layout still appears crowded, adjust the minimum height in `public/admin/editor.html` (`.batch-row` min-height)

**Multiple faculties assigned to same lab subject?**
- The algorithm now enforces: one faculty per batch within a subject
- If this issue persists after regenerating, check faculty qualifications and subject assignments
- Use "Lab Faculty Assignment" to pre-assign specific faculties to batches

**BTU subjects appearing in all sections?**
- Name BTU sections with "BTU" in the name (e.g., "Section BTU", "BTU-A", "A-BTU")
- Mark all BTU theory subjects with category = "BTU" (in Subjects page)
- Regenerate after making changes

**BTU subjects not appearing in BTU sections?**
- Ensure subject category is set to "BTU" (not "regular")
- Verify section name contains "BTU" (case-insensitive)
- Check that subjects are assigned to the correct year
- Regenerate the timetable

**Conflicts after generation?**
- Go to Admin → Conflicts → Scan Now
- Common causes: insufficient labs/classrooms, too many subjects for available slots
- Try increasing rooms or reducing hours_per_week on some subjects

**Theory subjects missing from timetable?**
- Only top 6 by credits are scheduled per section
- Subjects with zero credits may be deprioritized — set credits appropriately

**Google OAuth not working?**
- Ensure `GOOGLE_CLIENT_ID` is set in both `.env` and Vercel env vars
- Check authorized origins include your exact domain (no trailing slash)

---

## Version History

| Version | Date | Notes |
|---------|------|-------|
| v3.1 | June 2026 | Fixed lab batch display with scrollable container, enforced one-faculty-per-batch rule, improved BTU subject filtering, enhanced editor UI for better batch visibility |
| v3.0 | June 2026 | Staggered lab batches, BTU-section filtering, unified editor grid, 6-subject theory cap, lab room consistency fix |
| v2.0 | June 2026 | Batch-wise lab assignment, conflicts page, multi-department support, improved algorithm |
| v1.0 | — | Basic generation, simple conflict detection, standard CRUD |

---

## License

Maintained by JIET Department of Technology.
