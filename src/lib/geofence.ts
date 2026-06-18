// Pure geofence helpers — no Firebase imports.
// Used by the clock-in page and (from Phase 5) the review queue.

import { GEOFENCE } from '@/lib/constants';
import type { GeofenceStatus, Location, TimingStatus } from '@/lib/types';

// ---------------------------------------------------------------------------
// Haversine distance
// ---------------------------------------------------------------------------

/**
 * Returns the great-circle distance in metres between two WGS-84 coordinates.
 */
export function haversineDistanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6_371_000; // Earth mean radius in metres
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---------------------------------------------------------------------------
// Geofence status
// ---------------------------------------------------------------------------

/**
 * Determines whether the user's position is inside or outside the geofence
 * for the given location.
 *
 * Returns 'No Geofence' when:
 *  - the location has no coordinates (EVT / Remote), or
 *  - the location does not require a geofence check.
 */
export function computeGeofenceStatus(
  userLat: number,
  userLng: number,
  location: Location,
): GeofenceStatus {
  if (!location.geofenceRequired || location.lat === null || location.lng === null) {
    return 'No Geofence';
  }

  const radiusMeters = location.geofenceRadiusFt * GEOFENCE.feetToMeters;
  const distanceMeters = haversineDistanceMeters(
    userLat,
    userLng,
    location.lat,
    location.lng,
  );

  return distanceMeters <= radiusMeters ? 'Inside Geofence' : 'Outside Geofence';
}

// ---------------------------------------------------------------------------
// Timing status
// ---------------------------------------------------------------------------

/**
 * Compares the actual clock-in time to the scheduled shift start.
 * Both arguments are 24-hour 'HH:MM' wall-clock strings in US Central.
 *
 * 'On Time'        — within GEOFENCE.onTimeWindowMinutes of scheduled start
 * 'Outside Window' — more than onTimeWindowMinutes early or late
 */
export function computeTimingStatus(
  clockInHHMM: string,
  scheduledStart: string,
): TimingStatus {
  const toMinutes = (hhmm: string): number => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  };

  const diff = Math.abs(toMinutes(clockInHHMM) - toMinutes(scheduledStart));
  return diff <= GEOFENCE.onTimeWindowMinutes ? 'On Time' : 'Outside Window';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the current US-Central wall-clock time as 'HH:MM'. */
export function nowCentralHHMM(): string {
  return new Date().toLocaleTimeString('en-US', {
    timeZone: 'America/Chicago',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** Returns the current US-Central date as an ISO 'YYYY-MM-DD' string. */
export function todayCentral(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
}
