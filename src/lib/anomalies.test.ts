// Unit tests for the pure anomaly heuristics. Runs on Node's built-in runner
// after the project's one-off transpile (see package.json `test`).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeAnomalySignals } from './anomalies';
import type { Employee, Location, Punch } from './types';

function emp(id: string, first: string, last: string): Employee {
  return {
    id,
    firstName: first,
    lastName: last,
    primaryRole: 'Instructor',
    eligibleLocations: ['ARL'],
    avgWeeklyHours: 20,
    status: 'Active',
    appRole: 'employee',
  };
}

function punch(over: Partial<Punch> & Pick<Punch, 'id' | 'employeeId' | 'date' | 'clockIn'>): Punch {
  return {
    shiftId: `SH-${over.id}`,
    locationId: 'ARL',
    scheduledStart: '08:00',
    scheduledEnd: '12:00',
    clockOut: '12:00',
    clockInLat: null,
    clockInLng: null,
    geofenceStatus: 'Inside Geofence',
    clockInTimingStatus: 'On Time',
    managerReviewStatus: 'Approved',
    ...over,
  };
}

const employees = [emp('E1', 'Ann', 'Ant'), emp('E2', 'Bob', 'Bee'), emp('E3', 'Cyn', 'Cee')];
const locations: Location[] = [
  { id: 'ARL', name: 'Arlington', type: 'Swim School', address: '', lat: null, lng: null, geofenceRadiusFt: 200, geofenceRequired: true },
];

test('counts geofence violations and rate per employee', () => {
  const punches = [
    punch({ id: 'P1', employeeId: 'E1', date: '2026-06-22', clockIn: '08:00', geofenceStatus: 'Outside Geofence' }),
    punch({ id: 'P2', employeeId: 'E1', date: '2026-06-23', clockIn: '08:00', geofenceStatus: 'Inside Geofence' }),
  ];
  const { perEmployee } = computeAnomalySignals(punches, employees, locations);
  const e1 = perEmployee.find((s) => s.employeeId === 'E1')!;
  assert.equal(e1.geofenceViolations, 1);
  assert.equal(e1.geofenceViolationRate, 0.5);
});

test('detects a buddy-punch cluster: 2+ staff, same site/day, outside geofence, within 3 min', () => {
  const punches = [
    punch({ id: 'P1', employeeId: 'E1', date: '2026-06-22', clockIn: '08:00', geofenceStatus: 'Outside Geofence' }),
    punch({ id: 'P2', employeeId: 'E2', date: '2026-06-22', clockIn: '08:02', geofenceStatus: 'Outside Geofence' }),
  ];
  const { buddyClusters, perEmployee } = computeAnomalySignals(punches, employees, locations);
  assert.equal(buddyClusters.length, 1);
  assert.deepEqual(buddyClusters[0].employeeIds.sort(), ['E1', 'E2']);
  assert.equal(perEmployee.find((s) => s.employeeId === 'E1')!.buddyPunchEvents, 1);
});

test('does NOT cluster when clock-ins are far apart', () => {
  const punches = [
    punch({ id: 'P1', employeeId: 'E1', date: '2026-06-22', clockIn: '08:00', geofenceStatus: 'Outside Geofence' }),
    punch({ id: 'P2', employeeId: 'E2', date: '2026-06-22', clockIn: '08:30', geofenceStatus: 'Outside Geofence' }),
  ];
  const { buddyClusters } = computeAnomalySignals(punches, employees, locations);
  assert.equal(buddyClusters.length, 0);
});

test('flags chronic early clock-ins beyond the on-time window', () => {
  // scheduledStart 08:00; clocking in 08:00 - 20min = 07:40 is >5min early.
  const punches = [
    punch({ id: 'P1', employeeId: 'E3', date: '2026-06-22', clockIn: '07:40' }),
  ];
  const { perEmployee } = computeAnomalySignals(punches, employees, locations);
  const e3 = perEmployee.find((s) => s.employeeId === 'E3')!;
  assert.equal(e3.earlyClockInCount, 1);
  assert.equal(e3.avgClockInDeltaMin, -20);
});
