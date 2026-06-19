'use client';

import { useCallback, useEffect, useState } from 'react';
import { deleteDoc, doc, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase.client';
import { collections } from '@/lib/firestore';
import { DEMO_DATE, SHIFT_WINDOWS } from '@/lib/constants';
import { checkCoverage, describeMissing } from '@/lib/validators';
import { useAuth } from '@/lib/auth';
import {
  addDays,
  getMondayOf,
  isoWeekday,
  toColHeader,
  toDisplayDate,
  toISO,
  weekDatesFrom,
} from '@/lib/weekHelpers';
import type { Employee, Issue, Location, Shift } from '@/lib/types';
import ShiftFormModal from '@/components/ShiftFormModal';
import CoverageSummary from '@/components/CoverageSummary';
import AISchedulerModal from '@/components/AISchedulerModal';

// ---------------------------------------------------------------------------
// Per-cell coverage (reuses the pure validators)
// ---------------------------------------------------------------------------

const POOL_LOCATION_IDS = new Set<string>(Object.keys(SHIFT_WINDOWS));

interface CellCoverage {
  understaffed: boolean;
  tooltip: string;
}

/**
 * Coverage for a single grid cell. Checks every shift type present, plus
 * synthesizes Pool Shift coverage for operating pool locations (Mon–Sat) so
 * an entirely empty pool cell still flags as understaffed.
 */
function cellCoverage(locId: string, date: string, cellShifts: Shift[]): CellCoverage {
  const shiftTypes = new Set<Shift['shiftType']>(cellShifts.map((s) => s.shiftType));
  if (POOL_LOCATION_IDS.has(locId) && isoWeekday(date) !== 0) {
    shiftTypes.add('Pool Shift');
  }

  const reasons: string[] = [];
  for (const shiftType of shiftTypes) {
    const result = checkCoverage(cellShifts, shiftType, locId, date);
    if (!result.satisfied) {
      reasons.push(`${shiftType}: needs ${describeMissing(result.missing)}`);
    }
  }
  return { understaffed: reasons.length > 0, tooltip: reasons.join('; ') };
}

// ---------------------------------------------------------------------------
// ShiftCard (inline — small helper, one use site)
// ---------------------------------------------------------------------------

interface ShiftCardProps {
  shift: Shift;
  onEdit: () => void;
  onDelete: () => void;
}

function ShiftCard({ shift, onEdit, onDelete }: ShiftCardProps) {
  return (
    <div className="rounded-lg border border-black/8 bg-white px-2.5 py-2 text-xs dark:border-white/8 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-1">
        <span className="font-medium leading-tight">{shift.employeeName}</span>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={onEdit}
            title="Edit shift"
            className="rounded px-1 py-0.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            ✎
          </button>
          <button
            onClick={onDelete}
            title="Delete shift"
            className="rounded px-1 py-0.5 text-zinc-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
          >
            ×
          </button>
        </div>
      </div>
      <p className="mt-0.5 text-zinc-500 dark:text-zinc-400">
        {shift.startTime}–{shift.endTime}
      </p>
      <p className="text-zinc-400 dark:text-zinc-600">{shift.role}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal state shape
// ---------------------------------------------------------------------------

interface ModalState {
  mode: 'add' | 'edit';
  initialValues: Partial<Shift>;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ScheduleEditorPage() {
  const { firebaseUser } = useAuth();
  const [locations, setLocations] = useState<Location[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loadingStatic, setLoadingStatic] = useState(true);
  const [loadingShifts, setLoadingShifts] = useState(true);
  const [weekMonday, setWeekMonday] = useState<Date>(() => getMondayOf(DEMO_DATE));
  const [modal, setModal] = useState<ModalState | null>(null);
  const [aiDraft, setAiDraft] = useState<{ draftShifts: Shift[]; issues: Issue[] } | null>(
    null,
  );
  const [generating, setGenerating] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // The 7 ISO date strings for the displayed week (Mon → Sun)
  const weekDates = weekDatesFrom(weekMonday);
  const weekStartStr = weekDates[0];
  const weekEndStr = weekDates[6];

  // Load locations + employees once
  useEffect(() => {
    async function loadStatic() {
      const [locSnap, empSnap] = await Promise.all([
        getDocs(collections.locations()),
        getDocs(collections.employees()),
      ]);
      setLocations(locSnap.docs.map((d) => d.data()));
      setEmployees(empSnap.docs.map((d) => d.data()));
      setLoadingStatic(false);
    }
    loadStatic();
  }, []);

  // Load shifts whenever the week changes
  const loadShifts = useCallback(async () => {
    setLoadingShifts(true);
    const q = query(
      collections.shifts(),
      where('date', '>=', weekStartStr),
      where('date', '<=', weekEndStr),
    );
    const snap = await getDocs(q);
    setShifts(snap.docs.map((d) => d.data()));
    setLoadingShifts(false);
  }, [weekStartStr, weekEndStr]);

  useEffect(() => {
    loadShifts();
  }, [loadShifts]);

  // ---------------------------------------------------------------------------
  // Group shifts: locationId:date → Shift[]
  // ---------------------------------------------------------------------------

  const cellKey = (locationId: string, date: string) => `${locationId}:${date}`;

  const byCell = new Map<string, Shift[]>();
  for (const shift of shifts) {
    const key = cellKey(shift.locationId, shift.date);
    const list = byCell.get(key) ?? [];
    list.push(shift);
    byCell.set(key, list);
  }
  for (const list of byCell.values()) {
    list.sort((a, b) => a.startTime.localeCompare(b.startTime));
  }

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  async function handleDelete(shift: Shift) {
    if (
      !confirm(
        `Delete ${shift.employeeName}'s ${shift.role} shift on ${shift.date}? This cannot be undone.`,
      )
    )
      return;
    await deleteDoc(doc(db, 'shifts', shift.id));
    setShifts((prev) => prev.filter((s) => s.id !== shift.id));
  }

  function handleSaved(saved: Shift) {
    setShifts((prev) => {
      const idx = prev.findIndex((s) => s.id === saved.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = saved;
        return next;
      }
      return [...prev, saved];
    });
    setModal(null);
  }

  function openAdd(prefill: Partial<Shift> = {}) {
    setModal({ mode: 'add', initialValues: prefill });
  }

  function openEdit(shift: Shift) {
    setModal({ mode: 'edit', initialValues: shift });
  }

  async function handleGenerate() {
    if (!firebaseUser || generating) return;
    setGenerating(true);
    setAiError(null);
    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch('/api/generate-schedule', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ weekDates }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? 'Schedule generation failed.');
      }
      setAiDraft({ draftShifts: data.draftShifts ?? [], issues: data.issues ?? [] });
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Schedule generation failed.');
    } finally {
      setGenerating(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Derived display values
  // ---------------------------------------------------------------------------

  const weekEnd = addDays(weekMonday, 6);
  const rangeLabel = `${toDisplayDate(weekMonday)} – ${toDisplayDate(weekEnd)}`;
  const colHeaders = weekDates.map((d) => toColHeader(new Date(d + 'T12:00:00')));

  const loading = loadingStatic || loadingShifts;

  const navBtnCls =
    'rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm font-medium transition hover:bg-zinc-50 dark:border-white/10 dark:bg-zinc-900 dark:hover:bg-zinc-800';

  return (
    <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-10">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Schedule Editor</h1>
          <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">{rangeLabel}</p>
        </div>

        <div className="flex items-center gap-2">
          {/* Week navigation */}
          <button onClick={() => setWeekMonday((d) => addDays(d, -7))} className={navBtnCls}>
            ← Prev
          </button>
          <button
            onClick={() => setWeekMonday(() => getMondayOf(DEMO_DATE))}
            className={navBtnCls}
          >
            Demo week
          </button>
          <button onClick={() => setWeekMonday((d) => addDays(d, 7))} className={navBtnCls}>
            Next →
          </button>

          {/* AI auto-scheduler */}
          <button
            onClick={handleGenerate}
            disabled={generating || loading || !firebaseUser}
            title="Draft this week's schedule with AI"
            className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:opacity-60"
          >
            {generating ? 'Generating…' : '✨ Generate week with AI'}
          </button>

          {/* Global add */}
          <button
            onClick={() => openAdd()}
            className="rounded-lg bg-sky-500 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-sky-600"
          >
            + Add Shift
          </button>
        </div>
      </div>

      {/* AI generation error */}
      {aiError && (
        <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
          {aiError}
        </p>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-24">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
        </div>
      )}

      {/* Coverage & conflict summary */}
      {!loading && (
        <CoverageSummary shifts={shifts} employees={employees} weekDates={weekDates} />
      )}

      {/* Grid */}
      {!loading && (
        <div className="overflow-x-auto rounded-xl border border-black/10 dark:border-white/10">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {/* Location column header */}
                <th className="sticky left-0 z-10 min-w-[130px] bg-zinc-50 px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                  Location
                </th>

                {/* Day column headers */}
                {weekDates.map((date, i) => {
                  const { weekday, monthDay } = colHeaders[i];
                  const isToday = date === toISO(new Date());
                  return (
                    <th
                      key={date}
                      className="min-w-[176px] border-l border-black/5 px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:border-white/5 dark:text-zinc-400"
                    >
                      <span
                        className={
                          isToday ? 'text-sky-600 dark:text-sky-400' : undefined
                        }
                      >
                        {weekday} {monthDay}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>

            <tbody>
              {locations.map((loc) => (
                <tr
                  key={loc.id}
                  className="border-t border-black/5 dark:border-white/5"
                >
                  {/* Location name — sticky left */}
                  <td className="sticky left-0 z-10 bg-white px-3 py-3 font-medium dark:bg-zinc-950">
                    <span className="block leading-tight">{loc.name}</span>
                    <span className="block text-xs font-normal text-zinc-400 dark:text-zinc-600">
                      {loc.id}
                    </span>
                  </td>

                  {/* Day cells */}
                  {weekDates.map((date) => {
                    const cellShifts = byCell.get(cellKey(loc.id, date)) ?? [];
                    const coverage = cellCoverage(loc.id, date, cellShifts);
                    return (
                      <td
                        key={date}
                        title={coverage.understaffed ? coverage.tooltip : undefined}
                        className={`min-w-[176px] border-l px-2 py-2 align-top ${
                          coverage.understaffed
                            ? 'border-l-black/5 bg-red-50 ring-1 ring-inset ring-red-300 dark:border-l-white/5 dark:bg-red-900/15 dark:ring-red-800'
                            : 'border-l-black/5 dark:border-l-white/5'
                        }`}
                      >
                        <div className="flex flex-col gap-1.5">
                          {cellShifts.map((shift) => (
                            <ShiftCard
                              key={shift.id}
                              shift={shift}
                              onEdit={() => openEdit(shift)}
                              onDelete={() => handleDelete(shift)}
                            />
                          ))}

                          {coverage.understaffed && (
                            <p className="px-0.5 text-[11px] font-medium leading-tight text-red-600 dark:text-red-400">
                              ⚠ Understaffed — {coverage.tooltip}
                            </p>
                          )}

                          {/* Per-cell add button */}
                          <button
                            onClick={() =>
                              openAdd({ locationId: loc.id, date })
                            }
                            title={`Add shift — ${loc.name} on ${date}`}
                            className="w-full rounded-lg border border-dashed border-black/10 py-1 text-xs text-zinc-400 transition hover:border-sky-400 hover:text-sky-600 dark:border-white/10 dark:hover:border-sky-500 dark:hover:text-sky-400"
                          >
                            +
                          </button>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Shift form modal */}
      {modal && (
        <ShiftFormModal
          mode={modal.mode}
          initialValues={modal.initialValues}
          locations={locations}
          employees={employees}
          shifts={shifts}
          onSaved={handleSaved}
          onClose={() => setModal(null)}
        />
      )}

      {/* AI draft review modal */}
      {aiDraft && (
        <AISchedulerModal
          draftShifts={aiDraft.draftShifts}
          issues={aiDraft.issues}
          rangeLabel={rangeLabel}
          onAccepted={() => {
            setAiDraft(null);
            loadShifts();
          }}
          onClose={() => setAiDraft(null)}
        />
      )}
    </main>
  );
}
