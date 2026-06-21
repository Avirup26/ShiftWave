'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { query, where, getDocs, addDoc, collection } from 'firebase/firestore';
import { db } from '@/lib/firebase.client';
import { collections } from '@/lib/firestore';
import { useAuth } from '@/lib/auth';
import type { Employee, Shift, SwapRequest, TimeOffRequest } from '@/lib/types';

type Tab = 'time-off' | 'swap';

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: 'Pending' | 'Approved' | 'Denied' }) {
  const styles = {
    Pending: 'bg-yellow-50 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400',
    Approved: 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400',
    Denied: 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Time-off section
// ---------------------------------------------------------------------------

function TimeOffSection({ employeeId }: { employeeId: string }) {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [requests, setRequests] = useState<TimeOffRequest[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(true);

  useEffect(() => {
    async function load() {
      const snap = await getDocs(
        query(
          collections.timeOffRequests(),
          where('employeeId', '==', employeeId),
        ),
      );
      const sorted = snap.docs
        .map((d) => d.data())
        .sort((a, b) => b.createdAt - a.createdAt);
      setRequests(sorted);
      setLoadingRequests(false);
    }
    load();
  }, [employeeId]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (!startDate || !endDate || !reason.trim()) {
      setError('All fields are required.');
      return;
    }
    if (endDate < startDate) {
      setError('End date must be on or after start date.');
      return;
    }
    setSubmitting(true);
    try {
      const data: Omit<TimeOffRequest, 'id'> = {
        employeeId,
        startDate,
        endDate,
        reason: reason.trim(),
        status: 'Pending',
        createdAt: Date.now(),
      };
      const docRef = await addDoc(collection(db, 'timeOffRequests'), data);
      const newReq: TimeOffRequest = { ...data, id: docRef.id };
      setRequests((prev) => [newReq, ...prev]);
      setStartDate('');
      setEndDate('');
      setReason('');
      setSuccess('Time-off request submitted.');
    } catch {
      setError('Failed to submit request. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Form */}
      <div className="rounded-xl border border-black/10 bg-white px-6 py-5 dark:border-white/10 dark:bg-zinc-950">
        <h2 className="mb-4 text-base font-semibold">Request Time Off</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Start date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 dark:border-white/15 dark:bg-zinc-900"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                End date
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                min={startDate}
                className="w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 dark:border-white/15 dark:bg-zinc-900"
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Reason
            </label>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Briefly describe your reason…"
              className="w-full resize-none rounded-lg border border-black/15 bg-white px-3 py-2 text-sm outline-none transition placeholder:text-zinc-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 dark:border-white/15 dark:bg-zinc-900 dark:placeholder:text-zinc-600"
            />
          </div>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
              {error}
            </p>
          )}
          {success && (
            <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-400">
              {success}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="self-start rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-600 disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Submit request'}
          </button>
        </form>
      </div>

      {/* History */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-zinc-500 dark:text-zinc-400">
          Your requests
        </h3>
        {loadingRequests ? (
          <div className="flex justify-center py-8">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
          </div>
        ) : requests.length === 0 ? (
          <p className="text-sm text-zinc-400 dark:text-zinc-600">No time-off requests yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {requests.map((req) => (
              <div
                key={req.id}
                className="flex items-start justify-between gap-4 rounded-xl border border-black/10 bg-white px-4 py-3 dark:border-white/10 dark:bg-zinc-950"
              >
                <div>
                  <p className="text-sm font-medium">
                    {req.startDate === req.endDate
                      ? req.startDate
                      : `${req.startDate} – ${req.endDate}`}
                  </p>
                  <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">{req.reason}</p>
                </div>
                <StatusBadge status={req.status} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Swap request section
// ---------------------------------------------------------------------------

interface SwapSuggestion {
  employeeId: string;
  name: string;
  rank: number;
  reason: string;
  hoursThisWeek: number;
  warnings: string[];
}

function SwapSection({ employeeId }: { employeeId: string }) {
  const { firebaseUser } = useAuth();
  const [shifts, setShifts] = useState<Shift[]>([]);
  // allShiftsMap keeps all shifts for history display even after they're
  // removed from the picker (because they have a pending swap).
  const [allShiftsMap, setAllShiftsMap] = useState<Record<string, Shift>>({});
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [mySwaps, setMySwaps] = useState<SwapRequest[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  const [selectedShiftId, setSelectedShiftId] = useState('');
  const [selectedReplacementId, setSelectedReplacementId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // AI swap matchmaker
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState('');
  const [suggestions, setSuggestions] = useState<SwapSuggestion[] | null>(null);

  useEffect(() => {
    async function load() {
      // My scheduled shifts
      const shiftSnap = await getDocs(
        query(
          collections.shifts(),
          where('employeeId', '==', employeeId),
          where('status', '==', 'Scheduled'),
        ),
      );
      const allShifts = shiftSnap.docs
        .map((d) => d.data())
        .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));

      // Keep a map of all shifts for history display.
      const shiftsMap: Record<string, Shift> = {};
      for (const s of allShifts) shiftsMap[s.id] = s;
      setAllShiftsMap(shiftsMap);

      // My swap requests (to know which shift IDs already have pending swaps)
      const swapSnap = await getDocs(
        query(
          collections.swapRequests(),
          where('fromEmployeeId', '==', employeeId),
        ),
      );
      const swaps = swapSnap.docs
        .map((d) => d.data())
        .sort((a, b) => b.createdAt - a.createdAt);
      setMySwaps(swaps);

      // Shift IDs with an already-pending swap (exclude from picker)
      const pendingShiftIds = new Set(
        swaps.filter((s) => s.status === 'Pending').map((s) => s.shiftId),
      );

      const availableShifts = allShifts.filter((s) => !pendingShiftIds.has(s.id));
      setShifts(availableShifts);

      // All active employees (for replacement picker)
      const empSnap = await getDocs(collections.employees());
      setEmployees(empSnap.docs.map((d) => d.data()));

      setLoadingData(false);
    }
    load();
  }, [employeeId]);

  // Derive the selected shift object for location-based filtering
  const selectedShift = shifts.find((s) => s.id === selectedShiftId) ?? null;

  // Filter replacement employees: must be active, not self, eligible for the
  // shift's location (correctness fix — pre-empts Phase 4 validators).
  const eligibleReplacements = employees.filter(
    (emp) =>
      emp.status === 'Active' &&
      emp.id !== employeeId &&
      (selectedShift
        ? emp.eligibleLocations.includes(selectedShift.locationId)
        : false),
  );

  // Reset replacement + suggestions when the shift changes.
  const handleShiftChange = (shiftId: string) => {
    setSelectedShiftId(shiftId);
    setSelectedReplacementId('');
    setSuggestions(null);
    setSuggestError('');
  };

  const handleSuggest = async () => {
    if (!firebaseUser || !selectedShiftId || suggesting) return;
    setSuggesting(true);
    setSuggestError('');
    setSuggestions(null);
    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch('/api/swap-suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ shiftId: selectedShiftId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Could not get suggestions.');
      setSuggestions((data.suggestions ?? []) as SwapSuggestion[]);
    } catch (err) {
      setSuggestError(err instanceof Error ? err.message : 'Could not get suggestions.');
    } finally {
      setSuggesting(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (!selectedShiftId || !selectedReplacementId) {
      setError('Select both a shift and a replacement employee.');
      return;
    }
    setSubmitting(true);
    try {
      const data: Omit<SwapRequest, 'id'> = {
        shiftId: selectedShiftId,
        fromEmployeeId: employeeId,
        toEmployeeId: selectedReplacementId,
        status: 'Pending',
        createdAt: Date.now(),
      };
      const docRef = await addDoc(collection(db, 'swapRequests'), data);
      const newSwap: SwapRequest = { ...data, id: docRef.id };

      // Remove this shift from the picker (now has a pending swap).
      setShifts((prev) => prev.filter((s) => s.id !== selectedShiftId));
      setMySwaps((prev) => [newSwap, ...prev]);
      setSelectedShiftId('');
      setSelectedReplacementId('');
      setSuccess('Swap request submitted.');
    } catch {
      setError('Failed to submit request. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Form */}
      <div className="rounded-xl border border-black/10 bg-white px-6 py-5 dark:border-white/10 dark:bg-zinc-950">
        <h2 className="mb-4 text-base font-semibold">Request Shift Swap</h2>

        {loadingData ? (
          <div className="flex justify-center py-8">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {/* Shift picker */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Shift to swap
              </label>
              <select
                value={selectedShiftId}
                onChange={(e) => handleShiftChange(e.target.value)}
                className="w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 dark:border-white/15 dark:bg-zinc-900"
              >
                <option value="">— Select a shift —</option>
                {shifts.map((shift) => (
                  <option key={shift.id} value={shift.id}>
                    {shift.date} · {shift.startTime}–{shift.endTime} · {shift.locationName}
                  </option>
                ))}
              </select>
              {shifts.length === 0 && (
                <p className="mt-1.5 text-xs text-zinc-400 dark:text-zinc-600">
                  No available shifts (all scheduled shifts already have a pending swap request).
                </p>
              )}
            </div>

            {/* Replacement employee picker */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Proposed replacement
              </label>
              <select
                value={selectedReplacementId}
                onChange={(e) => setSelectedReplacementId(e.target.value)}
                disabled={!selectedShiftId}
                className="w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/15 dark:bg-zinc-900"
              >
                <option value="">— Select an employee —</option>
                {eligibleReplacements.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.firstName} {emp.lastName} ({emp.primaryRole})
                  </option>
                ))}
              </select>
              {selectedShiftId && eligibleReplacements.length === 0 && (
                <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
                  No eligible employees for this location. Try a different shift.
                </p>
              )}
              {selectedShiftId && selectedShift && (
                <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-600">
                  Showing employees eligible for {selectedShift.locationName}.
                </p>
              )}
            </div>

            {/* AI swap matchmaker */}
            <div>
              <button
                type="button"
                onClick={handleSuggest}
                disabled={!selectedShiftId || suggesting}
                className="rounded-lg border border-violet-300 bg-violet-50 px-3 py-1.5 text-sm font-semibold text-violet-700 transition hover:bg-violet-100 disabled:opacity-50 dark:border-violet-900/50 dark:bg-violet-950/30 dark:text-violet-300 dark:hover:bg-violet-950/50"
              >
                {suggesting ? 'Finding best matches…' : '✨ Suggest best replacement'}
              </button>

              {suggestError && (
                <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                  {suggestError}
                </p>
              )}

              {suggestions && suggestions.length === 0 && (
                <p className="mt-2 text-sm text-zinc-400 dark:text-zinc-600">
                  No suitable replacements found for this shift.
                </p>
              )}

              {suggestions && suggestions.length > 0 && (
                <div className="mt-3 flex flex-col gap-2">
                  {suggestions.map((s) => {
                    const active = selectedReplacementId === s.employeeId;
                    return (
                      <button
                        key={s.employeeId}
                        type="button"
                        onClick={() => setSelectedReplacementId(s.employeeId)}
                        className={`rounded-xl border px-4 py-3 text-left transition ${
                          active
                            ? 'border-violet-500 bg-violet-50 ring-2 ring-violet-500/20 dark:border-violet-500 dark:bg-violet-950/30'
                            : 'border-black/10 bg-white hover:border-violet-300 dark:border-white/10 dark:bg-zinc-950 dark:hover:border-violet-700'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold">{s.name}</span>
                          <span className="text-xs text-zinc-500 dark:text-zinc-400">
                            {s.hoursThisWeek}h this week
                          </span>
                        </div>
                        <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">{s.reason}</p>
                        {s.warnings.length > 0 && (
                          <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                            ⚠ {s.warnings.join(' · ')}
                          </p>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                {error}
              </p>
            )}
            {success && (
              <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-400">
                {success}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting || !selectedShiftId || !selectedReplacementId}
              className="self-start rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-600 disabled:opacity-50"
            >
              {submitting ? 'Submitting…' : 'Submit swap request'}
            </button>
          </form>
        )}
      </div>

      {/* History */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-zinc-500 dark:text-zinc-400">
          Your swap requests
        </h3>
        {loadingData ? null : mySwaps.length === 0 ? (
          <p className="text-sm text-zinc-400 dark:text-zinc-600">No swap requests yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {mySwaps.map((req) => {
              const shift = allShiftsMap[req.shiftId];
              const replacement = employees.find((e) => e.id === req.toEmployeeId);
              return (
                <div
                  key={req.id}
                  className="flex items-start justify-between gap-4 rounded-xl border border-black/10 bg-white px-4 py-3 dark:border-white/10 dark:bg-zinc-950"
                >
                  <div>
                    <p className="text-sm font-medium">
                      {shift
                        ? `${shift.date} · ${shift.startTime}–${shift.endTime} · ${shift.locationName}`
                        : req.shiftId}
                    </p>
                    <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
                      Replacement:{' '}
                      {replacement
                        ? `${replacement.firstName} ${replacement.lastName}`
                        : req.toEmployeeId}
                    </p>
                  </div>
                  <StatusBadge status={req.status} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function RequestsPage() {
  const { employee } = useAuth();
  const [tab, setTab] = useState<Tab>('time-off');

  if (!employee) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Requests</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Submit time-off requests or propose shift swaps.
        </p>
      </div>

      {/* Tab bar */}
      <div className="mb-6 flex rounded-xl border border-black/10 bg-white p-1 dark:border-white/10 dark:bg-zinc-950">
        {(
          [
            { id: 'time-off', label: 'Time Off' },
            { id: 'swap', label: 'Shift Swap' },
          ] as { id: Tab; label: string }[]
        ).map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex-1 rounded-lg py-2 text-sm font-medium transition ${
              tab === id
                ? 'bg-sky-500 text-white shadow-sm'
                : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'time-off' && <TimeOffSection employeeId={employee.id} />}
      {tab === 'swap' && <SwapSection employeeId={employee.id} />}
    </main>
  );
}
