export type RoleName =
  | 'Manager'
  | 'Ambassador'
  | 'Instructor'
  | 'Remote Admin'
  | 'Event Lead';

export type AppRole = 'manager' | 'employee';

export interface Location {
  id: string; // 'ARL'
  name: string; // 'Arlington'
  type: string; // 'Swim School' | 'Remote Work' | 'Community Event'
  address: string;
  lat: number | null;
  lng: number | null;
  geofenceRadiusFt: number;
  geofenceRequired: boolean;
}

export interface RoleConfig {
  role: RoleName;
  canClockIn: boolean;
  requiresGeofence: boolean;
  canWorkRemote: boolean;
  defaultShiftLengthHours: number;
}

export interface Employee {
  id: string; // 'I001'
  firstName: string;
  lastName: string;
  primaryRole: RoleName;
  secondaryRole?: RoleName;
  eligibleLocations: string[]; // ['ARL','GP']
  avgWeeklyHours: number;
  status: 'Active' | 'Inactive';
  authUid?: string; // set after they sign up
  email?: string;
  appRole: AppRole; // 'manager' if Manager, else 'employee'
}

export interface Shift {
  id: string; // 'S0001'
  date: string; // ISO 'YYYY-MM-DD'
  day: string; // 'Monday'
  locationId: string;
  locationName: string;
  shiftType: 'Pool Shift' | 'Remote Admin' | 'Event';
  role: RoleName;
  employeeId: string;
  employeeName: string;
  startTime: string; // '16:30'
  endTime: string; // '20:30'
  scheduledHours: number;
  status: 'Scheduled' | 'Draft' | 'Cancelled';
}

export type GeofenceStatus =
  | 'Inside Geofence'
  | 'Outside Geofence'
  | 'No Geofence'      // geofence not required for this location (remote/event)
  | 'Location Error';  // geofence required but getCurrentPosition failed/was denied
export type TimingStatus = 'On Time' | 'Outside Window';
export type ReviewStatus = 'Approved' | 'Needs Review' | 'Rejected';

export interface Punch {
  id: string; // 'P0001'
  shiftId: string;
  employeeId: string;
  date: string;
  locationId: string;
  scheduledStart: string;
  scheduledEnd: string;
  clockIn: string | null;
  clockOut: string | null;
  clockInLat: number | null;
  clockInLng: number | null;
  geofenceStatus: GeofenceStatus;
  clockInTimingStatus: TimingStatus;
  managerReviewStatus: ReviewStatus;
  rejectReason?: string;
}

export interface TimeOffRequest {
  id: string;
  employeeId: string;
  startDate: string;
  endDate: string;
  reason: string;
  status: 'Pending' | 'Approved' | 'Denied';
  createdAt: number;
}

export interface SwapRequest {
  id: string;
  shiftId: string;
  fromEmployeeId: string;
  toEmployeeId: string; // proposed replacement
  status: 'Pending' | 'Approved' | 'Denied';
  createdAt: number;
}

// Community events carry their own coordinates + geofence radius (per the
// Events sheet). Stored so later phases (clock-in / review) can geofence them.
export interface CommunityEvent {
  id: string; // 'EVT001'
  name: string;
  date: string; // ISO 'YYYY-MM-DD'
  locationId: string; // 'EVT'
  address: string;
  lat: number | null;
  lng: number | null;
  geofenceRadiusFt: number;
  expectedStaff: number;
  notes?: string;
}

// --- Shared validator result types (used from Phase 4 onward) ---

export interface Issue {
  kind: 'double-booking' | 'ineligible' | 'over-hours' | 'understaffed';
  severity: 'error' | 'warning';
  message: string;
  employeeId?: string;
  shiftId?: string;
}

export interface CoverageResult {
  locationId: string;
  date: string;
  shiftType: Shift['shiftType'];
  satisfied: boolean;
  missing: { role: RoleName; need: number; have: number }[];
}

export interface ValidationReport {
  issues: Issue[];
  coverage: CoverageResult[];
  ok: boolean; // true if no 'error'-severity issues and all coverage satisfied
}

// Login identity doc at users/{authUid} (written by link-users.mjs / Admin SDK).
export interface UserIdentity {
  employeeId: string;
  appRole: AppRole;
  email: string;
}
