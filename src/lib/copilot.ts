// Pure resolver for the Manager Copilot — no Firebase / React imports.
// Translates Gemini function-calls into hydrated, applyable schedule
// operations and the resulting Shift[] (for validation). Shared by the route
// (to build the proposal) and the client (to render the diff + apply it).

import type { Employee, Location, Shift } from './types';

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

/** 'HH:MM' → minutes since midnight. */
function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/** Day-of-week name for an ISO 'YYYY-MM-DD' string (UTC, tz-independent). */
function isoDayName(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return DAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

function scheduledHours(start: string, end: string): number {
  return Math.round(((toMinutes(end) - toMinutes(start)) / 60) * 100) / 100;
}

function fullName(e: Employee): string {
  return `${e.firstName} ${e.lastName}`;
}

// ---------------------------------------------------------------------------
// Function-call argument shapes (as emitted by Gemini)
// ---------------------------------------------------------------------------

export interface RawFunctionCall {
  name: string;
  args?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Operation result types (carry before/after for diff display + apply)
// ---------------------------------------------------------------------------

export interface CopilotAddOp {
  action: 'add';
  shift: Shift; // id is a temp 'copilot-add-N'; client mints a real id on apply
}
export interface CopilotRemoveOp {
  action: 'remove';
  shiftId: string;
  before: Shift;
}
export interface CopilotReassignOp {
  action: 'reassign';
  shiftId: string;
  before: Shift;
  after: Shift;
}
export interface CopilotMoveOp {
  action: 'move';
  shiftId: string;
  before: Shift;
  after: Shift;
}
export type CopilotOperation =
  | CopilotAddOp
  | CopilotRemoveOp
  | CopilotReassignOp
  | CopilotMoveOp;

export interface ResolveResult {
  operations: CopilotOperation[];
  /** Current week's shifts with all operations applied — feed to validateSchedule. */
  resultingShifts: Shift[];
  /** Human-readable reasons a function call was dropped (unknown id, bad times…). */
  skipped: string[];
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/**
 * Resolve Gemini function-calls into hydrated operations against the current
 * week's shifts. Drops anything referencing unknown shift/employee/location or
 * with invalid times, recording why in `skipped`. Pure and deterministic.
 */
export function resolveCopilotOperations(
  calls: RawFunctionCall[],
  currentShifts: Shift[],
  employees: Employee[],
  locations: Location[],
): ResolveResult {
  const empById = new Map(employees.map((e) => [e.id, e]));
  const locById = new Map(locations.map((l) => [l.id, l]));
  const shiftById = new Map(currentShifts.map((s) => [s.id, { ...s }]));

  const operations: CopilotOperation[] = [];
  const skipped: string[] = [];
  // Mutable working set keyed by id; add temp shifts, drop removed, mutate edits.
  const working = new Map<string, Shift>(shiftById);
  let addCounter = 0;

  for (const call of calls) {
    const a = call.args ?? {};

    if (call.name === 'add_shift') {
      const date = str(a.date);
      const locationId = str(a.locationId);
      const role = str(a.role) as Shift['role'] | null;
      const employeeId = str(a.employeeId);
      const startTime = str(a.startTime);
      const endTime = str(a.endTime);
      const emp = employeeId ? empById.get(employeeId) : undefined;
      const loc = locationId ? locById.get(locationId) : undefined;
      if (!date || !role || !startTime || !endTime || !emp || !loc) {
        skipped.push(`add_shift: missing/unknown fields (${employeeId ?? '?'} @ ${locationId ?? '?'})`);
        continue;
      }
      if (toMinutes(endTime) <= toMinutes(startTime)) {
        skipped.push(`add_shift: end ${endTime} not after start ${startTime}`);
        continue;
      }
      const id = `copilot-add-${addCounter++}`;
      const shift: Shift = {
        id,
        date,
        day: isoDayName(date),
        locationId: loc.id,
        locationName: loc.name,
        shiftType: 'Pool Shift',
        role,
        employeeId: emp.id,
        employeeName: fullName(emp),
        startTime,
        endTime,
        scheduledHours: scheduledHours(startTime, endTime),
        status: 'Scheduled',
      };
      working.set(id, shift);
      operations.push({ action: 'add', shift });
      continue;
    }

    if (call.name === 'remove_shift') {
      const shiftId = str(a.shiftId);
      const before = shiftId ? working.get(shiftId) : undefined;
      if (!shiftId || !before) {
        skipped.push(`remove_shift: unknown shiftId ${shiftId ?? '?'}`);
        continue;
      }
      working.delete(shiftId);
      operations.push({ action: 'remove', shiftId, before: { ...before } });
      continue;
    }

    if (call.name === 'reassign_shift') {
      const shiftId = str(a.shiftId);
      const newEmployeeId = str(a.newEmployeeId);
      const before = shiftId ? working.get(shiftId) : undefined;
      const emp = newEmployeeId ? empById.get(newEmployeeId) : undefined;
      if (!shiftId || !before || !emp) {
        skipped.push(`reassign_shift: unknown shift/employee (${shiftId ?? '?'} → ${newEmployeeId ?? '?'})`);
        continue;
      }
      const after: Shift = { ...before, employeeId: emp.id, employeeName: fullName(emp) };
      working.set(shiftId, after);
      operations.push({ action: 'reassign', shiftId, before: { ...before }, after });
      continue;
    }

    if (call.name === 'move_shift') {
      const shiftId = str(a.shiftId);
      const before = shiftId ? working.get(shiftId) : undefined;
      if (!shiftId || !before) {
        skipped.push(`move_shift: unknown shiftId ${shiftId ?? '?'}`);
        continue;
      }
      const newDate = str(a.newDate) ?? before.date;
      const newStart = str(a.newStartTime) ?? before.startTime;
      const newEnd = str(a.newEndTime) ?? before.endTime;
      if (toMinutes(newEnd) <= toMinutes(newStart)) {
        skipped.push(`move_shift: end ${newEnd} not after start ${newStart}`);
        continue;
      }
      const after: Shift = {
        ...before,
        date: newDate,
        day: isoDayName(newDate),
        startTime: newStart,
        endTime: newEnd,
        scheduledHours: scheduledHours(newStart, newEnd),
      };
      working.set(shiftId, after);
      operations.push({ action: 'move', shiftId, before: { ...before }, after });
      continue;
    }

    skipped.push(`unknown tool: ${call.name}`);
  }

  return { operations, resultingShifts: Array.from(working.values()), skipped };
}
