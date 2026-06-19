'use client';

import { useEffect, useRef, useState } from 'react';
import {
  doc,
  getDocs,
  onSnapshot,
  query,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '@/lib/firebase.client';
import { collections } from '@/lib/firestore';
import { haversineDistanceMeters } from '@/lib/geofence';
import { GEOFENCE } from '@/lib/constants';
import type { Employee, GeofenceStatus, Location, Punch, Shift } from '@/lib/types';

// ---------------------------------------------------------------------------
// Enriched type
// ---------------------------------------------------------------------------

type EnrichedPunch = Punch & {
  employee: Employee | null;
  shift: Shift | null;
  location: Location | null;
  distanceFt: number | null; // null when No Geofence or coords missing
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getFlagReasons(punch: Punch): string {
  const reasons: string[] = [];
  if (punch.geofenceStatus === 'Outside Geofence') reasons.push('Outside Geofence');
  if (punch.geofenceStatus === 'Location Error') reasons.push('Location Error (geofence check failed)');
  if (punch.clockInTimingStatus === 'Outside Window') reasons.push('Outside Window');
  return reasons.join(' + ') || 'Unknown';
}

function computeDistanceFt(punch: Punch, location: Location | null): number | null {
  // Only show distance when geofence was evaluated with real coords.
  // 'No Geofence' = ungeofenced location; 'Location Error' = coords unavailable.
  if (punch.geofenceStatus === 'No Geofence' || punch.geofenceStatus === 'Location Error') return null;
  if (!location || location.lat === null || location.lng === null) return null;
  if (punch.clockInLat === null || punch.clockInLng === null) return null;
  const meters = haversineDistanceMeters(
    punch.clockInLat,
    punch.clockInLng,
    location.lat,
    location.lng,
  );
  return Math.round(meters / GEOFENCE.feetToMeters);
}

function formatTime(hhmm: string | null): string {
  if (!hhmm) return '—';
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

function formatDate(iso: string): string {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Badge sub-components
// ---------------------------------------------------------------------------

function GeofenceBadge({ status }: { status: GeofenceStatus }) {
  if (status === 'Inside Geofence') {
    return (
      <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
        Inside Geofence
      </span>
    );
  }
  if (status === 'Outside Geofence') {
    return (
      <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
        Outside Geofence
      </span>
    );
  }
  if (status === 'Location Error') {
    return (
      <span className="inline-flex items-center rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
        Location Error
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
      No Geofence
    </span>
  );
}

function TimingBadge({ status }: { status: 'On Time' | 'Outside Window' }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        status === 'On Time'
          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
          : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
      }`}
    >
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Row sub-component
// ---------------------------------------------------------------------------

interface PunchRowProps {
  punch: EnrichedPunch;
  onApprove: (punch: EnrichedPunch) => void;
  onReject: (punch: EnrichedPunch, reason: string) => void;
  isPending: boolean;
}

function PunchRow({ punch, onApprove, onReject, isPending }: PunchRowProps) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const empName = punch.employee
    ? `${punch.employee.firstName} ${punch.employee.lastName}`
    : punch.employeeId;

  const shiftLabel = punch.shift
    ? `${punch.shift.locationName} · ${punch.shift.shiftType}`
    : punch.locationId;

  const distLabel =
    punch.distanceFt !== null ? `${punch.distanceFt.toLocaleString()} ft` : '—';

  const labelCls =
    'text-xs font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-600';
  const valueCls = 'mt-0.5 text-sm';

  function handleRejectOpen() {
    setRejectOpen(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function handleRejectConfirm() {
    onReject(punch, reason.trim());
    setRejectOpen(false);
    setReason('');
  }

  function handleRejectCancel() {
    setRejectOpen(false);
    setReason('');
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-black/10 bg-white px-5 py-4 dark:border-white/10 dark:bg-zinc-950">
      {/* Top row: employee + location context */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold">{empName}</p>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{shiftLabel}</p>
      </div>

      {/* Detail grid */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
        <div>
          <p className={labelCls}>Date</p>
          <p className={valueCls}>{formatDate(punch.date)}</p>
        </div>

        <div>
          <p className={labelCls}>Scheduled</p>
          <p className={valueCls}>
            {formatTime(punch.scheduledStart)}–{formatTime(punch.scheduledEnd)}
          </p>
        </div>

        <div>
          <p className={labelCls}>Actual clock-in</p>
          <p className={valueCls}>{formatTime(punch.clockIn)}</p>
        </div>

        <div>
          <p className={labelCls}>Clock-out</p>
          <p className={valueCls}>{formatTime(punch.clockOut)}</p>
        </div>

        <div>
          <p className={labelCls}>Geofence</p>
          <div className="mt-1">
            <GeofenceBadge status={punch.geofenceStatus} />
          </div>
        </div>

        <div>
          <p className={labelCls}>Timing</p>
          <div className="mt-1">
            <TimingBadge status={punch.clockInTimingStatus} />
          </div>
        </div>

        <div>
          <p className={labelCls}>Distance from site</p>
          <p className={valueCls}>{distLabel}</p>
        </div>

        <div>
          <p className={labelCls}>Flag reason</p>
          <p className={`${valueCls} font-medium text-red-600 dark:text-red-400`}>
            {getFlagReasons(punch)}
          </p>
        </div>
      </div>

      {/* Action area */}
      {!rejectOpen ? (
        <div className="flex items-center gap-2 border-t border-black/8 pt-3 dark:border-white/8">
          <button
            onClick={() => onApprove(punch)}
            disabled={isPending}
            className="rounded-lg bg-green-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-green-700 disabled:opacity-50"
          >
            Approve
          </button>
          <button
            onClick={handleRejectOpen}
            disabled={isPending}
            className="rounded-lg border border-black/10 px-4 py-1.5 text-sm font-medium transition hover:bg-red-50 hover:text-red-700 disabled:opacity-50 dark:border-white/10 dark:hover:bg-red-900/20 dark:hover:text-red-400"
          >
            Reject
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 border-t border-black/8 pt-3 dark:border-white/8">
          <input
            ref={inputRef}
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRejectConfirm();
              if (e.key === 'Escape') handleRejectCancel();
            }}
            placeholder="Reason (optional)"
            className="w-full rounded-lg border border-black/10 bg-transparent px-3 py-1.5 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-red-400 dark:border-white/10 dark:placeholder:text-zinc-600"
          />
          <div className="flex gap-2">
            <button
              onClick={handleRejectConfirm}
              disabled={isPending}
              className="rounded-lg bg-red-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
            >
              Confirm Reject
            </button>
            <button
              onClick={handleRejectCancel}
              className="rounded-lg border border-black/10 px-4 py-1.5 text-sm font-medium transition hover:bg-zinc-100 dark:border-white/10 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ReviewQueuePage() {
  const [punches, setPunches] = useState<EnrichedPunch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  // Lookup maps loaded once on mount
  const empMapRef = useRef<Map<string, Employee>>(new Map());
  const locMapRef = useRef<Map<string, Location>>(new Map());
  const shiftMapRef = useRef<Map<string, Shift>>(new Map());
  const lookupsReady = useRef(false);

  function enrich(punch: Punch): EnrichedPunch {
    const location = locMapRef.current.get(punch.locationId) ?? null;
    return {
      ...punch,
      employee: empMapRef.current.get(punch.employeeId) ?? null,
      shift: shiftMapRef.current.get(punch.shiftId) ?? null,
      location,
      distanceFt: computeDistanceFt(punch, location),
    };
  }

  useEffect(() => {
    // Load lookup collections once, then set up the real-time listener.
    let unsubscribe: () => void;

    async function init() {
      try {
        const [empSnap, locSnap, shiftSnap] = await Promise.all([
          getDocs(collections.employees()),
          getDocs(collections.locations()),
          getDocs(collections.shifts()),
        ]);

        empSnap.docs.forEach((d) => empMapRef.current.set(d.data().id, d.data()));
        locSnap.docs.forEach((d) => locMapRef.current.set(d.data().id, d.data()));
        shiftSnap.docs.forEach((d) => shiftMapRef.current.set(d.data().id, d.data()));
        lookupsReady.current = true;

        const q = query(
          collections.punches(),
          where('managerReviewStatus', '==', 'Needs Review'),
        );

        unsubscribe = onSnapshot(
          q,
          (snap) => {
            const enriched = snap.docs
              .map((d) => enrich(d.data()))
              .sort((a, b) => a.date.localeCompare(b.date));
            setPunches(enriched);
            setLoading(false);
          },
          (err) => {
            setError(err.message);
            setLoading(false);
          },
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
        setLoading(false);
      }
    }

    init();
    return () => unsubscribe?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  async function handleApprove(punch: EnrichedPunch) {
    setPendingIds((prev) => new Set(prev).add(punch.id));
    // Optimistic remove
    setPunches((prev) => prev.filter((p) => p.id !== punch.id));
    try {
      await updateDoc(doc(db, 'punches', punch.id), {
        managerReviewStatus: 'Approved',
      });
    } catch (err) {
      // Revert on failure
      setPunches((prev) => [punch, ...prev].sort((a, b) => a.date.localeCompare(b.date)));
      setError(err instanceof Error ? err.message : 'Failed to approve punch');
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(punch.id);
        return next;
      });
    }
  }

  async function handleReject(punch: EnrichedPunch, reason: string) {
    setPendingIds((prev) => new Set(prev).add(punch.id));
    // Optimistic remove
    setPunches((prev) => prev.filter((p) => p.id !== punch.id));
    try {
      const update: { managerReviewStatus: string; rejectReason?: string } = {
        managerReviewStatus: 'Rejected',
      };
      if (reason) update.rejectReason = reason;
      await updateDoc(doc(db, 'punches', punch.id), update);
    } catch (err) {
      // Revert on failure
      setPunches((prev) => [punch, ...prev].sort((a, b) => a.date.localeCompare(b.date)));
      setError(err instanceof Error ? err.message : 'Failed to reject punch');
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(punch.id);
        return next;
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Punch Review Queue</h1>
        <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
          Flagged punches that need your review — outside geofence or outside the
          on-time window.
        </p>
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

      {/* Empty state */}
      {!loading && !error && punches.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-black/10 px-6 py-16 text-center dark:border-white/10">
          <span className="text-3xl" aria-hidden>
            ✓
          </span>
          <p className="font-medium">All punches are up to date</p>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No flagged punches waiting for review.
          </p>
        </div>
      )}

      {/* Queue */}
      {!loading && punches.length > 0 && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {punches.length} punch{punches.length !== 1 ? 'es' : ''} need review
          </p>
          {punches.map((punch) => (
            <PunchRow
              key={punch.id}
              punch={punch}
              isPending={pendingIds.has(punch.id)}
              onApprove={handleApprove}
              onReject={handleReject}
            />
          ))}
        </div>
      )}
    </main>
  );
}
