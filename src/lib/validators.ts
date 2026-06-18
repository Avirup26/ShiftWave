// Conflict & coverage detection — pure functions, no Firebase / React / I/O.
// Data in, structured results out. Reused by the schedule editor (Phase 4),
// the AI scheduler repair step (Phase 6), and the dashboard (Phase 7).

import { COVERAGE_RULES, OVERTIME_THRESHOLD_HOURS, SHIFT_WINDOWS } from './constants';
import type {
  CoverageResult,
  Employee,
  Issue,
  RoleName,
  Shift,
  ValidationReport,
} from './types';

// ---------------------------------------------------------------------------
// Internal pure helpers
// ---------------------------------------------------------------------------

/** 'HH:MM' wall-clock string → minutes since midnight. */
function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Day of week (0=Sun … 6=Sat) for an ISO 'YYYY-MM-DD' string, computed via
 * UTC so the result never depends on the host timezone.
 */
function isoWeekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

const ACTIVE = (s: Shift) => s.status !== 'Cancelled';

const fmtRange = (s: Shift) => `${s.locationName} ${s.startTime}–${s.endTime}`;

/** Strict time overlap: back-to-back shifts (a ends when b starts) do NOT overlap. */
function overlaps(a: Shift, b: Shift): boolean {
  return (
    toMinutes(a.startTime) < toMinutes(b.endTime) &&
    toMinutes(b.startTime) < toMinutes(a.endTime)
  );
}

// ---------------------------------------------------------------------------
// checkDoubleBooking — overlapping times, same employee, same day, any location
// ---------------------------------------------------------------------------

export function checkDoubleBooking(
  shift: Shift,
  allShiftsForEmployeeOnDate: Shift[],
): Issue[] {
  if (!ACTIVE(shift)) return [];

  const issues: Issue[] = [];
  for (const peer of allShiftsForEmployeeOnDate) {
    if (peer.id === shift.id || !ACTIVE(peer)) continue;
    if (overlaps(shift, peer)) {
      issues.push({
        kind: 'double-booking',
        severity: 'error',
        employeeId: shift.employeeId,
        shiftId: shift.id,
        message: `${shift.employeeName} is double-booked: ${fmtRange(shift)} overlaps ${fmtRange(peer)}`,
      });
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// checkEligibility — shift location must be in the employee's eligibleLocations
// ---------------------------------------------------------------------------

export function checkEligibility(shift: Shift, employee: Employee): Issue | null {
  if (employee.eligibleLocations.includes(shift.locationId)) return null;
  return {
    kind: 'ineligible',
    severity: 'error',
    employeeId: employee.id,
    shiftId: shift.id,
    message: `${employee.firstName} ${employee.lastName} is not eligible for ${shift.locationName}`,
  };
}

// ---------------------------------------------------------------------------
// checkOverHours — soft warning (over avgWeeklyHours) vs hard error (> 40h)
// ---------------------------------------------------------------------------

export function checkOverHours(
  employeeId: string,
  weekShifts: Shift[],
  employee: Employee,
): Issue | null {
  const total = weekShifts
    .filter((s) => s.employeeId === employeeId && ACTIVE(s))
    .reduce((sum, s) => sum + s.scheduledHours, 0);
  const totalRounded = Math.round(total * 100) / 100;
  const name = `${employee.firstName} ${employee.lastName}`;

  if (totalRounded > OVERTIME_THRESHOLD_HOURS) {
    return {
      kind: 'over-hours',
      severity: 'error',
      employeeId,
      message: `${name} is scheduled ${totalRounded}h, over the ${OVERTIME_THRESHOLD_HOURS}h overtime threshold`,
    };
  }
  if (totalRounded > employee.avgWeeklyHours) {
    return {
      kind: 'over-hours',
      severity: 'warning',
      employeeId,
      message: `${name} is scheduled ${totalRounded}h, over their ${employee.avgWeeklyHours}h target`,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// checkCoverage — actual role counts on (location, date, shiftType) vs rules
// ---------------------------------------------------------------------------

export function checkCoverage(
  shiftsForLocationDay: Shift[],
  shiftType: Shift['shiftType'],
  locationId: string,
  date: string,
): CoverageResult {
  const rules = COVERAGE_RULES[shiftType] as Record<string, number>;

  const counts: Partial<Record<RoleName, number>> = {};
  for (const s of shiftsForLocationDay) {
    if (s.shiftType !== shiftType || !ACTIVE(s)) continue;
    counts[s.role] = (counts[s.role] ?? 0) + 1;
  }

  const missing: { role: RoleName; need: number; have: number }[] = [];
  for (const [role, need] of Object.entries(rules)) {
    const have = counts[role as RoleName] ?? 0;
    if (have < need) missing.push({ role: role as RoleName, need, have });
  }

  return { locationId, date, shiftType, satisfied: missing.length === 0, missing };
}

/** Human-readable missing-coverage summary, e.g. "needs 1 Ambassador, 2 more Instructors". */
export function describeMissing(missing: CoverageResult['missing']): string {
  return missing
    .map(({ role, need, have }) => {
      const gap = need - have;
      const plural = gap === 1 ? '' : 's';
      return have > 0
        ? `${gap} more ${role}${plural}`
        : `${gap} ${role}${plural}`;
    })
    .join(', ');
}

// ---------------------------------------------------------------------------
// validateSchedule — orchestrates all checks over one week of shifts
// ---------------------------------------------------------------------------

const POOL_LOCATIONS = Object.keys(SHIFT_WINDOWS); // ['ARL','GP','MAN']

export function validateSchedule(
  shifts: Shift[],
  employees: Employee[],
  weekDates: string[],
): ValidationReport {
  const empById = new Map(employees.map((e) => [e.id, e]));
  const issues: Issue[] = [];

  // --- Eligibility (per shift) ---
  for (const shift of shifts) {
    const emp = empById.get(shift.employeeId);
    if (!emp) continue;
    const issue = checkEligibility(shift, emp);
    if (issue) issues.push(issue);
  }

  // --- Double-booking (per employee/day group; each unordered pair once) ---
  const byEmpDay = new Map<string, Shift[]>();
  for (const shift of shifts) {
    if (!ACTIVE(shift)) continue;
    const key = `${shift.employeeId}|${shift.date}`;
    const list = byEmpDay.get(key) ?? [];
    list.push(shift);
    byEmpDay.set(key, list);
  }
  for (const group of byEmpDay.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        if (overlaps(a, b)) {
          issues.push({
            kind: 'double-booking',
            severity: 'error',
            employeeId: a.employeeId,
            shiftId: a.id,
            message: `${a.employeeName} is double-booked: ${fmtRange(a)} overlaps ${fmtRange(b)}`,
          });
        }
      }
    }
  }

  // --- Over-hours (one issue per employee that has shifts) ---
  const empIdsWithShifts = new Set(shifts.map((s) => s.employeeId));
  for (const empId of empIdsWithShifts) {
    const emp = empById.get(empId);
    if (!emp) continue;
    const issue = checkOverHours(empId, shifts, emp);
    if (issue) issues.push(issue);
  }

  // --- Coverage ---
  const coverage: CoverageResult[] = [];

  // Reactive: every actual (location|date|shiftType) group that exists.
  const byCell = new Map<string, Shift[]>();
  for (const shift of shifts) {
    if (!ACTIVE(shift)) continue;
    const key = `${shift.locationId}|${shift.date}|${shift.shiftType}`;
    const list = byCell.get(key) ?? [];
    list.push(shift);
    byCell.set(key, list);
  }
  for (const [key, cellShifts] of byCell.entries()) {
    const [locationId, date, shiftType] = key.split('|') as [
      string,
      string,
      Shift['shiftType'],
    ];
    coverage.push(checkCoverage(cellShifts, shiftType, locationId, date));
  }

  // Synthesized: empty Pool-Shift cells for operating pool locations/days
  // (Mon–Sat; Sunday closed). Remote Admin / Event are reactive-only.
  for (const locationId of POOL_LOCATIONS) {
    for (const date of weekDates) {
      if (isoWeekday(date) === 0) continue; // Sunday: pools closed
      const key = `${locationId}|${date}|Pool Shift`;
      if (byCell.has(key)) continue; // already covered reactively
      coverage.push(checkCoverage([], 'Pool Shift', locationId, date));
    }
  }

  // Surface unsatisfied coverage as understaffed issues too.
  for (const c of coverage) {
    if (!c.satisfied) {
      issues.push({
        kind: 'understaffed',
        severity: 'error',
        message: `${c.shiftType} at ${c.locationId} on ${c.date} understaffed: needs ${describeMissing(c.missing)}`,
      });
    }
  }

  const ok =
    issues.every((i) => i.severity !== 'error') && coverage.every((c) => c.satisfied);

  return { issues, coverage, ok };
}
