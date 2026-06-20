'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getDocs, query, where } from 'firebase/firestore';
import { collections, getAll } from '@/lib/firestore';
import { DEMO_DATE } from '@/lib/constants';
import {
  addDays,
  getMondayOf,
  toDisplayDate,
  weekDatesFrom,
} from '@/lib/weekHelpers';
import { buildGustoRows, GUSTO_COLUMNS, rowsToCsv } from '@/lib/gusto';
import type { Employee, Punch } from '@/lib/types';

function downloadCsv(filename: string, csv: string) {
  // Client-side download via Blob + anchor — no server route, no dependency.
  // Prepend a UTF-8 BOM so Excel opens accented names correctly.
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function PayrollPage() {
  const [weekMonday, setWeekMonday] = useState<Date>(() => getMondayOf(DEMO_DATE));
  const [punches, setPunches] = useState<Punch[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(true);
  const [loadingWeek, setLoadingWeek] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const weekDates = useMemo(() => weekDatesFrom(weekMonday), [weekMonday]);
  const weekStart = weekDates[0];
  const weekEnd = weekDates[6];
  const rangeLabel = `${toDisplayDate(weekMonday)} – ${toDisplayDate(addDays(weekMonday, 6))}`;

  useEffect(() => {
    getAll(collections.employees())
      .then(setEmployees)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load employees'))
      .finally(() => setLoadingEmployees(false));
  }, []);

  const loadWeek = useCallback(async () => {
    setLoadingWeek(true);
    setError(null);
    try {
      const snap = await getDocs(
        query(
          collections.punches(),
          where('date', '>=', weekStart),
          where('date', '<=', weekEnd),
        ),
      );
      setPunches(snap.docs.map((d) => d.data()));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load punches');
    } finally {
      setLoadingWeek(false);
    }
  }, [weekStart, weekEnd]);

  useEffect(() => {
    loadWeek();
  }, [loadWeek]);

  const employeesById = useMemo(
    () => new Map(employees.map((e) => [e.id, e])),
    [employees],
  );

  const { rows, excluded } = useMemo(
    () => buildGustoRows(punches, employeesById),
    [punches, employeesById],
  );

  const needsReviewExcluded = useMemo(
    () => excluded.filter((e) => e.reason === 'Needs Review'),
    [excluded],
  );

  const totals = useMemo(() => {
    const r2 = (n: number) => Math.round(n * 100) / 100;
    return {
      total: r2(rows.reduce((s, x) => s + x.totalHours, 0)),
      regular: r2(rows.reduce((s, x) => s + x.regularHours, 0)),
      overtime: r2(rows.reduce((s, x) => s + x.overtimeHours, 0)),
    };
  }, [rows]);

  const loading = loadingEmployees || loadingWeek;

  const handleExport = () => {
    const csv = rowsToCsv(rows);
    downloadCsv(`gusto-payroll-${weekStart}.csv`, csv);
  };

  const navBtnCls =
    'rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm font-medium transition hover:bg-zinc-50 dark:border-white/10 dark:bg-zinc-900 dark:hover:bg-zinc-800';

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">
      {/* Header + week navigation */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Payroll Export</h1>
          <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
            {rangeLabel} · Gusto-compatible CSV
          </p>
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

      {/* Error banner */}
      {error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-24">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
        </div>
      )}

      {!loading && !error && (
        <>
          {/* Summary + export action */}
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-zinc-950">
            <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
              <div>
                <span className="text-zinc-500 dark:text-zinc-400">Approved punches</span>
                <p className="text-lg font-semibold tabular-nums">{rows.length}</p>
              </div>
              <div>
                <span className="text-zinc-500 dark:text-zinc-400">Total hours</span>
                <p className="text-lg font-semibold tabular-nums">{totals.total}</p>
              </div>
              <div>
                <span className="text-zinc-500 dark:text-zinc-400">Regular</span>
                <p className="text-lg font-semibold tabular-nums">{totals.regular}</p>
              </div>
              <div>
                <span className="text-zinc-500 dark:text-zinc-400">Overtime</span>
                <p
                  className={`text-lg font-semibold tabular-nums ${
                    totals.overtime > 0 ? 'text-amber-600 dark:text-amber-400' : ''
                  }`}
                >
                  {totals.overtime}
                </p>
              </div>
            </div>
            <button
              onClick={handleExport}
              disabled={rows.length === 0}
              className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Download CSV
            </button>
          </div>

          {/* Excluded-punch gate notice */}
          {excluded.length > 0 && (
            <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700/50 dark:bg-amber-900/20 dark:text-amber-300">
              <p className="font-semibold">
                {excluded.length} punch{excluded.length !== 1 ? 'es' : ''} excluded from this export
              </p>
              <p className="mt-1 leading-snug">
                Only manager-approved punches are paid out.
                {needsReviewExcluded.length > 0 && (
                  <>
                    {' '}
                    {needsReviewExcluded.length} still need
                    {needsReviewExcluded.length === 1 ? 's' : ''} review —{' '}
                    <Link href="/review-queue" className="font-semibold underline">
                      resolve these in the review queue first
                    </Link>
                    .
                  </>
                )}
              </p>
              <ul className="mt-2 flex flex-col gap-0.5 text-xs">
                {excluded.map((e) => (
                  <li key={e.punchId} className="tabular-nums">
                    {e.date} · {e.employeeName} ({e.employeeId}) — {e.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* PTO scope note */}
          <div className="mb-6 rounded-xl border border-black/10 bg-zinc-50 px-4 py-3 text-xs leading-snug text-zinc-600 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-400">
            This export covers worked hours only (Regular / Overtime), matching the
            <span className="font-medium"> GustoExportSample</span> format. Approved paid time off
            is managed in{' '}
            <Link href="/approvals" className="font-medium underline">
              Approvals
            </Link>{' '}
            and would map to a separate Gusto PTO import — it is intentionally out of scope for this
            worked-hours CSV.
          </div>

          {/* Preview table */}
          {rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-black/10 px-6 py-16 text-center dark:border-white/10">
              <p className="font-medium">No approved punches for this week</p>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Approve flagged punches in the review queue to include them here.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-black/10 dark:border-white/10">
              <table className="w-full min-w-[820px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-black/10 bg-zinc-50 text-left dark:border-white/10 dark:bg-zinc-900">
                    {GUSTO_COLUMNS.map((c) => (
                      <th
                        key={c}
                        className="whitespace-nowrap px-3 py-2 font-semibold text-zinc-600 dark:text-zinc-300"
                      >
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr
                      key={`${r.employeeId}-${r.date}-${r.clockIn}-${i}`}
                      className="border-b border-black/5 last:border-0 dark:border-white/5"
                    >
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums">{r.employeeId}</td>
                      <td className="whitespace-nowrap px-3 py-2">{r.employeeName}</td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums">{r.date}</td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums">{r.clockIn}</td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums">{r.clockOut}</td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums">{r.totalHours}</td>
                      <td className="whitespace-nowrap px-3 py-2">{r.location}</td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums">{r.regularHours}</td>
                      <td
                        className={`whitespace-nowrap px-3 py-2 tabular-nums ${
                          r.overtimeHours > 0 ? 'font-semibold text-amber-600 dark:text-amber-400' : ''
                        }`}
                      >
                        {r.overtimeHours}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-zinc-500 dark:text-zinc-400">
                        {r.notes}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </main>
  );
}
