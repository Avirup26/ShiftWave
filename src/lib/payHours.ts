// Pure regular/overtime split logic. No Firebase / React imports (same
// contract as validators.ts) — canonical home for the 40h/week split so
// gusto.ts, /timecard, and /pay all agree on the same numbers.

import { OVERTIME_THRESHOLD_HOURS } from './constants';
import { minutesSinceMidnight } from './weekHelpers';
import type { Punch } from './types';

const OVERTIME_THRESHOLD_MINUTES = OVERTIME_THRESHOLD_HOURS * 60;

export interface DaySplit {
  totalHours: number;
  regularHours: number;
  overtimeHours: number;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Minutes worked by one punch; 0 if clock-in/out missing or invalid. */
export function punchMinutes(p: Pick<Punch, 'clockIn' | 'clockOut'>): number {
  if (!p.clockIn || !p.clockOut) return 0;
  const m = minutesSinceMidnight(p.clockOut) - minutesSinceMidnight(p.clockIn);
  return m > 0 ? m : 0;
}

/**
 * Splits a single employee's punches for one week into regular/overtime at
 * the 40h threshold. `weekPunches` must already be sorted into the order
 * hours should accumulate in (date, then clock-in). Accumulates on raw
 * minutes (no drift); returns one DaySplit per input punch, same order.
 */
export function splitRegularOvertime(weekPunches: Punch[]): DaySplit[] {
  let cumulativeMinutes = 0;
  return weekPunches.map((p) => {
    const totalMin = punchMinutes(p);
    const regularRoom = Math.max(0, OVERTIME_THRESHOLD_MINUTES - cumulativeMinutes);
    const regularMin = Math.min(totalMin, regularRoom);
    cumulativeMinutes += totalMin;

    const totalHours = round2(totalMin / 60);
    const regularHours = round2(regularMin / 60);
    const overtimeHours = round2(totalHours - regularHours);
    return { totalHours, regularHours, overtimeHours };
  });
}
