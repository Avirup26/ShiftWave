// Pure payroll-export logic. No Firebase / React imports (same contract as
// validators.ts) so it is unit-testable in isolation and reusable.
//
// Canonical output format is the `GustoExportSample` sheet in
// data/scheduling_timekeeping_demo_sample_data.xlsx — one row PER PUNCH:
//
//   Employee ID, Employee Name, Date, Clock In, Clock Out, Total Hours,
//   Location, Regular Hours, Overtime Hours, Notes
//
// The app adds an approval gate the raw sample sheet does not have: only
// manager-Approved punches (with both clock times) are exported; everything
// else is returned as `excluded` so the UI can surface it.

import type { Employee, Punch } from './types';
import { minutesSinceMidnight } from './weekHelpers';
import { splitRegularOvertime } from './payHours';

/** Header order — matches the GustoExportSample sheet exactly. */
export const GUSTO_COLUMNS = [
  'Employee ID',
  'Employee Name',
  'Date',
  'Clock In',
  'Clock Out',
  'Total Hours',
  'Location',
  'Regular Hours',
  'Overtime Hours',
  'Notes',
] as const;

/** One exportable CSV row. Hours are already rounded to 2 decimals for display. */
export interface GustoRow {
  employeeId: string;
  employeeName: string;
  date: string; // ISO YYYY-MM-DD
  clockIn: string; // 'HH:MM'
  clockOut: string; // 'HH:MM'
  totalHours: number;
  location: string; // location code (ARL/GP/MAN/...) — matches the sample
  regularHours: number;
  overtimeHours: number;
  notes: string;
}

/** A punch that was not exported, with a human-readable reason. */
export interface ExcludedPunch {
  punchId: string;
  employeeId: string;
  employeeName: string;
  date: string;
  reason: string;
}

export interface GustoExport {
  rows: GustoRow[];
  excluded: ExcludedPunch[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function employeeName(employeesById: Map<string, Employee>, employeeId: string): string {
  const emp = employeesById.get(employeeId);
  return emp ? `${emp.firstName} ${emp.lastName}` : employeeId;
}

/** Why a punch is not payroll-exportable (null = it IS exportable). */
function exclusionReason(p: Punch): string | null {
  if (p.managerReviewStatus !== 'Approved') return p.managerReviewStatus; // 'Needs Review' | 'Rejected'
  if (!p.clockIn) return 'Approved but missing clock-in';
  if (!p.clockOut) return 'Approved but missing clock-out';
  const minutes = minutesSinceMidnight(p.clockOut) - minutesSinceMidnight(p.clockIn);
  if (minutes <= 0) return 'Invalid clock times (clock-out not after clock-in)';
  return null;
}

/**
 * Build the Gusto export from a set of punches for a pay week.
 *
 * - Approval gate: only `Approved` punches with valid clock times become rows;
 *   the rest are returned in `excluded` for the UI to surface.
 * - Regular/Overtime: split per employee per week at the 40h threshold.
 *   Accumulation is done on RAW MINUTES (unrounded); we round only at emit, so
 *   Regular + Overtime always equals the displayed Total Hours (no penny drift).
 * - One row per punch (an employee working two locations in a week => two rows).
 * - Rows are ordered date → location → clock-in.
 */
export function buildGustoRows(
  punches: Punch[],
  employeesById: Map<string, Employee>,
): GustoExport {
  const excluded: ExcludedPunch[] = [];
  const exportable: Punch[] = [];

  for (const p of punches) {
    const reason = exclusionReason(p);
    if (reason) {
      excluded.push({
        punchId: p.id,
        employeeId: p.employeeId,
        employeeName: employeeName(employeesById, p.employeeId),
        date: p.date,
        reason,
      });
    } else {
      exportable.push(p);
    }
  }

  // Group exportable punches by employee so overtime accumulates per person/week.
  const byEmployee = new Map<string, Punch[]>();
  for (const p of exportable) {
    const list = byEmployee.get(p.employeeId);
    if (list) list.push(p);
    else byEmployee.set(p.employeeId, [p]);
  }

  const rows: GustoRow[] = [];

  for (const [employeeId, empPunches] of byEmployee) {
    // Deterministic accumulation order: date, then clock-in time.
    empPunches.sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        minutesSinceMidnight(a.clockIn!) - minutesSinceMidnight(b.clockIn!),
    );

    const splits = splitRegularOvertime(empPunches);
    empPunches.forEach((p, i) => {
      const { totalHours, regularHours, overtimeHours } = splits[i];
      rows.push({
        employeeId,
        employeeName: employeeName(employeesById, employeeId),
        date: p.date,
        clockIn: p.clockIn!,
        clockOut: p.clockOut!,
        totalHours,
        location: p.locationId,
        regularHours,
        overtimeHours,
        notes: `${p.managerReviewStatus}; ${p.geofenceStatus}; ${p.clockInTimingStatus}`,
      });
    });
  }

  // Final display order: date → location → clock-in.
  rows.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.location.localeCompare(b.location) ||
      minutesSinceMidnight(a.clockIn) - minutesSinceMidnight(b.clockIn),
  );

  excluded.sort(
    (a, b) => a.date.localeCompare(b.date) || a.employeeName.localeCompare(b.employeeName),
  );

  return { rows, excluded };
}

/** RFC-4180 field escaping: quote when the value contains a comma, quote, CR or LF. */
function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Serialize rows to a CSV string with the GustoExportSample header.
 * Hour values are emitted as their rounded numeric form (e.g. 4.08, 3.7, 0),
 * matching the sample sheet's numeric cells.
 */
export function rowsToCsv(rows: GustoRow[]): string {
  const header = GUSTO_COLUMNS.map(csvEscape).join(',');
  const body = rows.map((r) =>
    [
      r.employeeId,
      r.employeeName,
      r.date,
      r.clockIn,
      r.clockOut,
      String(r.totalHours),
      r.location,
      String(r.regularHours),
      String(r.overtimeHours),
      r.notes,
    ]
      .map(csvEscape)
      .join(','),
  );
  return [header, ...body].join('\r\n');
}
