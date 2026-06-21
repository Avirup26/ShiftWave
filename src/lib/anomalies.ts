// Pure timekeeping-anomaly heuristics — no Firebase / React imports (same
// contract as validators.ts / gusto.ts). Computes grounded signals from punch
// data; the /api/punch-anomalies route feeds these to Gemini so it can rank +
// explain anomalies without hallucinating the underlying numbers.

import { GEOFENCE } from './constants';
import { haversineDistanceMeters } from './geofence';
import { minutesSinceMidnight } from './weekHelpers';
import type { Employee, Location, Punch, Shift } from './types';

const VIOLATION_STATUSES = new Set(['Outside Geofence', 'Location Error']);
// Punches clocking in within this many minutes of each other (same site/day,
// all outside the geofence) look like one person punching for several.
const BUDDY_WINDOW_MIN = 3;

export interface EmployeeSignals {
  employeeId: string;
  employeeName: string;
  punchCount: number;
  geofenceViolations: number;
  geofenceViolationRate: number; // 0..1
  outsideWindowCount: number;
  /** Average signed clock-in delta vs scheduled start: + late, − early. */
  avgClockInDeltaMin: number;
  /** Clock-ins more than the on-time window EARLY (possible hour padding). */
  earlyClockInCount: number;
  maxDistanceFt: number | null;
  /** How many buddy-punch clusters this employee appeared in. */
  buddyPunchEvents: number;
}

export interface BuddyCluster {
  locationId: string;
  date: string;
  clockIn: string; // earliest clock-in in the cluster
  employeeIds: string[];
  employeeNames: string[];
}

export interface AnomalySignals {
  perEmployee: EmployeeSignals[];
  buddyClusters: BuddyCluster[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Distance in feet from the punch coords to its site, or null when N/A. */
function distanceFt(punch: Punch, location: Location | undefined): number | null {
  if (punch.geofenceStatus === 'No Geofence' || punch.geofenceStatus === 'Location Error') {
    return null;
  }
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

/**
 * Compute per-employee anomaly signals + cross-employee buddy-punch clusters.
 * Deterministic and pure — unit-testable without Firebase or Gemini.
 */
export function computeAnomalySignals(
  punches: Punch[],
  employees: Employee[],
  locations: Location[],
): AnomalySignals {
  const empById = new Map(employees.map((e) => [e.id, e]));
  const locById = new Map(locations.map((l) => [l.id, l]));
  const nameOf = (id: string) => {
    const e = empById.get(id);
    return e ? `${e.firstName} ${e.lastName}` : id;
  };

  // --- Buddy-punch clusters: same location+date, all outside geofence,
  //     clock-ins within BUDDY_WINDOW_MIN, ≥2 distinct employees. ---
  const buddyClusters: BuddyCluster[] = [];
  const byLocDay = new Map<string, Punch[]>();
  for (const p of punches) {
    if (!p.clockIn || !VIOLATION_STATUSES.has(p.geofenceStatus)) continue;
    const key = `${p.locationId}|${p.date}`;
    const list = byLocDay.get(key) ?? [];
    list.push(p);
    byLocDay.set(key, list);
  }
  const buddyEventCount = new Map<string, number>(); // employeeId → cluster count
  for (const [key, group] of byLocDay) {
    if (group.length < 2) continue;
    const [locationId, date] = key.split('|');
    const sorted = [...group].sort(
      (a, b) => minutesSinceMidnight(a.clockIn!) - minutesSinceMidnight(b.clockIn!),
    );
    let i = 0;
    while (i < sorted.length) {
      const startMin = minutesSinceMidnight(sorted[i].clockIn!);
      const cluster = [sorted[i]];
      let j = i + 1;
      while (
        j < sorted.length &&
        minutesSinceMidnight(sorted[j].clockIn!) - startMin <= BUDDY_WINDOW_MIN
      ) {
        cluster.push(sorted[j]);
        j++;
      }
      const empIds = Array.from(new Set(cluster.map((p) => p.employeeId)));
      if (empIds.length >= 2) {
        buddyClusters.push({
          locationId,
          date,
          clockIn: sorted[i].clockIn!,
          employeeIds: empIds,
          employeeNames: empIds.map(nameOf),
        });
        for (const id of empIds) {
          buddyEventCount.set(id, (buddyEventCount.get(id) ?? 0) + 1);
        }
      }
      i = j > i + 1 ? j : i + 1;
    }
  }

  // --- Per-employee signals ---
  const byEmp = new Map<string, Punch[]>();
  for (const p of punches) {
    const list = byEmp.get(p.employeeId) ?? [];
    list.push(p);
    byEmp.set(p.employeeId, list);
  }

  const perEmployee: EmployeeSignals[] = [];
  for (const [employeeId, empPunches] of byEmp) {
    let violations = 0;
    let outsideWindow = 0;
    let deltaSum = 0;
    let deltaCount = 0;
    let earlyCount = 0;
    let maxDist: number | null = null;

    for (const p of empPunches) {
      if (VIOLATION_STATUSES.has(p.geofenceStatus)) violations++;
      if (p.clockInTimingStatus === 'Outside Window') outsideWindow++;
      if (p.clockIn && p.scheduledStart) {
        const delta = minutesSinceMidnight(p.clockIn) - minutesSinceMidnight(p.scheduledStart);
        deltaSum += delta;
        deltaCount++;
        if (delta < -GEOFENCE.onTimeWindowMinutes) earlyCount++;
      }
      const d = distanceFt(p, locById.get(p.locationId));
      if (d !== null) maxDist = maxDist === null ? d : Math.max(maxDist, d);
    }

    perEmployee.push({
      employeeId,
      employeeName: nameOf(employeeId),
      punchCount: empPunches.length,
      geofenceViolations: violations,
      geofenceViolationRate: empPunches.length ? round2(violations / empPunches.length) : 0,
      outsideWindowCount: outsideWindow,
      avgClockInDeltaMin: deltaCount ? round2(deltaSum / deltaCount) : 0,
      earlyClockInCount: earlyCount,
      maxDistanceFt: maxDist,
      buddyPunchEvents: buddyEventCount.get(employeeId) ?? 0,
    });
  }

  // Stable, signal-heavy first ordering (helps the model + tests).
  perEmployee.sort(
    (a, b) =>
      b.geofenceViolations - a.geofenceViolations ||
      b.buddyPunchEvents - a.buddyPunchEvents ||
      a.employeeId.localeCompare(b.employeeId),
  );

  return { perEmployee, buddyClusters };
}
