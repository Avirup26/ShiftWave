// Pure swap-candidate scoring — no Firebase / React imports. Reuses the
// validators so the matchmaker builds on the same primitives as the schedule
// editor and AI scheduler. The /api/swap-suggestions route feeds these facts
// to Gemini for ranking + one-line rationales.

import { OVERTIME_THRESHOLD_HOURS } from './constants';
import { checkDoubleBooking, checkEligibility } from './validators';
import type { Employee, Shift, TimeOffRequest } from './types';

export interface SwapCandidate {
  employeeId: string;
  name: string;
  primaryRole: Employee['primaryRole'];
  eligible: boolean;
  currentWeekHours: number;
  projectedWeekHours: number;
  wouldExceed40: boolean;
  wouldExceedTarget: boolean;
  wouldDoubleBook: boolean;
  onApprovedTimeOff: boolean;
  /** True when this candidate can take the shift with no hard blocker. */
  viable: boolean;
  warnings: string[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const ACTIVE = (s: Shift) => s.status !== 'Cancelled';

/**
 * Build scored swap candidates for `shift`, excluding its current owner.
 * Every candidate carries the facts the model needs (eligibility, hours,
 * conflicts, time-off). Sorted best-first by viability, fewest warnings, then
 * lowest projected hours (fairness). Pure + deterministic.
 */
export function buildSwapCandidates(
  shift: Shift,
  employees: Employee[],
  weekShifts: Shift[],
  approvedTimeOff: TimeOffRequest[],
): SwapCandidate[] {
  const candidates: SwapCandidate[] = [];

  for (const emp of employees) {
    if (emp.status !== 'Active' || emp.id === shift.employeeId) continue;

    const eligible = checkEligibility(shift, emp) === null;

    const empWeekShifts = weekShifts.filter((s) => s.employeeId === emp.id && ACTIVE(s));
    const currentWeekHours = round2(
      empWeekShifts.reduce((sum, s) => sum + s.scheduledHours, 0),
    );
    const projectedWeekHours = round2(currentWeekHours + shift.scheduledHours);

    const sameDay = empWeekShifts.filter((s) => s.date === shift.date);
    const wouldDoubleBook = checkDoubleBooking(shift, sameDay).length > 0;

    const onApprovedTimeOff = approvedTimeOff.some(
      (r) =>
        r.employeeId === emp.id &&
        r.status === 'Approved' &&
        r.startDate <= shift.date &&
        r.endDate >= shift.date,
    );

    const wouldExceed40 = projectedWeekHours > OVERTIME_THRESHOLD_HOURS;
    const wouldExceedTarget = projectedWeekHours > emp.avgWeeklyHours;

    const warnings: string[] = [];
    if (!eligible) warnings.push(`Not eligible for ${shift.locationName}`);
    if (wouldDoubleBook) warnings.push('Already booked at an overlapping time that day');
    if (onApprovedTimeOff) warnings.push('On approved time off that day');
    if (wouldExceed40) warnings.push(`Would reach ${projectedWeekHours}h (over 40h overtime threshold)`);
    else if (wouldExceedTarget) warnings.push(`Would reach ${projectedWeekHours}h (over ${emp.avgWeeklyHours}h target)`);

    const viable = eligible && !wouldDoubleBook && !onApprovedTimeOff && !wouldExceed40;

    candidates.push({
      employeeId: emp.id,
      name: `${emp.firstName} ${emp.lastName}`,
      primaryRole: emp.primaryRole,
      eligible,
      currentWeekHours,
      projectedWeekHours,
      wouldExceed40,
      wouldExceedTarget,
      wouldDoubleBook,
      onApprovedTimeOff,
      viable,
      warnings,
    });
  }

  candidates.sort(
    (a, b) =>
      Number(b.viable) - Number(a.viable) ||
      a.warnings.length - b.warnings.length ||
      a.projectedWeekHours - b.projectedWeekHours ||
      a.employeeId.localeCompare(b.employeeId),
  );

  return candidates;
}
