'use client';

import { useMemo, useState } from 'react';
import { collection, doc, writeBatch } from 'firebase/firestore';
import { db } from '@/lib/firebase.client';
import type { Issue, Shift } from '@/lib/types';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  /** Repaired draft shifts returned by /api/generate-schedule (status 'Draft'). */
  draftShifts: Shift[];
  /** Remaining issues after the validate-and-repair pass. */
  issues: Issue[];
  /** ISO date label for the target week (e.g. "Jun 29 – Jul 5"). */
  rangeLabel: string;
  /** Called after the draft is written to Firestore so the editor can refresh. */
  onAccepted: () => void;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AISchedulerModal({
  draftShifts,
  issues,
  rangeLabel,
  onAccepted,
  onClose,
}: Props) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const errorIssues = issues.filter((i) => i.severity === 'error');
  const warningIssues = issues.filter((i) => i.severity === 'warning');

  // Group draft shifts by date → locationName for a readable review layout.
  const grouped = useMemo(() => {
    const byDate = new Map<string, Map<string, Shift[]>>();
    for (const s of draftShifts) {
      const byLoc = byDate.get(s.date) ?? new Map<string, Shift[]>();
      const list = byLoc.get(s.locationName) ?? [];
      list.push(s);
      byLoc.set(s.locationName, list);
      byDate.set(s.date, byLoc);
    }
    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, byLoc]) => ({
        date,
        day: byLoc.values().next().value?.[0]?.day ?? '',
        locations: Array.from(byLoc.entries()).sort(([a], [b]) => a.localeCompare(b)),
      }));
  }, [draftShifts]);

  async function handleAccept() {
    if (draftShifts.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      // writeBatch with pre-generated auto-IDs: mirror each generated doc id
      // into the record's `id` field (never hand-mint S####, see §0.5).
      const batch = writeBatch(db);
      for (const shift of draftShifts) {
        const ref = doc(collection(db, 'shifts'));
        const { id: _draftId, ...rest } = shift;
        void _draftId;
        batch.set(ref, { ...rest, id: ref.id, status: 'Scheduled' });
      }
      await batch.commit();
      onAccepted();
    } catch (err) {
      // Surface batch-write failures explicitly — do NOT close as if it worked.
      setError(
        err instanceof Error
          ? `Failed to save schedule: ${err.message}`
          : 'Failed to save the schedule. Nothing was written. Please try again.',
      );
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col rounded-2xl border border-black/10 bg-white shadow-xl dark:border-white/10 dark:bg-zinc-950">
        {/* Header */}
        <div className="border-b border-black/8 px-6 py-4 dark:border-white/8">
          <h2 className="text-lg font-semibold">AI-generated draft schedule</h2>
          <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
            {rangeLabel} · {draftShifts.length} shift{draftShifts.length === 1 ? '' : 's'} proposed
          </p>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* Issues — color-coded by severity */}
          {(errorIssues.length > 0 || warningIssues.length > 0) && (
            <div className="mb-5 flex flex-col gap-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Remaining issues ({errorIssues.length + warningIssues.length})
              </p>
              {errorIssues.map((issue, i) => (
                <div
                  key={`err-${i}`}
                  className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400"
                >
                  ⛔ {issue.message}
                </div>
              ))}
              {warningIssues.map((issue, i) => (
                <div
                  key={`warn-${i}`}
                  className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-900/20 dark:text-amber-400"
                >
                  ⚠️ {issue.message}
                </div>
              ))}
            </div>
          )}

          {issues.length === 0 && draftShifts.length > 0 && (
            <div className="mb-5 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400">
              ✓ No conflicts or coverage gaps detected.
            </div>
          )}

          {/* Draft grid grouped by day → location */}
          {draftShifts.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
              The model did not return any valid assignments.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {grouped.map(({ date, day, locations }) => (
                <div key={date}>
                  <p className="mb-1.5 text-sm font-semibold">
                    {day} <span className="text-zinc-400 dark:text-zinc-600">{date}</span>
                  </p>
                  <div className="flex flex-col gap-2 pl-1">
                    {locations.map(([locName, shifts]) => (
                      <div key={locName}>
                        <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                          {locName}
                        </p>
                        <ul className="mt-1 flex flex-col gap-1">
                          {shifts
                            .slice()
                            .sort((a, b) => a.startTime.localeCompare(b.startTime))
                            .map((s) => (
                              <li
                                key={s.id}
                                className="flex items-center justify-between rounded-lg border border-black/8 bg-white px-2.5 py-1.5 text-xs dark:border-white/8 dark:bg-zinc-900"
                              >
                                <span className="font-medium">{s.employeeName}</span>
                                <span className="text-zinc-500 dark:text-zinc-400">
                                  {s.role} · {s.startTime}–{s.endTime}
                                </span>
                              </li>
                            ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-black/8 px-6 py-4 dark:border-white/8">
          {error && (
            <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-lg border border-black/10 px-4 py-2 text-sm font-medium transition hover:bg-zinc-50 disabled:opacity-60 dark:border-white/10 dark:hover:bg-zinc-900"
            >
              Reject
            </button>
            <button
              type="button"
              onClick={handleAccept}
              disabled={saving || draftShifts.length === 0}
              className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-600 disabled:opacity-60"
            >
              {saving ? 'Saving…' : `Accept & schedule ${draftShifts.length}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
