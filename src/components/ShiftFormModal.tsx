'use client';

import { useState, useEffect } from 'react';
import { collection, addDoc, updateDoc, setDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase.client';
import type { Employee, Location, RoleName, Shift } from '@/lib/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROLE_NAMES: RoleName[] = [
  'Manager',
  'Ambassador',
  'Instructor',
  'Remote Admin',
  'Event Lead',
];
const SHIFT_TYPES: Shift['shiftType'][] = ['Pool Shift', 'Remote Admin', 'Event'];
const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  mode: 'add' | 'edit';
  /** Pre-fill: locationId + date for cell "+", full Shift for edit. */
  initialValues: Partial<Shift>;
  locations: Location[];
  employees: Employee[];
  /** Called with the saved Shift after a successful Firestore write. */
  onSaved: (shift: Shift) => void;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ShiftFormModal({
  mode,
  initialValues,
  locations,
  employees,
  onSaved,
  onClose,
}: Props) {
  const [locationId, setLocationId] = useState(initialValues.locationId ?? '');
  const [date, setDate] = useState(initialValues.date ?? '');
  const [shiftType, setShiftType] = useState<Shift['shiftType']>(
    initialValues.shiftType ?? 'Pool Shift',
  );
  const [role, setRole] = useState<RoleName>(initialValues.role ?? 'Instructor');
  const [employeeId, setEmployeeId] = useState(initialValues.employeeId ?? '');
  const [startTime, setStartTime] = useState(initialValues.startTime ?? '16:00');
  const [endTime, setEndTime] = useState(initialValues.endTime ?? '20:00');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Employees eligible for the currently selected location
  const eligibleEmployees = employees.filter(
    (e) =>
      e.status === 'Active' &&
      (locationId === '' || e.eligibleLocations.includes(locationId)),
  );

  // Clear employee selection when it becomes ineligible after location change
  useEffect(() => {
    if (employeeId && !eligibleEmployees.some((e) => e.id === employeeId)) {
      setEmployeeId('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!locationId || !date || !employeeId) {
      setError('Location, date, and employee are required.');
      return;
    }
    if (toMinutes(endTime) <= toMinutes(startTime)) {
      setError('End time must be after start time.');
      return;
    }

    const location = locations.find((l) => l.id === locationId);
    const emp = employees.find((e) => e.id === employeeId);
    if (!location || !emp) {
      setError('Invalid location or employee.');
      return;
    }

    // day is derived from the date at midday to stay in local timezone
    const day = DAY_NAMES[new Date(date + 'T12:00:00').getDay()];
    const scheduledHours =
      Math.round(((toMinutes(endTime) - toMinutes(startTime)) / 60) * 100) / 100;

    const payload: Omit<Shift, 'id'> = {
      date,
      day,
      locationId,
      locationName: location.name,
      shiftType,
      role,
      employeeId,
      employeeName: `${emp.firstName} ${emp.lastName}`,
      startTime,
      endTime,
      scheduledHours,
      status: initialValues.status ?? 'Scheduled',
    };

    setSaving(true);
    try {
      if (mode === 'add') {
        // Auto-ID: addDoc → patch id field to mirror the generated key
        const ref = await addDoc(collection(db, 'shifts'), { ...payload, id: '' });
        await updateDoc(ref, { id: ref.id });
        onSaved({ ...payload, id: ref.id });
      } else {
        const id = initialValues.id!;
        await setDoc(doc(db, 'shifts', id), { ...payload, id });
        onSaved({ ...payload, id });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  const labelCls = 'block text-sm font-medium text-zinc-700 dark:text-zinc-300';
  const inputCls =
    'mt-1 block w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-500 dark:border-white/10 dark:bg-zinc-900 dark:text-white';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-2xl border border-black/10 bg-white p-6 shadow-xl dark:border-white/10 dark:bg-zinc-950">
        <h2 className="mb-5 text-lg font-semibold">
          {mode === 'add' ? 'Add Shift' : 'Edit Shift'}
        </h2>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Date */}
          <div>
            <label className={labelCls}>Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              className={inputCls}
            />
          </div>

          {/* Location */}
          <div>
            <label className={labelCls}>Location</label>
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              required
              className={inputCls}
            >
              <option value="">Select location…</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>

          {/* Shift type */}
          <div>
            <label className={labelCls}>Shift Type</label>
            <select
              value={shiftType}
              onChange={(e) => setShiftType(e.target.value as Shift['shiftType'])}
              className={inputCls}
            >
              {SHIFT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          {/* Role */}
          <div>
            <label className={labelCls}>Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as RoleName)}
              className={inputCls}
            >
              {ROLE_NAMES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          {/* Employee — filtered to eligibleLocations */}
          <div>
            <label className={labelCls}>Employee</label>
            <select
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              required
              className={inputCls}
            >
              <option value="">
                {locationId ? 'Select employee…' : 'Choose a location first'}
              </option>
              {eligibleEmployees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.firstName} {e.lastName} ({e.primaryRole})
                </option>
              ))}
            </select>
            {locationId && eligibleEmployees.length === 0 && (
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                No active employees are eligible for this location.
              </p>
            )}
          </div>

          {/* Times */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Start Time</label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>End Time</label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                required
                className={inputCls}
              />
            </div>
          </div>

          {/* Error */}
          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
              {error}
            </p>
          )}

          {/* Actions */}
          <div className="mt-1 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-black/10 px-4 py-2 text-sm font-medium transition hover:bg-zinc-50 dark:border-white/10 dark:hover:bg-zinc-900"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-600 disabled:opacity-60"
            >
              {saving ? 'Saving…' : mode === 'add' ? 'Add Shift' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
