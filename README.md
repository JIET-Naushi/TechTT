# JIET Universe Timetable

**Department of Technology** — A full-stack college timetable management system for B.Tech I, II & III Year students.

## Features

- **Google OAuth Login** — Sign in with your Google account (multi-account support)
- **Editable Department Name** — Change department name from admin dashboard
- **Smart Classroom Assignment** — Dedicated classroom per section for maximum utilization
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

- **Backend:** Node.js, Express, PostgreSQL (Neon)
- **Frontend:** Vanilla HTML/CSS/JS
- **Authentication:** JWT + Google OAuth
- **Deployment:** Vercel

## Getting Started

### Local Development

```bash
npm install
cp .env.template .env
# Edit .env and fill in:
#  - POSTGRES_URL (from Neon database)
#  - JWT_SECRET (any strong random string)
#  - GOOGLE_CLIENT_ID (from Google Cloud Console)
node server.js
```

Open [http://localhost:3000](http://localhost:3000)

**Admin login:** Use Google Sign-In OR fallback password `admin` / `admin123`

### Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create a new **OAuth 2.0 Client ID** (Application type: Web application)
3. Add authorized JavaScript origins:
   - `http://localhost:3000` (for local development)
   - `https://your-app-name.vercel.app` (for production)
4. Add authorized redirect URIs:
   - `http://localhost:3000`
   - `https://your-app-name.vercel.app`
5. Copy the **Client ID** and add it to:
   - `.env` file as `GOOGLE_CLIENT_ID` (local)
   - Vercel environment variables (production)

### Vercel Deployment

1. Push to GitHub
2. Import repository in Vercel
3. Add environment variables in Vercel dashboard:
   - `POSTGRES_URL` — Get from Neon integration or dashboard
   - `JWT_SECRET` — Generate with `openssl rand -base64 32`
   - `GOOGLE_CLIENT_ID` — From Google Cloud Console (see above)
4. Deploy!

The database tables will be created automatically on first run.

## Department Info

- 25 Teaching Faculty + 2 HODs (Mentor & Admin)
- B.Tech I, II, III Year — Sections A, B, C
- 24 Subjects across all years
- 17 Rooms & Labs
