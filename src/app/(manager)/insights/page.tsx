'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';

interface Anomaly {
  employeeId: string;
  employeeName: string;
  severity: 'low' | 'medium' | 'high';
  confidence: number;
  title: string;
  explanation: string;
  evidence: string[];
  recommendedAction: string;
}

const severityStyles: Record<Anomaly['severity'], string> = {
  high: 'border-red-300 bg-red-50 dark:border-red-800/60 dark:bg-red-950/30',
  medium: 'border-amber-300 bg-amber-50 dark:border-amber-700/60 dark:bg-amber-950/20',
  low: 'border-black/10 bg-white dark:border-white/10 dark:bg-zinc-950',
};

const severityBadge: Record<Anomaly['severity'], string> = {
  high: 'bg-red-600 text-white',
  medium: 'bg-amber-500 text-white',
  low: 'bg-zinc-300 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200',
};

export default function InsightsPage() {
  const { firebaseUser } = useAuth();
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [anomalies, setAnomalies] = useState<Anomaly[] | null>(null);

  async function handleScan() {
    if (!firebaseUser || scanning) return;
    setScanning(true);
    setError(null);
    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch('/api/punch-anomalies', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Anomaly scan failed.');
      setAnomalies((data.anomalies ?? []) as Anomaly[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Anomaly scan failed.');
    } finally {
      setScanning(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">AI Insights</h1>
          <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
            Scan punch history for timekeeping anomalies — geofence abuse, buddy-punching,
            chronic early clock-ins.
          </p>
        </div>
        <button
          onClick={handleScan}
          disabled={scanning || !firebaseUser}
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:opacity-60"
        >
          {scanning ? 'Scanning…' : '✨ Scan for anomalies'}
        </button>
      </div>

      <div className="mb-6 rounded-xl border border-black/10 bg-zinc-50 px-4 py-3 text-xs leading-snug text-zinc-600 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-400">
        Anomalies are surfaced by a heuristic pre-pass over punch data (geofence violations,
        clock-in timing deltas, distance from site, buddy-punch clusters) and ranked + explained
        by Gemini. Findings are advisory — verify before acting.
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
          {error}
        </div>
      )}

      {scanning && (
        <div className="flex justify-center py-20">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
        </div>
      )}

      {!scanning && anomalies !== null && anomalies.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-black/10 px-6 py-16 text-center dark:border-white/10">
          <span className="text-3xl" aria-hidden>
            ✓
          </span>
          <p className="font-medium">No anomalies detected</p>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Punch patterns look clean for the current data.
          </p>
        </div>
      )}

      {!scanning && anomalies && anomalies.length > 0 && (
        <div className="flex flex-col gap-4">
          {anomalies.map((a, i) => (
            <div key={`${a.employeeId}-${i}`} className={`rounded-xl border p-5 ${severityStyles[a.severity]}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{a.title}</p>
                  <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">
                    {a.employeeName}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold uppercase ${severityBadge[a.severity]}`}>
                    {a.severity}
                  </span>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    {Math.round(a.confidence * 100)}% conf.
                  </span>
                </div>
              </div>

              <p className="mt-3 text-sm">{a.explanation}</p>

              {a.evidence.length > 0 && (
                <ul className="mt-3 list-disc pl-5 text-sm text-zinc-600 dark:text-zinc-400">
                  {a.evidence.map((e, j) => (
                    <li key={j}>{e}</li>
                  ))}
                </ul>
              )}

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-black/8 pt-3 dark:border-white/8">
                <p className="text-sm">
                  <span className="font-medium">Recommended:</span> {a.recommendedAction}
                </p>
                <Link
                  href="/review-queue"
                  className="shrink-0 rounded-lg border border-black/10 px-3 py-1.5 text-xs font-medium transition hover:bg-white dark:border-white/10 dark:hover:bg-zinc-900"
                >
                  Review queue →
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
