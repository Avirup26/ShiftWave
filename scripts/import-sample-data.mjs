// Standalone Node ESM seed script. NOT part of the Next app — inits the Admin
// SDK directly. Run once:
//   node --env-file=.env.local scripts/import-sample-data.mjs
//
// Reads data/scheduling_timekeeping_demo_sample_data.xlsx and writes Firestore
// collections using the sheet IDs as document IDs so references line up.

import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import XLSX from 'xlsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DATA_FILE = path.join(
  REPO_ROOT,
  'data',
  'scheduling_timekeeping_demo_sample_data.xlsx',
);

// --- Admin init (same private-key un-escape as src/lib/firebase.admin.ts) ---
function initAdmin() {
  if (getApps().length) return;
  const raw = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_ADMIN_SERVICE_ACCOUNT is not set');
  const svc = JSON.parse(raw);
  svc.private_key = svc.private_key.replace(/\\n/g, '\n');
  initializeApp({ credential: cert(svc) });
}

// --- Helpers ---
const EXCEL_EPOCH = Date.UTC(1899, 11, 30); // serial 0

function serialToISO(serial) {
  if (serial === null || serial === undefined || serial === '') return null;
  const d = new Date(EXCEL_EPOCH + Number(serial) * 86400000);
  return d.toISOString().slice(0, 10);
}

function serialToMs(serial) {
  if (serial === null || serial === undefined || serial === '') return null;
  return EXCEL_EPOCH + Number(serial) * 86400000;
}

function toBool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v.trim().toUpperCase() === 'TRUE';
  return false;
}

function splitLocs(v) {
  if (!v) return [];
  return String(v)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function num(v) {
  return v === null || v === undefined || v === '' ? null : Number(v);
}

function str(v) {
  return v === null || v === undefined ? null : String(v);
}

function readSheet(wb, name) {
  const ws = wb.Sheets[name];
  if (!ws) throw new Error(`Sheet "${name}" not found in workbook`);
  return XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });
}

async function main() {
  initAdmin();
  const db = getFirestore();
  const wb = XLSX.readFile(DATA_FILE);

  // Spot-check the date conversion documented in PLAN §5.
  if (serialToISO(46195) !== '2026-06-22') {
    throw new Error(`Date conversion check failed: 46195 -> ${serialToISO(46195)}`);
  }

  const batch = db.batch();
  const counts = {};
  const add = (coll, id, data) => {
    batch.set(db.collection(coll).doc(String(id)), { id: String(id), ...data });
    counts[coll] = (counts[coll] ?? 0) + 1;
  };

  // Locations
  for (const r of readSheet(wb, 'Locations')) {
    add('locations', r.LocationID, {
      name: str(r.LocationName),
      type: str(r.LocationType),
      address: str(r.Address),
      lat: num(r.Latitude),
      lng: num(r.Longitude),
      geofenceRadiusFt: num(r.GeofenceRadiusFt) ?? 0,
      geofenceRequired: toBool(r.GeofenceRequired),
    });
  }

  // Roles -> RoleConfig
  for (const r of readSheet(wb, 'Roles')) {
    add('roles', r.Role, {
      role: str(r.Role),
      canClockIn: toBool(r.CanClockIn),
      requiresGeofence: toBool(r.RequiresGeofence),
      canWorkRemote: toBool(r.CanWorkRemote),
      defaultShiftLengthHours: num(r.DefaultShiftLengthHours) ?? 0,
    });
  }

  // Employees (roster). appRole derived from primaryRole.
  for (const r of readSheet(wb, 'Employees')) {
    const primaryRole = str(r.PrimaryRole);
    const data = {
      firstName: str(r.FirstName),
      lastName: str(r.LastName),
      primaryRole,
      eligibleLocations: splitLocs(r.EligibleLocations),
      avgWeeklyHours: num(r.AvgWeeklyHours) ?? 0,
      status: str(r.Status),
      appRole: primaryRole === 'Manager' ? 'manager' : 'employee',
    };
    if (r.SecondaryRole) data.secondaryRole = str(r.SecondaryRole);
    add('employees', r.EmployeeID, data);
  }

  // Schedule -> shifts
  for (const r of readSheet(wb, 'Schedule')) {
    add('shifts', r.ShiftID, {
      date: serialToISO(r.Date),
      day: str(r.Day),
      locationId: str(r.LocationID),
      locationName: str(r.LocationName),
      shiftType: str(r.ShiftType),
      role: str(r.Role),
      employeeId: str(r.EmployeeID),
      employeeName: str(r.EmployeeName),
      startTime: str(r.StartTime),
      endTime: str(r.EndTime),
      scheduledHours: num(r.ScheduledHours) ?? 0,
      status: str(r.Status),
    });
  }

  // TimePunches -> punches
  for (const r of readSheet(wb, 'TimePunches')) {
    add('punches', r.PunchID, {
      shiftId: str(r.ShiftID),
      employeeId: str(r.EmployeeID),
      date: serialToISO(r.Date),
      locationId: str(r.LocationID),
      scheduledStart: str(r.ScheduledStart),
      scheduledEnd: str(r.ScheduledEnd),
      clockIn: str(r.ClockIn),
      clockOut: str(r.ClockOut),
      clockInLat: num(r.ClockInLatitude),
      clockInLng: num(r.ClockInLongitude),
      geofenceStatus: str(r.GeofenceStatus),
      clockInTimingStatus: str(r.ClockInTimingStatus),
      managerReviewStatus: str(r.ManagerReviewStatus),
    });
  }

  // TimeOffRequests -> timeOffRequests
  for (const r of readSheet(wb, 'TimeOffRequests')) {
    add('timeOffRequests', r.RequestID, {
      employeeId: str(r.EmployeeID),
      startDate: serialToISO(r.StartDate),
      endDate: serialToISO(r.EndDate),
      reason: str(r.RequestType),
      status: str(r.Status),
      createdAt: serialToMs(r.SubmittedDate),
    });
  }

  // ShiftSwapRequests -> swapRequests
  for (const r of readSheet(wb, 'ShiftSwapRequests')) {
    add('swapRequests', r.SwapID, {
      shiftId: str(r.ShiftID),
      fromEmployeeId: str(r.OriginalEmployeeID),
      toEmployeeId: str(r.ProposedReplacementID),
      status: str(r.Status),
      createdAt: serialToMs(r.SubmittedDate),
    });
  }

  // Events -> events (real coords + geofence radius; supersedes the old
  // "events have no coordinates" assumption). Data only — geofence logic
  // is wired in later phases.
  for (const r of readSheet(wb, 'Events')) {
    add('events', r.EventID, {
      name: str(r.EventName),
      date: serialToISO(r.Date),
      locationId: str(r.LocationID),
      address: str(r.EventAddress),
      lat: num(r.Latitude),
      lng: num(r.Longitude),
      geofenceRadiusFt: num(r.GeofenceRadiusFt) ?? 0,
      expectedStaff: num(r.ExpectedStaff) ?? 0,
      notes: str(r.Notes),
    });
  }

  await batch.commit();

  console.log('Import complete. Documents written:');
  for (const [coll, n] of Object.entries(counts)) {
    console.log(`  ${coll}: ${n}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
