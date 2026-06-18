'use client';

import { useMemo } from 'react';
import { validateSchedule, describeMissing } from '@/lib/validators';
import type { Employee, Shift } from '@/lib/types';

interface Props {
  shifts: Shift[];
  employees: Employee[];
  /** The 7 ISO 'YYYY-MM-DD' strings for the displayed week. */
  weekDates: string[];
}

/** Short weekday + M/D label for an ISO date, computed in UTC. */
function dayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'numeric',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export default function CoverageSummary({ shifts, employees, weekDates }: Props) {
  const report = useMemo(
    () => validateSchedule(shifts, employees, weekDates),
    [shifts, employees, weekDates],
  );

  const gaps = report.coverage.filter((c) => !c.satisfied);
  const conflicts = report.issues.filter(
    (i) => i.kind === 'double-booking' || i.kind === 'ineligible',
  );
  const overHours = report.issues.filter((i) => i.kind === 'over-hours');

  const allClear = gaps.length === 0 && conflicts.length === 0 && overHours.length === 0;

  const chipCls = (tone: 'red' | 'amber' | 'green') =>
    ({
      red: 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400',
      amber: 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400',
      green: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400',
    })[tone];

  return (
    <section className="mb-6 rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-950">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-1 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Coverage &amp; conflicts
        </h2>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${chipCls(gaps.length ? 'red' : 'green')}`}>
          {gaps.length} coverage {gaps.length === 1 ? 'gap' : 'gaps'}
        </span>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${chipCls(conflicts.length ? 'red' : 'green')}`}>
          {conflicts.length} {conflicts.length === 1 ? 'conflict' : 'conflicts'}
        </span>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${chipCls(overHours.length ? 'amber' : 'green')}`}>
          {overHours.length} over-hours
        </span>
      </div>

      {allClear ? (
        <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-400">
          All shifts this week are fully covered with no conflicts.
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-3 text-sm">
          {gaps.length > 0 && (
            <div>
              <p className="mb-1 font-medium text-zinc-700 dark:text-zinc-300">Coverage gaps</p>
              <ul className="flex flex-col gap-1">
                {gaps.map((c) => (
                  <li
                    key={`${c.locationId}-${c.date}-${c.shiftType}`}
                    className="text-red-600 dark:text-red-400"
                  >
                    {c.locationId} · {dayLabel(c.date)} · {c.shiftType} — needs{' '}
                    {describeMissing(c.missing)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {conflicts.length > 0 && (
            <div>
              <p className="mb-1 font-medium text-zinc-700 dark:text-zinc-300">Conflicts</p>
              <ul className="flex flex-col gap-1">
                {conflicts.map((i, idx) => (
                  <li key={`conflict-${idx}`} className="text-red-600 dark:text-red-400">
                    {i.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {overHours.length > 0 && (
            <div>
              <p className="mb-1 font-medium text-zinc-700 dark:text-zinc-300">Over hours</p>
              <ul className="flex flex-col gap-1">
                {overHours.map((i, idx) => (
                  <li key={`overhours-${idx}`} className="text-amber-600 dark:text-amber-400">
                    {i.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
