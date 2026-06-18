'use client';

import { useEffect, useState } from 'react';
import { doc, getDocs, query, updateDoc, where } from 'firebase/firestore';
import { db } from '@/lib/firebase.client';
import { collections, getById } from '@/lib/firestore';
import type { Employee, Shift, SwapRequest, TimeOffRequest } from '@/lib/types';

// ---------------------------------------------------------------------------
// Enriched types
// ---------------------------------------------------------------------------

type EnrichedTOR = TimeOffRequest & {
  employee: Employee | null;
};

type EnrichedSwap = SwapRequest & {
  shift: Shift | null;
  fromEmployee: Employee | null;
  toEmployee: Employee | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionHeading({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-baseline gap-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
        {count}
      </span>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-black/10 px-4 py-6 text-center text-sm text-zinc-400 dark:border-white/10 dark:text-zinc-600">
      {message}
    </div>
  );
}

interface ActionButtonsProps {
  onApprove: () => void;
  onDeny: () => void;
  busy: boolean;
}

function ActionButtons({ onApprove, onDeny, busy }: ActionButtonsProps) {
  return (
    <div className="flex shrink-0 gap-2">
      <button
        onClick={onApprove}
        disabled={busy}
        className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-green-700 disabled:opacity-60"
      >
        Approve
      </button>
      <button
        onClick={onDeny}
        disabled={busy}
        className="rounded-lg border border-black/10 px-3 py-1.5 text-xs font-medium transition hover:bg-red-50 hover:text-red-700 disabled:opacity-60 dark:border-white/10 dark:hover:bg-red-900/20 dark:hover:text-red-400"
      >
        Deny
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ApprovalsPage() {
  const [torList, setTorList] = useState<EnrichedTOR[]>([]);
  const [swapList, setSwapList] = useState<EnrichedSwap[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      // Fetch employees, pending time-off requests, and pending swap requests in parallel
      const [empSnap, torSnap, swapSnap] = await Promise.all([
        getDocs(collections.employees()),
        getDocs(query(collections.timeOffRequests(), where('status', '==', 'Pending'))),
        getDocs(query(collections.swapRequests(), where('status', '==', 'Pending'))),
      ]);

      const empMap = new Map<string, Employee>(empSnap.docs.map((d) => [d.data().id, d.data()]));

      // Enrich time-off requests
      const enrichedTORs: EnrichedTOR[] = torSnap.docs.map((d) => {
        const tor = d.data();
        return { ...tor, employee: empMap.get(tor.employeeId) ?? null };
      });

      // Enrich swap requests — fetch each referenced shift
      const swapDocs = swapSnap.docs.map((d) => d.data());
      const uniqueShiftIds = [...new Set(swapDocs.map((s) => s.shiftId))];

      const shiftMap = new Map<string, Shift>();
      await Promise.all(
        uniqueShiftIds.map(async (id) => {
          const shift = await getById(collections.shifts(), id);
          if (shift) shiftMap.set(id, shift);
        }),
      );

      const enrichedSwaps: EnrichedSwap[] = swapDocs.map((s) => ({
        ...s,
        shift: shiftMap.get(s.shiftId) ?? null,
        fromEmployee: empMap.get(s.fromEmployeeId) ?? null,
        toEmployee: empMap.get(s.toEmployeeId) ?? null,
      }));

      setTorList(enrichedTORs.sort((a, b) => b.createdAt - a.createdAt));
      setSwapList(enrichedSwaps.sort((a, b) => b.createdAt - a.createdAt));
      setLoading(false);
    }
    load();
  }, []);

  // ---------------------------------------------------------------------------
  // Time-off request handlers
  // ---------------------------------------------------------------------------

  async function handleTOR(id: string, status: 'Approved' | 'Denied') {
    setBusyId(id);
    try {
      await updateDoc(doc(db, 'timeOffRequests', id), { status });
      setTorList((prev) => prev.filter((t) => t.id !== id));
    } finally {
      setBusyId(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Swap request handlers
  // ---------------------------------------------------------------------------

  async function handleSwap(swap: EnrichedSwap, status: 'Approved' | 'Denied') {
    setBusyId(swap.id);
    try {
      await updateDoc(doc(db, 'swapRequests', swap.id), { status });

      if (status === 'Approved' && swap.toEmployee) {
        // Reassign the shift to the replacement employee
        await updateDoc(doc(db, 'shifts', swap.shiftId), {
          employeeId: swap.toEmployeeId,
          employeeName: `${swap.toEmployee.firstName} ${swap.toEmployee.lastName}`,
        });
      }

      setSwapList((prev) => prev.filter((s) => s.id !== swap.id));
    } finally {
      setBusyId(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const cardCls =
    'flex flex-col gap-3 rounded-xl border border-black/10 bg-white px-4 py-4 dark:border-white/10 dark:bg-zinc-950 sm:flex-row sm:items-start sm:justify-between';
  const labelCls = 'text-xs font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-600';
  const valueCls = 'mt-0.5 text-sm';

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Approvals</h1>
        <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
          Review and act on pending time-off and shift-swap requests.
        </p>
      </div>

      {loading && (
        <div className="flex justify-center py-24">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
        </div>
      )}

      {!loading && (
        <div className="flex flex-col gap-10">
          {/* ----------------------------------------------------------------
              Time-off requests
          ---------------------------------------------------------------- */}
          <section className="flex flex-col gap-4">
            <SectionHeading title="Time-Off Requests" count={torList.length} />

            {torList.length === 0 ? (
              <EmptyState message="No pending time-off requests." />
            ) : (
              <div className="flex flex-col gap-3">
                {torList.map((tor) => {
                  const isBusy = busyId === tor.id;
                  const empName = tor.employee
                    ? `${tor.employee.firstName} ${tor.employee.lastName}`
                    : tor.employeeId;
                  const isSingleDay = tor.startDate === tor.endDate;

                  return (
                    <div key={tor.id} className={cardCls}>
                      <div className="flex flex-col gap-2">
                        <p className="font-medium">{empName}</p>

                        <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
                          <div>
                            <p className={labelCls}>{isSingleDay ? 'Date' : 'From'}</p>
                            <p className={valueCls}>{formatDate(tor.startDate)}</p>
                          </div>

                          {!isSingleDay && (
                            <div>
                              <p className={labelCls}>To</p>
                              <p className={valueCls}>{formatDate(tor.endDate)}</p>
                            </div>
                          )}

                          <div>
                            <p className={labelCls}>Reason</p>
                            <p className={valueCls}>{tor.reason || '—'}</p>
                          </div>
                        </div>
                      </div>

                      <ActionButtons
                        busy={isBusy}
                        onApprove={() => handleTOR(tor.id, 'Approved')}
                        onDeny={() => handleTOR(tor.id, 'Denied')}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* ----------------------------------------------------------------
              Swap requests
          ---------------------------------------------------------------- */}
          <section className="flex flex-col gap-4">
            <SectionHeading title="Shift-Swap Requests" count={swapList.length} />

            {swapList.length === 0 ? (
              <EmptyState message="No pending swap requests." />
            ) : (
              <div className="flex flex-col gap-3">
                {swapList.map((swap) => {
                  const isBusy = busyId === swap.id;
                  const fromName = swap.fromEmployee
                    ? `${swap.fromEmployee.firstName} ${swap.fromEmployee.lastName}`
                    : swap.fromEmployeeId;
                  const toName = swap.toEmployee
                    ? `${swap.toEmployee.firstName} ${swap.toEmployee.lastName}`
                    : swap.toEmployeeId;

                  return (
                    <div key={swap.id} className={cardCls}>
                      <div className="flex flex-col gap-2">
                        <p className="font-medium">
                          {fromName}{' '}
                          <span className="text-zinc-400 dark:text-zinc-600">→</span>{' '}
                          {toName}
                        </p>

                        {swap.shift ? (
                          <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
                            <div>
                              <p className={labelCls}>Date</p>
                              <p className={valueCls}>{formatDate(swap.shift.date)}</p>
                            </div>
                            <div>
                              <p className={labelCls}>Location</p>
                              <p className={valueCls}>{swap.shift.locationName}</p>
                            </div>
                            <div>
                              <p className={labelCls}>Time</p>
                              <p className={valueCls}>
                                {swap.shift.startTime}–{swap.shift.endTime}
                              </p>
                            </div>
                            <div>
                              <p className={labelCls}>Role</p>
                              <p className={valueCls}>{swap.shift.role}</p>
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs text-zinc-400 dark:text-zinc-600">
                            Shift details unavailable (ID: {swap.shiftId})
                          </p>
                        )}

                        {/* Warn if proposed replacement isn't eligible for the location */}
                        {swap.shift &&
                          swap.toEmployee &&
                          !swap.toEmployee.eligibleLocations.includes(swap.shift.locationId) && (
                            <p className="rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
                              Warning: {toName} is not eligible for {swap.shift.locationName}.
                            </p>
                          )}
                      </div>

                      <ActionButtons
                        busy={isBusy}
                        onApprove={() => handleSwap(swap, 'Approved')}
                        onDeny={() => handleSwap(swap, 'Denied')}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
