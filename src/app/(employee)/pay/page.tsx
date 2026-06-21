'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getDocs, query, where } from 'firebase/firestore';
import { collections } from '@/lib/firestore';
import { useAuth } from '@/lib/auth';
import { DEMO_DATE } from '@/lib/constants';
import { addDays, getMondayOf, toDisplayDate, weekDatesFrom } from '@/lib/weekHelpers';
import { punchMinutes, round2 } from '@/lib/payHours';
import { computePayBreakdown, TAX_RATES } from '@/lib/pay';
import PayDonutChart from '@/components/PayDonutChart';
import type { Punch } from '@/lib/types';

const navBtnCls =
  'rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm font-medium transition hover:bg-zinc-50 dark:border-white/10 dark:bg-zinc-900 dark:hover:bg-zinc-800';

function exclusionReason(p: Punch): string | null {
  if (p.managerReviewStatus !== 'Approved') return p.managerReviewStatus;
  if (!p.clockIn || !p.clockOut) return 'Missing clock-out';
  return null;
}

export default function PayPage() {
  const { employee } = useAuth();

  const [weekMonday, setWeekMonday] = useState<Date>(() => getMondayOf(DEMO_DATE));
  const [punches, setPunches] = useState<Punch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const weekDates = useMemo(() => weekDatesFrom(weekMonday), [weekMonday]);
  const weekStart = weekDates[0];
  const weekEnd = weekDates[6];
  const rangeLabel = `${toDisplayDate(weekMonday)} – ${toDisplayDate(addDays(weekMonday, 6))}`;

  const loadWeek = useCallback(async () => {
    if (!employee) return;
    setLoading(true);
    setError(null);
    try {
      const snap = await getDocs(
        query(
          collections.punches(),
          where('employeeId', '==', employee.id),
          where('date', '>=', weekStart),
          where('date', '<=', weekEnd),
        ),
      );
      setPunches(snap.docs.map((d) => d.data()));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load pay');
    } finally {
      setLoading(false);
    }
  }, [employee, weekStart, weekEnd]);

  useEffect(() => {
    loadWeek();
  }, [loadWeek]);

  // Pay is funded only by Approved punches with both clock times — same
  // gate the Gusto export uses — so /pay's gross never overstates what the
  // employee will actually be paid for hours still pending review.
  const approvedHours = useMemo(
    () =>
      round2(
        punches
          .filter((p) => exclusionReason(p) === null)
          .reduce((sum, p) => sum + punchMinutes(p) / 60, 0),
      ),
    [punches],
  );

  const pendingHours = useMemo(
    () =>
      round2(
        punches
          .filter((p) => exclusionReason(p) !== null && p.clockIn && p.clockOut)
          .reduce((sum, p) => sum + punchMinutes(p) / 60, 0),
      ),
    [punches],
  );

  const breakdown = useMemo(
    () => (employee ? computePayBreakdown(approvedHours, employee.primaryRole) : null),
    [approvedHours, employee],
  );

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pay</h1>
          <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">{rangeLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setWeekMonday((d) => addDays(d, -7))} className={navBtnCls}>
            ← Prev
          </button>
          <button onClick={() => setWeekMonday(() => getMondayOf(DEMO_DATE))} className={navBtnCls}>
            Demo week
          </button>
          <button onClick={() => setWeekMonday((d) => addDays(d, 7))} className={navBtnCls}>
            Next →
          </button>
        </div>
      </div>

      <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs leading-snug text-amber-800 dark:border-amber-700/50 dark:bg-amber-900/20 dark:text-amber-300">
        Simulated pay estimate — flat-rate tax approximation for demo purposes only, not
        actual payroll tax calculation.
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
          {error}
        </div>
      )}

      {loading || !breakdown || !employee ? (
        <div className="flex justify-center py-24">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
        </div>
      ) : (
        !error && (
          <>
            {pendingHours > 0 && (
              <div className="mb-6 rounded-xl border border-black/10 bg-zinc-50 px-4 py-3 text-xs leading-snug text-zinc-600 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-400">
                Pay estimate includes only manager-approved hours; {pendingHours} hours are
                pending review and not yet included.
              </div>
            )}

            <div className="mb-6 rounded-xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-zinc-950">
              <PayDonutChart breakdown={breakdown} />
              <p className="mt-2 text-center text-sm text-zinc-500 dark:text-zinc-400">
                Take Home
              </p>
              <p className="text-center text-2xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                ${breakdown.netPay.toFixed(2)}
              </p>
            </div>

            <div className="flex flex-col divide-y divide-black/5 rounded-xl border border-black/10 bg-white dark:divide-white/5 dark:border-white/10 dark:bg-zinc-950">
              <Row label={`Gross (${approvedHours} hrs × $${breakdown.rate}/hr)`} value={breakdown.grossPay} />
              <Row label={`Federal Income Tax (${(TAX_RATES.federal * 100).toFixed(0)}%)`} value={-breakdown.federalTax} />
              <Row
                label={`Social Security Tax (${(TAX_RATES.socialSecurity * 100).toFixed(1)}%)`}
                value={-breakdown.socialSecurityTax}
              />
              <Row label={`Medicare Tax (${(TAX_RATES.medicare * 100).toFixed(2)}%)`} value={-breakdown.medicareTax} />
              <Row label="Take Home" value={breakdown.netPay} bold />
            </div>
          </>
        )
      )}
    </main>
  );
}

function Row({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  const negative = value < 0;
  return (
    <div className="flex items-center justify-between px-5 py-3 text-sm">
      <span className={bold ? 'font-semibold' : 'text-zinc-600 dark:text-zinc-400'}>{label}</span>
      <span
        className={`tabular-nums ${bold ? 'font-semibold' : ''} ${
          negative ? 'text-red-600 dark:text-red-400' : ''
        }`}
      >
        {negative ? '-' : ''}${Math.abs(value).toFixed(2)}
      </span>
    </div>
  );
}
