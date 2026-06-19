/** Given any ISO date string, returns the Monday of that week at noon local time. */
export function getMondayOf(dateStr: string): Date {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay(); // 0=Sun…6=Sat
  const diff = day === 0 ? -6 : 1 - day; // Sunday → −6 (prior Mon); Mon → 0; etc.
  d.setDate(d.getDate() + diff);
  return d;
}

export function addDays(d: Date, days: number): Date {
  const result = new Date(d);
  result.setDate(result.getDate() + days);
  return result;
}

/** Formats a Date as ISO 'YYYY-MM-DD' using the local calendar. */
export function toISO(d: Date): string {
  return d.toLocaleDateString('en-CA');
}

/** Formats a Date for a compact column header: { weekday: 'Mon', monthDay: '6/22' } */
export function toColHeader(d: Date): { weekday: string; monthDay: string } {
  return {
    weekday: d.toLocaleDateString('en-US', { weekday: 'short' }),
    monthDay: d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }),
  };
}

/** Formats a Date for a range label: e.g. 'Mon, Jun 22'. */
export function toDisplayDate(d: Date): string {
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/** Day of week (0=Sun … 6=Sat) for an ISO 'YYYY-MM-DD' string, computed via UTC. */
export function isoWeekday(date: string): number {
  const [y, m, day] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day)).getUTCDay();
}

/**
 * Returns an array of 7 ISO date strings (Mon–Sun) for the week starting at
 * the given Monday Date.
 */
export function weekDatesFrom(monday: Date): string[] {
  return Array.from({ length: 7 }, (_, i) => toISO(addDays(monday, i)));
}
