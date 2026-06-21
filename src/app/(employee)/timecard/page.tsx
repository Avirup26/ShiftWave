'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getDocs, query, where } from 'firebase/firestore';
import { collections } from '@/lib/firestore';
import { useAuth } from '@/lib/auth';
import { DEMO_DATE } from '@/lib/constants';
import { addDays, getMondayOf, toDisplayDate, weekDatesFrom } from '@/lib/weekHelpers';
import { punchMinutes, splitRegularOvertime, round2 } from '@/lib/payHours';
import type { Punch, ReviewStatus, Shift } from '@/lib/types';

const navBtnCls =
  'rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm font-medium transition hover:bg-zinc-50 dark:border-white/10 dark:bg-zinc-900 dark:hover:bg-zinc-800';

function ReviewBadge({ status }: { status: ReviewStatus }) {
  if (status === 'Approved') return null;
  const styles: Record<Exclude<ReviewStatus, 'Approved'>, string> = {
    'Needs Review': 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400',
    Rejected: 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
      {status}
    </span>
  );
}

interface DayRow {
  date: string;
  shifts: Shift[];
  punches: Punch[];
  totalHours: number;
}

export default function TimecardPage() {
  const { employee } = useAuth();

  const [weekMonday, setWeekMonday] = useState<Date>(() => getMondayOf(DEMO_DATE));
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [punches, setPunches] = useState<Punch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const weekDates = useMemo(() => weekDatesFrom(weekMonday), [weekMonday]);
  const weekStart = weekDates[0];
  const weekEnd = weekDates[6];
  const rangeLabel = `${toDisplayDate(weekMonday)} – ${toDisplayDate(addDays(weekMonday, 6))}`;

  const loadWeek = useCallback(async () => {
    if (!employee) return;
    setLoading(true);
    setError(null);
    try {
      const [shiftSnap, punchSnap] = await Promise.all([
        getDocs(
          query(
            collections.shifts(),
            where('employeeId', '==', employee.id),
            where('date', '>=', weekStart),
            where('date', '<=', weekEnd),
          ),
        ),
        getDocs(
          query(
            collections.punches(),
            where('employeeId', '==', employee.id),
            where('date', '>=', weekStart),
            where('date', '<=', weekEnd),
          ),
        ),
      ]);
      setShifts(shiftSnap.docs.map((d) => d.data()).filter((s) => s.status !== 'Cancelled'));
      setPunches(punchSnap.docs.map((d) => d.data()));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load timecard');
    } finally {
      setLoading(false);
    }
  }, [employee, weekStart, weekEnd]);

  useEffect(() => {
    loadWeek();
  }, [loadWeek]);

  // Sorted week punches (date, then clock-in) — same accumulation order as gusto.ts.
  const sortedPunches = useMemo(
    () =>
      [...punches].sort(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          (a.clockIn ?? '').localeCompare(b.clockIn ?? ''),
      ),
    [punches],
  );

  const splits = useMemo(() => splitRegularOvertime(sortedPunches), [sortedPunches]);

  const weekTotals = useMemo(() => {
    return splits.reduce(
      (acc, s) => ({
        total: round2(acc.total + s.totalHours),
        regular: round2(acc.regular + s.regularHours),
        overtime: round2(acc.overtime + s.overtimeHours),
      }),
      { total: 0, regular: 0, overtime: 0 },
    );
  }, [splits]);

  const days: DayRow[] = useMemo(() => {
    return weekDates.map((date) => {
      const dayPunches = sortedPunches.filter((p) => p.date === date);
      const dayShifts = shifts
        .filter((s) => s.date === date)
        .sort((a, b) => a.startTime.localeCompare(b.startTime));
      const totalHours = round2(
        dayPunches.reduce((sum, p) => sum + punchMinutes(p) / 60, 0),
      );
      return { date, shifts: dayShifts, punches: dayPunches, totalHours };
    });
  }, [weekDates, shifts, sortedPunches]);

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Timecard</h1>
          <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">{rangeLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setWeekMonday((d) => addDays(d, -7))} className={navBtnCls}>
            ← Prev
          </button>
          <button onClick={() => setWeekMonday(() => getMondayOf(DEMO_DATE))} className={navBtnCls}>
            Demo week
          </button>
          <button onClick={() => setWeekMonday((d) => addDays(d, 7))} className={navBtnCls}>
            Next →
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-24">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
        </div>
      ) : (
        !error && (
          <>
            {/* Pay period summary */}
            <div className="mb-6 rounded-xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-zinc-950">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Pay Period Summary</p>
              <p className="mt-1 text-3xl font-semibold tabular-nums">
                {weekTotals.total} <span className="text-base font-normal text-zinc-500">Total Hours</span>
              </p>
              <div className="mt-3 flex gap-6 text-sm">
                <div>
                  <span className="text-zinc-500 dark:text-zinc-400">Regular</span>
                  <p className="font-semibold tabular-nums">{weekTotals.regular} hrs</p>
                </div>
                <div>
                  <span className="text-zinc-500 dark:text-zinc-400">Overtime</span>
                  <p
                    className={`font-semibold tabular-nums ${
                      weekTotals.overtime > 0 ? 'text-amber-600 dark:text-amber-400' : ''
                    }`}
                  >
                    {weekTotals.overtime} hrs
                  </p>
                </div>
              </div>
            </div>

            {/* Day-by-day list */}
            <div className="flex flex-col gap-3">
              {days.map((day) => {
                const date = new Date(day.date + 'T12:00:00');
                const weekday = date.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
                const dayNum = date.getDate();
                const hasContent = day.shifts.length > 0 || day.punches.length > 0;

                return (
                  <div
                    key={day.date}
                    className={`rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-950 ${
                      hasContent ? '' : 'opacity-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{weekday}</p>
                        <p className="text-lg font-semibold">{dayNum}</p>
                      </div>
                      {day.totalHours > 0 && (
                        <p className="text-sm font-semibold tabular-nums">{day.totalHours} HRS</p>
                      )}
                    </div>

                    {!hasContent && (
                      <p className="mt-2 text-sm text-zinc-400 dark:text-zinc-600">
                        No shift scheduled
                      </p>
                    )}

                    {day.shifts.map((shift) => {
                      const punch = day.punches.find((p) => p.shiftId === shift.id);
                      return (
                        <div key={shift.id} className="mt-2 flex flex-wrap items-center gap-2">
                          <p className="text-sm text-zinc-600 dark:text-zinc-400">
                            {punch?.clockIn ? (
                              <>
                                {punch.clockIn} – {punch.clockOut ?? 'In progress'}
                              </>
                            ) : (
                              <>
                                Scheduled {shift.startTime}–{shift.endTime} · not clocked in
                              </>
                            )}
                          </p>
                          {punch && <ReviewBadge status={punch.managerReviewStatus} />}
                        </div>
                      );
                    })}

                    {/* Punches with no matching shift in this list (e.g. shift filtered out). */}
                    {day.punches
                      .filter((p) => !day.shifts.some((s) => s.id === p.shiftId))
                      .map((punch) => (
                        <div key={punch.id} className="mt-2 flex flex-wrap items-center gap-2">
                          <p className="text-sm text-zinc-600 dark:text-zinc-400">
                            {punch.clockIn} – {punch.clockOut ?? 'In progress'}
                          </p>
                          <ReviewBadge status={punch.managerReviewStatus} />
                        </div>
                      ))}
                  </div>
                );
              })}
            </div>
          </>
        )
      )}
    </main>
  );
}
