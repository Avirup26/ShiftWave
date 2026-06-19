'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getDocs, query, where } from 'firebase/firestore';
import { collections, getAll } from '@/lib/firestore';
import { DEMO_DATE } from '@/lib/constants';
import { validateSchedule } from '@/lib/validators';
import {
  addDays,
  getMondayOf,
  toDisplayDate,
  weekDatesFrom,
} from '@/lib/weekHelpers';
import type { Employee, Punch, Shift, ValidationReport } from '@/lib/types';
import KpiCard from '@/components/KpiCard';
import HoursBarChart from '@/components/HoursBarChart';
import OvertimeRiskList from '@/components/OvertimeRiskList';
import LaborCostCard from '@/components/LaborCostCard';
import CoverageGapsList from '@/components/CoverageGapsList';

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const [weekMonday, setWeekMonday] = useState<Date>(() => getMondayOf(DEMO_DATE));
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [punches, setPunches] = useState<Punch[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(true);
  const [loadingWeek, setLoadingWeek] = useState(true);

  const weekDates = useMemo(() => weekDatesFrom(weekMonday), [weekMonday]);
  const weekStart = weekDates[0];
  const weekEnd = weekDates[6];
  const rangeLabel = `${toDisplayDate(weekMonday)} – ${toDisplayDate(addDays(weekMonday, 6))}`;

  // Load employees once on mount
  useEffect(() => {
    getAll(collections.employees())
      .then(setEmployees)
      .finally(() => setLoadingEmployees(false));
  }, []);

  // Load shifts + punches for the selected week
  const loadWeek = useCallback(async () => {
    setLoadingWeek(true);
    const [shiftSnap, punchSnap] = await Promise.all([
      getDocs(
        query(collections.shifts(), where('date', '>=', weekStart), where('date', '<=', weekEnd)),
      ),
      getDocs(
        query(
          collections.punches(),
          where('date', '>=', weekStart),
          where('date', '<=', weekEnd),
        ),
      ),
    ]);
    setShifts(shiftSnap.docs.map((d) => d.data()));
    setPunches(punchSnap.docs.map((d) => d.data()));
    setLoadingWeek(false);
  }, [weekStart, weekEnd]);

  useEffect(() => {
    loadWeek();
  }, [loadWeek]);

  // Run validateSchedule exactly once per (shifts, employees, weekDates) triple.
  // The result feeds KPI cards, OvertimeRiskList, CoverageGapsList, and HoursBarChart.
  const report = useMemo<ValidationReport>(() => {
    if (loadingEmployees || loadingWeek || employees.length === 0) {
      return { issues: [], coverage: [], ok: true };
    }
    return validateSchedule(shifts, employees, weekDates);
  }, [shifts, employees, weekDates, loadingEmployees, loadingWeek]);

  // ---------------------------------------------------------------------------
  // Derived KPI values
  // ---------------------------------------------------------------------------

  const activeShifts = shifts.filter((s) => s.status !== 'Cancelled');

  const totalScheduledHours = activeShifts.reduce((sum, s) => sum + s.scheduledHours, 0);

  const employeesScheduled = new Set(activeShifts.map((s) => s.employeeId)).size;

  const coverageGapCount = report.coverage.filter((c) => !c.satisfied).length;

  const needsReviewCount = punches.filter((p) => p.managerReviewStatus === 'Needs Review').length;

  const overtimeIssues = report.issues.filter((i) => i.kind === 'over-hours');
  const overtimeCount = overtimeIssues.filter((i) => i.severity === 'error').length;

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------

  const loading = loadingEmployees || loadingWeek;

  const navBtnCls =
    'rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm font-medium transition hover:bg-zinc-50 dark:border-white/10 dark:bg-zinc-900 dark:hover:bg-zinc-800';

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">
      {/* Header + week navigation */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
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

      {/* Loading spinner */}
      {loading && (
        <div className="flex justify-center py-24">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
        </div>
      )}

      {!loading && (
        <>
          {/* KPI cards */}
          <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <KpiCard
              label="Scheduled Hours"
              value={totalScheduledHours.toFixed(1)}
              sub="non-cancelled shifts"
            />
            <KpiCard
              label="Employees Scheduled"
              value={employeesScheduled}
              sub="unique this week"
            />
            <KpiCard
              label="Coverage Gaps"
              value={coverageGapCount}
              accent={coverageGapCount > 0 ? 'red' : 'green'}
              sub="understaffed shifts"
            />
            <KpiCard
              label="Needs Review"
              value={needsReviewCount}
              accent={needsReviewCount > 0 ? 'amber' : 'green'}
              sub="punches flagged"
            />
          </div>

          {/* Hours per employee bar chart */}
          <section className="mb-8 rounded-xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-zinc-950">
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                Hours per Employee
              </h2>
              <p className="text-xs text-zinc-400 dark:text-zinc-600">
                Scheduled (blue / red if overtime risk) vs Actual from approved punches (green)
              </p>
            </div>
            <HoursBarChart
              shifts={shifts}
              punches={punches}
              employees={employees}
              overtimeIssues={overtimeIssues}
            />
          </section>

          {/* Overtime risk + Labor cost — side by side on wide screens */}
          <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Overtime risk */}
            <section className="rounded-xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-zinc-950">
              <div className="mb-3 flex items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                  Overtime Risk
                </h2>
                {overtimeCount > 0 && (
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-900/30 dark:text-red-400">
                    {overtimeCount} over 40h
                  </span>
                )}
              </div>
              <p className="mb-3 text-xs text-zinc-400 dark:text-zinc-600">
                Red = over {40}h (FLSA threshold) · Amber = over personal target.
                Same data as the red bars in the chart above.
              </p>
              <OvertimeRiskList issues={report.issues} />
            </section>

            {/* Labor cost estimate */}
            <LaborCostCard shifts={shifts} punches={punches} />
          </div>

          {/* Coverage gaps */}
          <section className="rounded-xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-zinc-950">
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                Coverage Gaps
              </h2>
              {coverageGapCount > 0 && (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-900/30 dark:text-red-400">
                  {coverageGapCount} understaffed
                </span>
              )}
            </div>
            <p className="mb-3 text-xs text-zinc-400 dark:text-zinc-600">
              Shifts that do not meet minimum role coverage requirements.
              Go to the Schedule Editor to fix gaps.
            </p>
            <CoverageGapsList coverage={report.coverage} />
          </section>
        </>
      )}
    </main>
  );
}
