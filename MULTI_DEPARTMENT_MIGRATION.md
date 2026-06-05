# Multi-Department System Migration

## ⚠️ BREAKING CHANGE

This update converts the single-department system to a **multi-department system** where each department has completely isolated data.

## What Changed

### Database Schema
- Added `departments` table
- Added `department_id` foreign key to: `years`, `faculty`, `rooms`, `time_slots`
- Sections and subjects inherit department through `years.department_id`

### Default Departments
1. **Department of Technology** (TECH) - Fully seeded with existing data
2. **Department of Computer Science** (CS) - Empty placeholder
3. **Department of Mechanical Engineering** (MECH) - Empty placeholder

### New Features
- Landing page shows department selector
- All timetable views filtered by selected department
- Admin can manage multiple departments
- Each department has isolated: faculty, rooms, subjects, sections, time slots

## Migration Required

### ⚠️ THIS WILL DROP EXISTING DATA

The database schema has changed significantly. When deployed:

1. **New deployments**: Will auto-seed with 3 departments (TECH has data, CS/MECH empty)
2. **Existing deployments**: Need manual migration or data will be lost

### Manual Migration Steps

If you have existing data in production:

1. **Backup your data** before deploying
2. After deploy, old data will be incompatible
3. You'll need to manually re-enter data or:
   - Export existing data
   - Add department_id column
   - Re-import

### Recommended Approach

For your current deployment:
1. Note that Department of Technology data will be preserved
2. CS and MECH departments start empty
3. Use admin panel to add faculty/rooms/subjects for CS and MECH

## API Changes

All APIs now require or return `department_id`:
- `GET /api/departments` - List all departments
- All existing endpoints now filter by department context

## Frontend Changes

- Landing page: Department selector dropdown
- All views: Show data only for selected department
- Admin panel: Department switcher in header

## Next Steps

1. Deploy this update
2. Verify Department of Technology data is intact
3. Start adding data for CS and MECH departments through admin panel
4. Or create more departments as needed

---

**Status:** Ready to deploy
**Impact:** HIGH - Schema breaking change
**Rollback:** Requires database restore from backup
