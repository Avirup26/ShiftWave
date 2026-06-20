// Unit test for the payroll export's 40h Regular/Overtime split.
//
// The seed data never exceeds 40h/week (Overtime is 0 everywhere), so the real
// data cannot exercise this path. These tests use a synthetic >40h employee.
//
// No test framework is installed; this runs on Node's built-in runner after a
// one-off transpile with the project's existing `typescript` compiler:
//   npm test
// (see package.json — transpiles to .tmp-test/ then runs `node --test`).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildGustoRows, rowsToCsv } from './gusto';
import type { Employee, Punch } from './types';

function emp(id: string, firstName: string, lastName: string): Employee {
  return {
    id,
    firstName,
    lastName,
    primaryRole: 'Instructor',
    eligibleLocations: ['ARL'],
    avgWeeklyHours: 40,
    status: 'Active',
    appRole: 'employee',
  };
}

function punch(over: Partial<Punch> & Pick<Punch, 'id' | 'employeeId' | 'date' | 'clockIn' | 'clockOut'>): Punch {
  return {
    shiftId: `SH-${over.id}`,
    locationId: 'ARL',
    scheduledStart: over.clockIn!,
    scheduledEnd: over.clockOut!,
    clockInLat: null,
    clockInLng: null,
    geofenceStatus: 'Inside Geofence',
    clockInTimingStatus: 'On Time',
    managerReviewStatus: 'Approved',
    ...over,
  };
}

const employees = new Map<string, Employee>([
  ['OT001', emp('OT001', 'Sam', 'Overtime')],
  ['REG001', emp('REG001', 'Pat', 'Regular')],
]);

test('splits at 40h: five 9h days -> 40 regular + 5 overtime', () => {
  // Mon–Fri, 08:00–17:00 = 9h each = 45h total.
  const days = ['2026-06-22', '2026-06-23', '2026-06-24', '2026-06-25', '2026-06-26'];
  const punches = days.map((date, i) =>
    punch({ id: `P${i}`, employeeId: 'OT001', date, clockIn: '08:00', clockOut: '17:00' }),
  );

  const { rows } = buildGustoRows(punches, employees);

  assert.equal(rows.length, 5);

  const totalRegular = rows.reduce((s, r) => s + r.regularHours, 0);
  const totalOvertime = rows.reduce((s, r) => s + r.overtimeHours, 0);
  const totalHours = rows.reduce((s, r) => s + r.totalHours, 0);

  assert.equal(Math.round(totalRegular * 100) / 100, 40);
  assert.equal(Math.round(totalOvertime * 100) / 100, 5);
  assert.equal(Math.round(totalHours * 100) / 100, 45);

  // Per-row reconciliation: Regular + Overtime always equals displayed Total.
  for (const r of rows) {
    assert.equal(Math.round((r.regularHours + r.overtimeHours) * 100) / 100, r.totalHours);
  }

  // The first four days are fully regular; the fifth straddles the threshold.
  assert.deepEqual(
    rows.map((r) => [r.regularHours, r.overtimeHours]),
    [
      [9, 0],
      [9, 0],
      [9, 0],
      [9, 0],
      [4, 5],
    ],
  );
});

test('no drift with odd minutes: 30h + 11h30m -> 40 regular + 1.5 overtime', () => {
  const punches = [
    punch({ id: 'A', employeeId: 'OT001', date: '2026-06-22', clockIn: '06:00', clockOut: '12:00' }), // 6h
    // four more 6h punches to reach 30h then a long one
  ];
  // Build 30h via five 6h punches, then one 11h30m punch.
  for (let i = 1; i < 5; i++) {
    punches.push(
      punch({ id: `A${i}`, employeeId: 'OT001', date: `2026-06-2${2 + i}`, clockIn: '06:00', clockOut: '12:00' }),
    );
  }
  punches.push(
    punch({ id: 'BIG', employeeId: 'OT001', date: '2026-06-27', clockIn: '06:00', clockOut: '17:30' }), // 11.5h
  );

  const { rows } = buildGustoRows(punches, employees);
  const totalRegular = rows.reduce((s, r) => s + r.regularHours, 0);
  const totalOvertime = rows.reduce((s, r) => s + r.overtimeHours, 0);

  assert.equal(Math.round(totalRegular * 100) / 100, 40);
  assert.equal(Math.round(totalOvertime * 100) / 100, 1.5);

  const big = rows.find((r) => r.clockOut === '17:30')!;
  assert.equal(big.totalHours, 11.5);
  assert.equal(big.regularHours, 10); // 40 - 30 room
  assert.equal(big.overtimeHours, 1.5);
});

test('approval gate: only Approved punches with both clock times are exported', () => {
  const punches: Punch[] = [
    punch({ id: 'OK', employeeId: 'REG001', date: '2026-06-22', clockIn: '16:25', clockOut: '20:30' }),
    punch({
      id: 'FLAGGED',
      employeeId: 'REG001',
      date: '2026-06-23',
      clockIn: '16:30',
      clockOut: '20:30',
      managerReviewStatus: 'Needs Review',
    }),
    punch({
      id: 'NOOUT',
      employeeId: 'REG001',
      date: '2026-06-24',
      clockIn: '16:30',
      clockOut: null,
    }),
  ];

  const { rows, excluded } = buildGustoRows(punches, employees);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].totalHours, 4.08); // 16:25 -> 20:30 = 245min = 4.0833 -> 4.08
  assert.equal(rows[0].regularHours, 4.08);
  assert.equal(rows[0].overtimeHours, 0);
  assert.equal(rows[0].notes, 'Approved; Inside Geofence; On Time');

  assert.equal(excluded.length, 2);
  assert.deepEqual(
    excluded.map((e) => e.reason).sort(),
    ['Approved but missing clock-out', 'Needs Review'],
  );
});

test('csv escapes fields and emits the canonical header', () => {
  const punches = [
    punch({ id: 'OK', employeeId: 'REG001', date: '2026-06-22', clockIn: '16:25', clockOut: '20:30' }),
  ];
  const { rows } = buildGustoRows(punches, employees);
  const csv = rowsToCsv(rows);
  const lines = csv.split('\r\n');

  assert.equal(
    lines[0],
    'Employee ID,Employee Name,Date,Clock In,Clock Out,Total Hours,Location,Regular Hours,Overtime Hours,Notes',
  );
  assert.equal(lines[1], 'REG001,Pat Regular,2026-06-22,16:25,20:30,4.08,ARL,4.08,0,Approved; Inside Geofence; On Time');
});
