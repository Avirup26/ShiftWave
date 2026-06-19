import { GoogleGenAI, Type } from '@google/genai';
import { NextResponse } from 'next/server';

import { adminAuth, adminDb } from '@/lib/firebase.admin';
import { COVERAGE_RULES, SHIFT_WINDOWS } from '@/lib/constants';
import { validateSchedule } from '@/lib/validators';
import type { Employee, Issue, Location, Shift, TimeOffRequest } from '@/lib/types';

// firebase-admin does not run on the Edge runtime (§0.5).
export const runtime = 'nodejs';

// The current fast, GA Gemini model on the Developer API. Per
// ai.google.dev/gemini-api/docs/deprecations its earliest shutdown is
// 2026-10-16 and the documented successor is `gemini-3.5-flash`; this is a
// one-line swap if/when that date is confirmed.
const GEMINI_MODEL = 'gemini-2.5-flash';

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

/** 'HH:MM' wall-clock string → minutes since midnight. */
function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/** Day-of-week name for an ISO 'YYYY-MM-DD' string (computed in UTC). */
function isoDayName(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return DAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** A single assignment as returned by Gemini (no derived fields). */
interface DraftAssignment {
  date: string;
  locationId: string;
  shiftType: Shift['shiftType'];
  role: Shift['role'];
  employeeId: string;
  startTime: string;
  endTime: string;
}

const RESPONSE_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      date: { type: Type.STRING, description: "ISO date 'YYYY-MM-DD' within the target week" },
      locationId: { type: Type.STRING },
      shiftType: { type: Type.STRING, enum: ['Pool Shift', 'Remote Admin', 'Event'] },
      role: {
        type: Type.STRING,
        enum: ['Manager', 'Ambassador', 'Instructor', 'Remote Admin', 'Event Lead'],
      },
      employeeId: { type: Type.STRING },
      startTime: { type: Type.STRING, description: "24h 'HH:MM'" },
      endTime: { type: Type.STRING, description: "24h 'HH:MM'" },
    },
    required: ['date', 'locationId', 'shiftType', 'role', 'employeeId', 'startTime', 'endTime'],
    propertyOrdering: [
      'date',
      'locationId',
      'shiftType',
      'role',
      'employeeId',
      'startTime',
      'endTime',
    ],
  },
};

const SYSTEM_INSTRUCTION = `You are a scheduling assistant for a multi-location swim school. Produce a one-week staff schedule as JSON only — an array of shift assignments matching the provided schema.

Honor these HARD rules:
- Coverage: every Pool Shift needs >=1 Manager, >=1 Ambassador, and >=4 Instructors (see coverageRules). Events need an Event Lead, 2 Ambassadors, 2 Instructors. Remote Admin needs 1 Remote Admin.
- Eligibility: only assign an employee to a location whose id is in that employee's eligibleLocations.
- Hours: keep each employee near their avgWeeklyHours and never schedule anyone over 40 hours in the week.
- No double-booking: never give one employee two overlapping shifts on the same day.
- Time-off: never schedule an employee on a date covered by their approved time-off.
- Shift windows: use the provided shiftWindows for start/end times. Saturday pool shifts are mornings. Pools are closed on Sunday.

Prefer assigning an employee's primary role. Cover all operating pool location/day cells for the week. Output JSON only — no prose.`;

function unauthorized(message: string) {
  return NextResponse.json({ error: message }, { status: 401 });
}

export async function POST(req: Request) {
  // --- 1. Verify the Firebase ID token (Admin SDK) ---
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) return unauthorized('Missing bearer token');

  let uid: string;
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    uid = decoded.uid;
  } catch {
    return unauthorized('Invalid or expired token');
  }

  // --- 2. Confirm manager via users/{uid} (appRole is NOT a token claim) ---
  const userSnap = await adminDb.collection('users').doc(uid).get();
  if (!userSnap.exists || userSnap.data()?.appRole !== 'manager') {
    return unauthorized('Manager role required');
  }

  // --- Parse + validate request body ---
  let weekDates: string[];
  try {
    const body = (await req.json()) as { weekDates?: unknown };
    if (
      !Array.isArray(body.weekDates) ||
      body.weekDates.length !== 7 ||
      !body.weekDates.every((d): d is string => typeof d === 'string')
    ) {
      return NextResponse.json(
        { error: 'weekDates must be an array of 7 ISO date strings' },
        { status: 400 },
      );
    }
    weekDates = body.weekDates;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const weekStart = weekDates[0];
  const weekEnd = weekDates[6];

  // --- 3. Gather inputs for the target week (Admin SDK reads) ---
  const [locSnap, empSnap, timeOffSnap] = await Promise.all([
    adminDb.collection('locations').get(),
    adminDb.collection('employees').where('status', '==', 'Active').get(),
    adminDb.collection('timeOffRequests').where('status', '==', 'Approved').get(),
  ]);

  const locations = locSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Location);
  const employees = empSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Employee);

  // Approved time-off intersecting the target week (ISO strings compare lexically).
  const approvedTimeOff = timeOffSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as TimeOffRequest)
    .filter((r) => r.startDate <= weekEnd && r.endDate >= weekStart)
    .map(({ employeeId, startDate, endDate }) => ({ employeeId, startDate, endDate }));

  // Compact payload for the model.
  const userPayload = {
    weekDates,
    locations: locations.map(({ id, name, type }) => ({ id, name, type })),
    employees: employees.map((e) => ({
      id: e.id,
      name: `${e.firstName} ${e.lastName}`,
      primaryRole: e.primaryRole,
      secondaryRole: e.secondaryRole ?? null,
      eligibleLocations: e.eligibleLocations,
      avgWeeklyHours: e.avgWeeklyHours,
    })),
    approvedTimeOff,
    coverageRules: COVERAGE_RULES,
    shiftWindows: SHIFT_WINDOWS,
  };

  // --- 4. Call Gemini (server-side key only) ---
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY is not configured' }, { status: 500 });
  }

  let parsed: DraftAssignment[];
  try {
    const ai = new GoogleGenAI({ apiKey });
    const res = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: JSON.stringify(userPayload),
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0.3,
      },
    });

    const text = res.text;
    if (!text) throw new Error('Empty response from model');
    const json = JSON.parse(text);
    if (!Array.isArray(json)) throw new Error('Model did not return an array');
    parsed = json as DraftAssignment[];
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: `Schedule generation failed: ${message}` },
      { status: 502 },
    );
  }

  // --- Hydrate draft assignments into full Shift objects ---
  const empById = new Map(employees.map((e) => [e.id, e]));
  const locById = new Map(locations.map((l) => [l.id, l]));

  const hydrated: Shift[] = [];
  parsed.forEach((a, i) => {
    const emp = empById.get(a.employeeId);
    const loc = locById.get(a.locationId);
    // Drop assignments referencing unknown employees/locations outright.
    if (!emp || !loc) return;
    if (toMinutes(a.endTime) <= toMinutes(a.startTime)) return;

    hydrated.push({
      id: `draft-${i}`,
      date: a.date,
      day: isoDayName(a.date),
      locationId: a.locationId,
      locationName: loc.name,
      shiftType: a.shiftType,
      role: a.role,
      employeeId: a.employeeId,
      employeeName: `${emp.firstName} ${emp.lastName}`,
      startTime: a.startTime,
      endTime: a.endTime,
      scheduledHours:
        Math.round(((toMinutes(a.endTime) - toMinutes(a.startTime)) / 60) * 100) / 100,
      status: 'Draft',
    });
  });

  // --- 4b. Validate → auto-repair (safely droppable) → re-validate ---
  const firstPass = validateSchedule(hydrated, employees, weekDates);

  // Only drop assignments whose removal cannot introduce a new violation:
  // ineligible (invalid) and double-booking (overlap). Over-hours and
  // understaffed are NOT auto-repaired — they are surfaced to the manager.
  const toDrop = new Set<string>();
  for (const issue of firstPass.issues) {
    if (issue.severity !== 'error' || !issue.shiftId) continue;
    if (issue.kind === 'ineligible' || issue.kind === 'double-booking') {
      toDrop.add(issue.shiftId);
    }
  }

  const draftShifts = hydrated.filter((s) => !toDrop.has(s.id));
  const finalReport = validateSchedule(draftShifts, employees, weekDates);

  // --- 5. Return the repaired draft + remaining issues. No Firestore writes. ---
  const issues: Issue[] = finalReport.issues;
  return NextResponse.json({ draftShifts, issues });
}
