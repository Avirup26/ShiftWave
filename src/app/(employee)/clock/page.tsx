'use client';

import { useEffect, useState } from 'react';
import {
  query,
  where,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  doc,
  collection,
} from 'firebase/firestore';
import { db } from '@/lib/firebase.client';
import { collections } from '@/lib/firestore';
import { useAuth } from '@/lib/auth';
import {
  computeGeofenceStatus,
  computeTimingStatus,
  nowCentralHHMM,
  todayCentral,
} from '@/lib/geofence';
import { DEMO_DATE } from '@/lib/constants';
import type { GeofenceStatus, Location, Punch, Shift, TimingStatus } from '@/lib/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ShiftState =
  | { kind: 'idle' }
  | { kind: 'clocked-in'; punch: Punch }
  | { kind: 'completed'; punch: Punch };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the Monday (ISO) of the week that contains the given ISO date. */
function weekStart(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toLocaleDateString('en-CA');
}

/** Returns the Sunday (ISO) of the week that starts on the given Monday. */
function weekEnd(mondayISO: string): string {
  const d = new Date(mondayISO + 'T00:00:00');
  d.setDate(d.getDate() + 6);
  return d.toLocaleDateString('en-CA');
}

function GeofenceBadge({ status }: { status: GeofenceStatus }) {
  const styles: Record<GeofenceStatus, string> = {
    'Inside Geofence': 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400',
    'Outside Geofence': 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400',
    'No Geofence': 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
    'Location Error': 'bg-orange-50 text-orange-700 dark:bg-orange-900/20 dark:text-orange-400',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
      {status}
    </span>
  );
}

function TimingBadge({ status }: { status: TimingStatus }) {
  const styles: Record<TimingStatus, string> = {
    'On Time': 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400',
    'Outside Window': 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400',
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

export default function ClockPage() {
  const { employee } = useAuth();

  const [shifts, setShifts] = useState<Shift[]>([]);
  const [punchMap, setPunchMap] = useState<Record<string, Punch>>({});
  const [locationMap, setLocationMap] = useState<Record<string, Location>>({});
  const [loadingData, setLoadingData] = useState(true);
  const [actionShiftId, setActionShiftId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('');

  // Show the demo week so seeded shifts are always visible regardless of today.
  const monday = weekStart(DEMO_DATE);
  const sunday = weekEnd(monday);

  useEffect(() => {
    if (!employee) return;

    async function load() {
      // Load all Scheduled shifts for this employee.
      const shiftSnap = await getDocs(
        query(
          collections.shifts(),
          where('employeeId', '==', employee!.id),
          where('status', '==', 'Scheduled'),
        ),
      );
      const allShifts = shiftSnap.docs.map((d) => d.data());

      // Filter to demo week.
      const weekShifts = allShifts
        .filter((s) => s.date >= monday && s.date <= sunday)
        .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));

      setShifts(weekShifts);

      // Load existing punches for these shifts.
      if (weekShifts.length > 0) {
        const shiftIds = weekShifts.map((s) => s.id);
        const punchSnap = await getDocs(
          query(
            collections.punches(),
            where('employeeId', '==', employee!.id),
          ),
        );
        const map: Record<string, Punch> = {};
        for (const d of punchSnap.docs) {
          const p = d.data();
          if (shiftIds.includes(p.shiftId)) {
            map[p.shiftId] = p;
          }
        }
        setPunchMap(map);
      }

      // Load all locations into a map.
      const locSnap = await getDocs(collections.locations());
      const locs: Record<string, Location> = {};
      for (const d of locSnap.docs) {
        locs[d.data().id] = d.data();
      }
      setLocationMap(locs);

      setLoadingData(false);
    }

    load();
  }, [employee, monday, sunday]);

  // -------------------------------------------------------------------------
  // Clock in
  // -------------------------------------------------------------------------

  async function handleClockIn(shift: Shift) {
    if (!employee) return;
    setActionShiftId(shift.id);
    setStatusMessage('');

    const location = locationMap[shift.locationId];
    const clockInTime = nowCentralHHMM();
    const date = todayCentral();

    let geofenceStatus: GeofenceStatus = 'No Geofence';
    let clockInLat: number | null = null;
    let clockInLng: number | null = null;

    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10_000,
        });
      });
      clockInLat = pos.coords.latitude;
      clockInLng = pos.coords.longitude;
      if (location) {
        geofenceStatus = computeGeofenceStatus(clockInLat, clockInLng, location);
      }
    } catch {
      // getCurrentPosition failed (denied, timeout, unavailable).
      // If this location requires a geofence check, use 'Location Error' so
      // the punch is always flagged for review — never auto-approved.
      // If the location genuinely has no geofence requirement, fall through to
      // the existing 'No Geofence' default.
      if (location?.geofenceRequired) {
        geofenceStatus = 'Location Error';
      }
      setStatusMessage('Location unavailable — punch recorded and flagged for review.');
    }

    const clockInTimingStatus: TimingStatus = computeTimingStatus(
      clockInTime,
      shift.startTime,
    );

    const needsReview =
      geofenceStatus === 'Outside Geofence' ||
      geofenceStatus === 'Location Error' ||
      clockInTimingStatus === 'Outside Window';

    const punchData: Omit<Punch, 'id'> = {
      shiftId: shift.id,
      employeeId: employee.id,
      date,
      locationId: shift.locationId,
      scheduledStart: shift.startTime,
      scheduledEnd: shift.endTime,
      clockIn: clockInTime,
      clockOut: null,
      clockInLat,
      clockInLng,
      geofenceStatus,
      clockInTimingStatus,
      managerReviewStatus: 'Needs Review',
    };

    const docRef = await addDoc(collection(db, 'punches'), punchData);
    // Mirror the auto-generated Firestore ID into the id field.
    await updateDoc(docRef, { id: docRef.id });

    const newPunch: Punch = { ...punchData, id: docRef.id };
    setPunchMap((prev) => ({ ...prev, [shift.id]: newPunch }));

    if (!statusMessage) {
      setStatusMessage(
        needsReview
          ? 'Clocked in — punch flagged for manager review.'
          : 'Clocked in — pending manager approval.',
      );
    }
    setActionShiftId(null);
  }

  // -------------------------------------------------------------------------
  // Clock out
  // -------------------------------------------------------------------------

  async function handleClockOut(shift: Shift) {
    const punch = punchMap[shift.id];
    if (!punch) return;
    setActionShiftId(shift.id);
    setStatusMessage('');

    const clockOutTime = nowCentralHHMM();

    // Find the Firestore doc by querying on id field (auto-ID was mirrored into id).
    const punchSnap = await getDocs(
      query(collection(db, 'punches'), where('id', '==', punch.id)),
    );
    if (!punchSnap.empty) {
      await updateDoc(punchSnap.docs[0].ref, { clockOut: clockOutTime });
    }

    setPunchMap((prev) => ({
      ...prev,
      [shift.id]: { ...punch, clockOut: clockOutTime },
    }));
    setStatusMessage('Clocked out successfully.');
    setActionShiftId(null);
  }

  // -------------------------------------------------------------------------
  // Derive per-shift state
  // -------------------------------------------------------------------------

  function shiftState(shift: Shift): ShiftState {
    const punch = punchMap[shift.id];
    if (!punch) return { kind: 'idle' };
    if (punch.clockIn && punch.clockOut) return { kind: 'completed', punch };
    return { kind: 'clocked-in', punch };
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Clock In / Out</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Showing shifts for the demo week (June 22–28, 2026). Select a shift to clock in.
        </p>
      </div>

      {statusMessage && (
        <div className="mb-4 rounded-lg bg-sky-50 px-4 py-3 text-sm text-sky-700 dark:bg-sky-900/20 dark:text-sky-300">
          {statusMessage}
        </div>
      )}

      {loadingData ? (
        <div className="flex justify-center py-20">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
        </div>
      ) : shifts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-black/10 px-6 py-10 text-center text-sm text-zinc-400 dark:border-white/10 dark:text-zinc-600">
          No scheduled shifts for the demo week.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {shifts.map((shift) => {
            const state = shiftState(shift);
            const isActing = actionShiftId === shift.id;
            const location = locationMap[shift.locationId];

            return (
              <div
                key={shift.id}
                className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-950"
              >
                {/* Shift info */}
                <div className="mb-3 flex items-start justify-between gap-4">
                  <div>
                    <p className="font-medium">{shift.locationName}</p>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                      {shift.date} · {shift.startTime}–{shift.endTime} · {shift.role}
                    </p>
                    {location && (
                      <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-600">
                        {location.address}
                      </p>
                    )}
                  </div>
                  {state.kind === 'completed' && (
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                      Completed
                    </span>
                  )}
                </div>

                {/* Punch details (clocked-in or completed) */}
                {state.kind !== 'idle' && (
                  <div className="mb-3 flex flex-wrap gap-2">
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                      In: {state.punch.clockIn}
                      {state.punch.clockOut ? ` · Out: ${state.punch.clockOut}` : ''}
                    </span>
                    <GeofenceBadge status={state.punch.geofenceStatus} />
                    <TimingBadge status={state.punch.clockInTimingStatus} />
                    {state.punch.managerReviewStatus === 'Needs Review' && (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
                        Needs Review
                      </span>
                    )}
                    {state.punch.managerReviewStatus === 'Approved' && (
                      <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/20 dark:text-green-400">
                        Approved
                      </span>
                    )}
                  </div>
                )}

                {/* Actions */}
                {state.kind === 'idle' && (
                  <button
                    onClick={() => handleClockIn(shift)}
                    disabled={isActing}
                    className="flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-600 disabled:opacity-50"
                  >
                    {isActing && (
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden />
                    )}
                    Clock In
                  </button>
                )}

                {state.kind === 'clocked-in' && (
                  <button
                    onClick={() => handleClockOut(shift)}
                    disabled={isActing}
                    className="flex items-center gap-2 rounded-lg bg-zinc-800 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-zinc-300"
                  >
                    {isActing && (
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
                    )}
                    Clock Out
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
