'use client';

import { useCallback, useEffect, useState } from 'react';
import { deleteDoc, doc, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase.client';
import { collections } from '@/lib/firestore';
import { DEMO_DATE } from '@/lib/constants';
import type { Employee, Location, Shift } from '@/lib/types';
import ShiftFormModal from '@/components/ShiftFormModal';

// ---------------------------------------------------------------------------
// Week helpers
// ---------------------------------------------------------------------------

function getMondayOf(dateStr: string): Date {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay(); // 0=Sun…6=Sat
  const diff = day === 0 ? -6 : 1 - day; // Sunday → −6 (prior Mon); Mon → 0; etc.
  d.setDate(d.getDate() + diff);
  return d;
}

function addDays(d: Date, days: number): Date {
  const result = new Date(d);
  result.setDate(result.getDate() + days);
  return result;
}

/** Formats a Date as ISO 'YYYY-MM-DD' using the local calendar. */
function toISO(d: Date): string {
  return d.toLocaleDateString('en-CA');
}

/** Formats a Date for a compact column header: 'Mon\n6/22' */
function toColHeader(d: Date): { weekday: string; monthDay: string } {
  return {
    weekday: d.toLocaleDateString('en-US', { weekday: 'short' }),
    monthDay: d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }),
  };
}

/** Formats a Date for the range label. */
function toDisplayDate(d: Date): string {
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
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
  const [locations, setLocations] = useState<Location[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loadingStatic, setLoadingStatic] = useState(true);
  const [loadingShifts, setLoadingShifts] = useState(true);
  const [weekMonday, setWeekMonday] = useState<Date>(() => getMondayOf(DEMO_DATE));
  const [modal, setModal] = useState<ModalState | null>(null);

  // The 7 ISO date strings for the displayed week (Mon → Sun)
  const weekDates = Array.from({ length: 7 }, (_, i) => toISO(addDays(weekMonday, i)));
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

          {/* Global add */}
          <button
            onClick={() => openAdd()}
            className="rounded-lg bg-sky-500 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-sky-600"
          >
            + Add Shift
          </button>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-24">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
        </div>
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
                    return (
                      <td
                        key={date}
                        className="min-w-[176px] border-l border-black/5 px-2 py-2 align-top dark:border-white/5"
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
          onSaved={handleSaved}
          onClose={() => setModal(null)}
        />
      )}
    </main>
  );
}
