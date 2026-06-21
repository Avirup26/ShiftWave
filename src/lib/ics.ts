// Pure .ics (iCalendar, RFC 5545) builder for the employee schedule export —
// no Firebase/React imports, same contract as gusto.ts / validators.ts.
// Produces a file that imports cleanly into Google Calendar, Apple Calendar,
// or Outlook: "File > Import" or double-click. No OAuth, no Calendar API —
// one-way export only.

import type { Shift } from './types';

// Standard US Central VTIMEZONE block (DST: 2nd Sunday in March → 1st Sunday
// in November), paired with every DTSTART/DTEND so floating shift times
// ('16:30') resolve to the correct wall-clock time regardless of the
// importing calendar's own timezone — matches the app-wide assumption that
// all shift times are local to America/Chicago.
const VTIMEZONE_CHICAGO = [
  'BEGIN:VTIMEZONE',
  'TZID:America/Chicago',
  'X-LIC-LOCATION:America/Chicago',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:-0600',
  'TZOFFSETTO:-0500',
  'TZNAME:CDT',
  'DTSTART:19700308T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:-0500',
  'TZOFFSETTO:-0600',
  'TZNAME:CST',
  'DTSTART:19701101T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** 'YYYY-MM-DD' + 'HH:MM' -> 'YYYYMMDDTHHMMSS' (floating time, paired with TZID). */
export function toIcsLocal(date: string, time: string): string {
  const [y, m, d] = date.split('-');
  const [h, min] = time.split(':');
  return `${y}${m}${d}T${pad(Number(h))}${pad(Number(min))}00`;
}

function nowUtcStamp(): string {
  const d = new Date();
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

// RFC 5545: content lines must not exceed 75 octets; continuations start
// with a single space. ASCII-only content here, so .length == octet count.
export function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let rest = line;
  while (rest.length > 75) {
    parts.push(rest.slice(0, 75));
    rest = ' ' + rest.slice(75);
  }
  parts.push(rest);
  return parts.join('\r\n');
}

function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, '\\n');
}

/**
 * Builds an .ics calendar of `shifts` (caller filters out Cancelled shifts).
 * Sorted chronologically; one VEVENT per shift, in America/Chicago local time.
 */
export function buildScheduleIcs(shifts: Shift[], employeeName: string): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ShiftWave//Schedule Export//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(`${employeeName} — ShiftWave Schedule`)}`,
    ...VTIMEZONE_CHICAGO,
  ];

  const stamp = nowUtcStamp();
  const sorted = [...shifts].sort((a, b) =>
    (a.date + a.startTime).localeCompare(b.date + b.startTime),
  );

  for (const shift of sorted) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${shift.id}@shiftwave`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=America/Chicago:${toIcsLocal(shift.date, shift.startTime)}`,
      `DTEND;TZID=America/Chicago:${toIcsLocal(shift.date, shift.endTime)}`,
      `SUMMARY:${escapeText(`${shift.role} @ ${shift.locationName}`)}`,
      `DESCRIPTION:${escapeText(`${shift.shiftType} · ${shift.scheduledHours}h · ShiftWave`)}`,
      `LOCATION:${escapeText(shift.locationName)}`,
      `STATUS:${shift.status === 'Draft' ? 'TENTATIVE' : 'CONFIRMED'}`,
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
