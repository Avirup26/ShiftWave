import { DEFAULT_HOURLY_RATE } from '@/lib/constants';
import type { Punch, Shift } from '@/lib/types';

function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

interface LaborCostCardProps {
  shifts: Shift[];
  punches: Punch[];
}

export default function LaborCostCard({ shifts, punches }: LaborCostCardProps) {
  // Scheduled cost: sum scheduledHours × rate for non-cancelled shifts
  const scheduledCost = shifts
    .filter((s) => s.status !== 'Cancelled')
    .reduce((sum, s) => sum + s.scheduledHours * (DEFAULT_HOURLY_RATE[s.role] ?? 0), 0);

  // Actual cost: approved punches with both clock times, resolved via shiftId → role
  const shiftsById = new Map(shifts.map((s) => [s.id, s]));
  const actualCost = punches
    .filter(
      (p) =>
        p.managerReviewStatus === 'Approved' && p.clockIn !== null && p.clockOut !== null,
    )
    .reduce((sum, p) => {
      const shift = shiftsById.get(p.shiftId);
      if (!shift) return sum;
      const hours = (toMinutes(p.clockOut!) - toMinutes(p.clockIn!)) / 60;
      return sum + hours * (DEFAULT_HOURLY_RATE[shift.role] ?? 0);
    }, 0);

  const fmt = (n: number) =>
    n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 });

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-zinc-950">
      <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
        Labor Cost Estimate
      </h2>

      {/* Disclaimer — prominent, not fine print */}
      <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-snug text-amber-800 dark:border-amber-700/50 dark:bg-amber-900/20 dark:text-amber-300">
        Estimated based on assumed hourly rates — not real payroll data.
        Instructor $18/h · Ambassador $20/h · Manager / Event Lead / Remote Admin $28/h.
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between text-sm">
          <span className="text-zinc-500 dark:text-zinc-400">Scheduled</span>
          <span className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
            {fmt(scheduledCost)}
          </span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-zinc-500 dark:text-zinc-400">Actual (approved punches)</span>
          <span className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
            {fmt(actualCost)}
          </span>
        </div>
      </div>
    </div>
  );
}
