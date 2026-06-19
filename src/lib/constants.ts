// Business rules derived from the sample data. The validators and the AI
// scheduler both read from here — never hard-code these elsewhere.

// Coverage required per shift type. Used by coverage detection AND the AI scheduler.
export const COVERAGE_RULES = {
  'Pool Shift': { Manager: 1, Ambassador: 1, Instructor: 4 }, // min per pool shift
  Event: { 'Event Lead': 1, Ambassador: 2, Instructor: 2 },
  'Remote Admin': { 'Remote Admin': 1 },
} as const;

// Standard shift windows (from the data). Saturday pool shifts are mornings.
export const SHIFT_WINDOWS = {
  ARL: { weeknight: ['16:30', '20:30'], saturday: ['08:00', '12:00'] },
  GP: { weeknight: ['16:45', '20:45'], saturday: ['08:00', '12:00'] },
  MAN: { weeknight: ['17:00', '21:00'], saturday: ['08:00', '12:00'] },
} as const;

export const GEOFENCE = {
  defaultPoolRadiusFt: 200,
  eventRadiusFt: 300,
  feetToMeters: 0.3048,
  // Reverse-engineered from the 45 seeded TimePunches: diffs of -10 to +5 min
  // were labelled "On Time"; +7 min and beyond were "Outside Window".
  // 5 minutes is the intended threshold from the original sample data.
  onTimeWindowMinutes: 5,
} as const;

export const OVERTIME_THRESHOLD_HOURS = 40; // per week, FLSA/TX standard (ASSUMPTION)

// Pay rates are NOT in the source data — ASSUMPTION, configurable. Used only for the
// labor-cost ESTIMATE on the dashboard. Document this clearly in the UI + writeup.
export const DEFAULT_HOURLY_RATE: Record<string, number> = {
  Instructor: 18,
  Ambassador: 20,
  Manager: 28,
  'Event Lead': 28,
  'Remote Admin': 28,
};

// The seeded schedule is the week of Mon 2026-06-22. Use this as the demo
// "today" so schedule/clock-in screens aren't empty on other dates.
export const DEMO_DATE = '2026-06-22';
