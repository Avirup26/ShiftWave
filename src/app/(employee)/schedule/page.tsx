'use client';

import { useEffect, useState } from 'react';
import { query, where, onSnapshot } from 'firebase/firestore';
import { useAuth } from '@/lib/auth';
import { collections } from '@/lib/firestore';
import { DEMO_DATE } from '@/lib/constants';
import { buildScheduleIcs } from '@/lib/ics';
import type { Shift } from '@/lib/types';

// Client-side download via Blob + anchor — no server route, no dependency,
// mirrors the Gusto CSV export in /payroll.
function downloadIcs(filename: string, ics: string) {
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Week helpers
// ---------------------------------------------------------------------------

/** Returns the Monday of the week containing the given ISO date string. */
function weekStart(iso: string): Date {
  const d = new Date(iso + 'T00:00:00');
  const day = d.getDay(); // 0=Sun…6=Sat
  const diff = day === 0 ? -6 : 1 - day; // shift to Monday
  d.setDate(d.getDate() + diff);
  return d;
}

/** Adds `days` calendar days to a Date and returns a new Date. */
function addDays(d: Date, days: number): Date {
  const result = new Date(d);
  result.setDate(result.getDate() + days);
  return result;
}

/** Formats a Date as ISO 'YYYY-MM-DD'. */
function toISO(d: Date): string {
  return d.toLocaleDateString('en-CA'); // en-CA gives YYYY-MM-DD
}

/** Formats a Date for display: 'Mon Jun 22' */
function toDisplayDate(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: Shift['status'] }) {
  const styles: Record<Shift['status'], string> = {
    Scheduled: 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400',
    Draft: 'bg-yellow-50 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400',
    Cancelled: 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SchedulePage() {
  const { employee } = useAuth();
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Default to the demo week (week of 2026-06-22) so seeded data is visible
  // regardless of the real calendar date.
  const [weekMonday, setWeekMonday] = useState<Date>(() => weekStart(DEMO_DATE));

  useEffect(() => {
    if (!employee) return;

    const q = query(
      collections.shifts(),
      where('employeeId', '==', employee.id),
    );

    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        setShifts(snap.docs.map((d) => d.data()));
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      },
    );

    return unsubscribe;
  }, [employee]);

  // Compute the 7 ISO dates for the displayed week.
  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(weekMonday, i);
    return toISO(d);
  });

  // Group this week's shifts by date.
  const weekDateSet = new Set(weekDates);
  const byDate = weekDates.reduce<Record<string, Shift[]>>((acc, date) => {
    acc[date] = [];
    return acc;
  }, {});
  for (const shift of shifts) {
    if (weekDateSet.has(shift.date)) {
      byDate[shift.date].push(shift);
    }
  }
  // Sort within each day by start time.
  for (const date of weekDates) {
    byDate[date].sort((a, b) => a.startTime.localeCompare(b.startTime));
  }

  const weekEnd = addDays(weekMonday, 6);
  const rangeLabel = `${toDisplayDate(weekMonday)} – ${toDisplayDate(weekEnd)}`;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My Schedule</h1>
          <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">{rangeLabel}</p>
        </div>

        {/* Week navigation */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWeekMonday((d) => addDays(d, -7))}
            className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm font-medium transition hover:bg-zinc-50 dark:border-white/10 dark:bg-zinc-900 dark:hover:bg-zinc-800"
          >
            ← Prev
          </button>
          <button
            onClick={() => setWeekMonday(() => weekStart(DEMO_DATE))}
            className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm font-medium transition hover:bg-zinc-50 dark:border-white/10 dark:bg-zinc-900 dark:hover:bg-zinc-800"
          >
            Demo week
          </button>
          <button
            onClick={() => setWeekMonday((d) => addDays(d, 7))}
            className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm font-medium transition hover:bg-zinc-50 dark:border-white/10 dark:bg-zinc-900 dark:hover:bg-zinc-800"
          >
            Next →
          </button>
          <button
            onClick={() => {
              if (!employee) return;
              const ics = buildScheduleIcs(
                shifts.filter((s) => s.status !== 'Cancelled'),
                `${employee.firstName} ${employee.lastName}`,
              );
              downloadIcs('shiftwave-schedule.ics', ics);
            }}
            disabled={!employee || shifts.length === 0}
            title="Download all of your upcoming shifts as a calendar file you can import into Google Calendar, Apple Calendar, or Outlook"
            className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm font-medium transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-zinc-900 dark:hover:bg-zinc-800"
          >
            📅 Export to Calendar
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-20">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
        </div>
      )}

      {/* Days */}
      {!loading && (
        <div className="flex flex-col gap-4">
          {weekDates.map((date) => {
            const dayShifts = byDate[date];
            const dateObj = new Date(date + 'T00:00:00');
            const dayLabel = dateObj.toLocaleDateString('en-US', {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
            });

            return (
              <section key={date}>
                <h2 className="mb-2 text-sm font-semibold text-zinc-500 dark:text-zinc-400">
                  {dayLabel}
                </h2>

                {dayShifts.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-black/10 px-4 py-3 text-sm text-zinc-400 dark:border-white/10 dark:text-zinc-600">
                    No shifts scheduled
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {dayShifts.map((shift) => (
                      <div
                        key={shift.id}
                        className="flex items-start justify-between gap-4 rounded-xl border border-black/10 bg-white px-4 py-3 dark:border-white/10 dark:bg-zinc-950"
                      >
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium">{shift.locationName}</span>
                          <span className="text-sm text-zinc-500 dark:text-zinc-400">
                            {shift.startTime}–{shift.endTime} · {shift.role} ·{' '}
                            {shift.scheduledHours}h
                          </span>
                          <span className="text-xs text-zinc-400 dark:text-zinc-600">
                            {shift.shiftType}
                          </span>
                        </div>
                        <StatusBadge status={shift.status} />
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}
