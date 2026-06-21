// Unit test for the .ics schedule export (RFC 5545 structure + line folding).
// Run via `npm test` — see gusto.test.ts header for how the test runner works.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildScheduleIcs, foldLine, toIcsLocal } from './ics';
import type { Shift } from './types';

function shift(over: Partial<Shift> & Pick<Shift, 'id' | 'date' | 'startTime' | 'endTime'>): Shift {
  return {
    day: 'Monday',
    locationId: 'ARL',
    locationName: 'Arlington',
    shiftType: 'Pool Shift',
    role: 'Instructor',
    employeeId: 'I001',
    employeeName: 'Avery Johnson',
    scheduledHours: 4,
    status: 'Scheduled',
    ...over,
  };
}

test('toIcsLocal formats date + time as floating local timestamp', () => {
  assert.equal(toIcsLocal('2026-06-22', '16:30'), '20260622T163000');
  assert.equal(toIcsLocal('2026-01-05', '08:00'), '20260105T080000');
});

test('foldLine leaves short lines untouched and wraps long lines at 75 octets with a leading space', () => {
  const short = 'SUMMARY:Instructor @ Arlington';
  assert.equal(foldLine(short), short);

  const long = 'DESCRIPTION:' + 'x'.repeat(100);
  const folded = foldLine(long);
  const parts = folded.split('\r\n');
  assert.equal(parts.length, 2);
  assert.equal(parts[0].length, 75);
  assert.ok(parts[1].startsWith(' '));
});

test('buildScheduleIcs emits a valid VCALENDAR with one VEVENT per shift, sorted chronologically', () => {
  const shifts: Shift[] = [
    shift({ id: 'S2', date: '2026-06-24', startTime: '17:00', endTime: '21:00', locationName: 'Mansfield' }),
    shift({ id: 'S1', date: '2026-06-22', startTime: '16:30', endTime: '20:30', locationName: 'Arlington' }),
  ];

  const ics = buildScheduleIcs(shifts, 'Avery Johnson');

  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.trimEnd().endsWith('END:VCALENDAR'));
  assert.ok(ics.includes('BEGIN:VTIMEZONE'));
  assert.ok(ics.includes('TZID:America/Chicago'));

  const events = ics.split('BEGIN:VEVENT').slice(1);
  assert.equal(events.length, 2);

  // Sorted: S1 (06-22) appears before S2 (06-24).
  const s1Index = ics.indexOf('UID:S1@shiftwave');
  const s2Index = ics.indexOf('UID:S2@shiftwave');
  assert.ok(s1Index < s2Index);

  assert.ok(ics.includes('DTSTART;TZID=America/Chicago:20260622T163000'));
  assert.ok(ics.includes('DTEND;TZID=America/Chicago:20260622T203000'));
  assert.ok(ics.includes('SUMMARY:Instructor @ Arlington'));
  assert.ok(ics.includes('STATUS:CONFIRMED'));
});

test('buildScheduleIcs marks Draft shifts as TENTATIVE and escapes calendar name', () => {
  const shifts: Shift[] = [shift({ id: 'S1', date: '2026-06-22', startTime: '16:30', endTime: '20:30', status: 'Draft' })];
  const ics = buildScheduleIcs(shifts, 'Avery Johnson');
  assert.ok(ics.includes('STATUS:TENTATIVE'));
  assert.ok(ics.includes('X-WR-CALNAME:Avery Johnson — ShiftWave Schedule'));
});
