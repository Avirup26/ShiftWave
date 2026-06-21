'use client';

import { useState } from 'react';
import { collection, doc, writeBatch } from 'firebase/firestore';
import { db } from '@/lib/firebase.client';
import { useAuth } from '@/lib/auth';
import type { CopilotOperation } from '@/lib/copilot';
import type { Issue } from '@/lib/types';

interface CopilotResult {
  operations: CopilotOperation[];
  issues: Issue[];
  skipped: string[];
  message?: string;
}

interface Props {
  weekDates: string[];
  rangeLabel: string;
  /** Called after operations are applied so the editor can reload shifts. */
  onApplied: () => void;
}

const EXAMPLES = [
  'Add an Instructor to Arlington on Thursday',
  'Move Sarah’s Friday shift to Saturday morning',
  'Swap the Manager on Grand Prairie Wednesday',
];

function opLabel(op: CopilotOperation): { sign: string; cls: string; text: string } {
  switch (op.action) {
    case 'add':
      return {
        sign: '+',
        cls: 'text-emerald-700 dark:text-emerald-400',
        text: `Add ${op.shift.employeeName} — ${op.shift.role} at ${op.shift.locationName}, ${op.shift.date} ${op.shift.startTime}–${op.shift.endTime}`,
      };
    case 'remove':
      return {
        sign: '−',
        cls: 'text-red-600 dark:text-red-400',
        text: `Remove ${op.before.employeeName} — ${op.before.role} at ${op.before.locationName}, ${op.before.date} ${op.before.startTime}–${op.before.endTime}`,
      };
    case 'reassign':
      return {
        sign: '~',
        cls: 'text-sky-700 dark:text-sky-400',
        text: `Reassign ${op.before.locationName} ${op.before.date} ${op.before.startTime}–${op.before.endTime}: ${op.before.employeeName} → ${op.after.employeeName}`,
      };
    case 'move':
      return {
        sign: '~',
        cls: 'text-sky-700 dark:text-sky-400',
        text: `Move ${op.before.employeeName} (${op.before.locationName}): ${op.before.date} ${op.before.startTime}–${op.before.endTime} → ${op.after.date} ${op.after.startTime}–${op.after.endTime}`,
      };
  }
}

export default function CopilotPanel({ weekDates, rangeLabel, onApplied }: Props) {
  const { firebaseUser } = useAuth();
  const [instruction, setInstruction] = useState('');
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CopilotResult | null>(null);

  async function handleAsk() {
    if (!firebaseUser || !instruction.trim() || asking) return;
    setAsking(true);
    setError(null);
    setResult(null);
    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch('/api/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ instruction: instruction.trim(), weekDates }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Copilot request failed.');
      setResult(data as CopilotResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Copilot request failed.');
    } finally {
      setAsking(false);
    }
  }

  async function handleApply() {
    if (!result || result.operations.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const batch = writeBatch(db);
      for (const op of result.operations) {
        if (op.action === 'add') {
          const ref = doc(collection(db, 'shifts'));
          const { id: _tmp, ...rest } = op.shift;
          void _tmp;
          batch.set(ref, { ...rest, id: ref.id, status: 'Scheduled' });
        } else if (op.action === 'remove') {
          batch.delete(doc(db, 'shifts', op.shiftId));
        } else if (op.action === 'reassign') {
          batch.update(doc(db, 'shifts', op.shiftId), {
            employeeId: op.after.employeeId,
            employeeName: op.after.employeeName,
          });
        } else if (op.action === 'move') {
          batch.update(doc(db, 'shifts', op.shiftId), {
            date: op.after.date,
            day: op.after.day,
            startTime: op.after.startTime,
            endTime: op.after.endTime,
            scheduledHours: op.after.scheduledHours,
          });
        }
      }
      await batch.commit();
      setResult(null);
      setInstruction('');
      onApplied();
    } catch (err) {
      setError(
        err instanceof Error
          ? `Failed to apply changes: ${err.message}`
          : 'Failed to apply changes. Nothing was saved.',
      );
    } finally {
      setSaving(false);
    }
  }

  const errorIssues = result?.issues.filter((i) => i.severity === 'error') ?? [];
  const warningIssues = result?.issues.filter((i) => i.severity === 'warning') ?? [];

  return (
    <div className="mb-6 rounded-xl border border-violet-200 bg-violet-50/60 p-4 dark:border-violet-900/40 dark:bg-violet-950/20">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-violet-700 dark:text-violet-300">
          ✨ Copilot
        </span>
        <input
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAsk();
          }}
          placeholder="Tell the schedule what to do…"
          disabled={asking}
          className="min-w-[240px] flex-1 rounded-lg border border-black/15 bg-white px-3 py-2 text-sm outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 disabled:opacity-60 dark:border-white/15 dark:bg-zinc-900"
        />
        <button
          onClick={handleAsk}
          disabled={asking || !instruction.trim() || !firebaseUser}
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:opacity-60"
        >
          {asking ? 'Thinking…' : 'Ask Copilot'}
        </button>
      </div>

      {!result && !error && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => setInstruction(ex)}
              className="rounded-full border border-violet-200 bg-white px-2.5 py-0.5 text-xs text-violet-700 transition hover:bg-violet-100 dark:border-violet-900/40 dark:bg-zinc-900 dark:text-violet-300 dark:hover:bg-violet-950/40"
            >
              {ex}
            </button>
          ))}
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </p>
      )}

      {/* Proposal diff modal */}
      {result && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !saving) setResult(null);
          }}
        >
          <div className="flex max-h-[88vh] w-full max-w-2xl flex-col rounded-2xl border border-black/10 bg-white shadow-xl dark:border-white/10 dark:bg-zinc-950">
            <div className="border-b border-black/8 px-6 py-4 dark:border-white/8">
              <h2 className="text-lg font-semibold">✨ Copilot proposal</h2>
              <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
                {rangeLabel} · {result.operations.length} change
                {result.operations.length === 1 ? '' : 's'} proposed
              </p>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              {result.operations.length === 0 ? (
                <p className="py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  {result.message ?? 'No concrete changes were proposed.'}
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {result.operations.map((op, i) => {
                    const { sign, cls, text } = opLabel(op);
                    return (
                      <li
                        key={i}
                        className="flex items-start gap-2 rounded-lg border border-black/8 bg-white px-3 py-2 text-sm dark:border-white/8 dark:bg-zinc-900"
                      >
                        <span className={`font-bold ${cls}`}>{sign}</span>
                        <span>{text}</span>
                      </li>
                    );
                  })}
                </ul>
              )}

              {(errorIssues.length > 0 || warningIssues.length > 0) && (
                <div className="mt-5 flex flex-col gap-1.5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    Resulting issues ({errorIssues.length + warningIssues.length})
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

              {result.skipped.length > 0 && (
                <div className="mt-4 rounded-lg border border-black/10 bg-zinc-50 px-3 py-2 text-xs text-zinc-500 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-400">
                  <p className="font-medium">Skipped ({result.skipped.length})</p>
                  <ul className="mt-1 list-disc pl-4">
                    {result.skipped.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="border-t border-black/8 px-6 py-4 dark:border-white/8">
              {error && (
                <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setResult(null)}
                  disabled={saving}
                  className="rounded-lg border border-black/10 px-4 py-2 text-sm font-medium transition hover:bg-zinc-50 disabled:opacity-60 dark:border-white/10 dark:hover:bg-zinc-900"
                >
                  Cancel
                </button>
                <button
                  onClick={handleApply}
                  disabled={saving || result.operations.length === 0}
                  className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:opacity-60"
                >
                  {saving
                    ? 'Applying…'
                    : `Apply ${result.operations.length} change${result.operations.length === 1 ? '' : 's'}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
