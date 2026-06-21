// Unit tests for the pure swap-candidate scoring. Runs on Node's built-in
// runner after the project's one-off transpile (see package.json `test`).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildSwapCandidates } from './swapMatch';
import type { Employee, Shift, TimeOffRequest } from './types';

function emp(over: Partial<Employee> & Pick<Employee, 'id' | 'firstName'>): Employee {
  return {
    lastName: 'X',
    primaryRole: 'Instructor',
    eligibleLocations: ['ARL'],
    avgWeeklyHours: 20,
    status: 'Active',
    appRole: 'employee',
    ...over,
  } as Employee;
}

function shift(over: Partial<Shift> & Pick<Shift, 'id' | 'employeeId'>): Shift {
  return {
    date: '2026-06-22',
    day: 'Monday',
    locationId: 'ARL',
    locationName: 'Arlington',
    shiftType: 'Pool Shift',
    role: 'Instructor',
    employeeName: 'Owner',
    startTime: '16:30',
    endTime: '20:30',
    scheduledHours: 4,
    status: 'Scheduled',
    ...over,
  };
}

const swapShift = shift({ id: 'S0', employeeId: 'OWNER' });

test('excludes the current owner and ineligible employees are non-viable', () => {
  const employees = [
    emp({ id: 'OWNER', firstName: 'Owner' }),
    emp({ id: 'E1', firstName: 'Eligible' }),
    emp({ id: 'E2', firstName: 'Wrong', eligibleLocations: ['GP'] }),
  ];
  const candidates = buildSwapCandidates(swapShift, employees, [], []);
  assert.equal(candidates.find((c) => c.employeeId === 'OWNER'), undefined);

  const e2 = candidates.find((c) => c.employeeId === 'E2')!;
  assert.equal(e2.eligible, false);
  assert.equal(e2.viable, false);

  const e1 = candidates.find((c) => c.employeeId === 'E1')!;
  assert.equal(e1.viable, true);
});

test('flags double-booking when candidate has an overlapping shift that day', () => {
  const employees = [emp({ id: 'E1', firstName: 'Busy' })];
  const weekShifts = [shift({ id: 'S1', employeeId: 'E1', startTime: '16:00', endTime: '20:00' })];
  const [c] = buildSwapCandidates(swapShift, employees, weekShifts, []);
  assert.equal(c.wouldDoubleBook, true);
  assert.equal(c.viable, false);
});

test('flags over-40h projection as a hard blocker', () => {
  const employees = [emp({ id: 'E1', firstName: 'Maxed', avgWeeklyHours: 40 })];
  // Existing 38h that week (different day so no overlap) + 4h swap = 42h.
  const weekShifts = [
    shift({ id: 'S1', employeeId: 'E1', date: '2026-06-23', startTime: '08:00', endTime: '22:00', scheduledHours: 38 }),
  ];
  const [c] = buildSwapCandidates(swapShift, employees, weekShifts, []);
  assert.equal(c.projectedWeekHours, 42);
  assert.equal(c.wouldExceed40, true);
  assert.equal(c.viable, false);
});

test('flags approved time-off covering the shift date', () => {
  const employees = [emp({ id: 'E1', firstName: 'Away' })];
  const timeOff: TimeOffRequest[] = [
    { id: 'T1', employeeId: 'E1', startDate: '2026-06-20', endDate: '2026-06-24', reason: 'PTO', status: 'Approved', createdAt: 0 },
  ];
  const [c] = buildSwapCandidates(swapShift, employees, [], timeOff);
  assert.equal(c.onApprovedTimeOff, true);
  assert.equal(c.viable, false);
});

test('sorts viable candidates ahead of non-viable ones', () => {
  const employees = [
    emp({ id: 'BAD', firstName: 'Bad', eligibleLocations: ['GP'] }),
    emp({ id: 'GOOD', firstName: 'Good' }),
  ];
  const candidates = buildSwapCandidates(swapShift, employees, [], []);
  assert.equal(candidates[0].employeeId, 'GOOD');
});
