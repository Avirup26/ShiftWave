interface KpiCardProps {
  label: string;
  value: string | number;
  sub?: string;
  accent?: 'default' | 'red' | 'amber' | 'green';
}

const accentCls: Record<NonNullable<KpiCardProps['accent']>, string> = {
  default: 'text-zinc-900 dark:text-zinc-100',
  red: 'text-red-600 dark:text-red-400',
  amber: 'text-amber-600 dark:text-amber-400',
  green: 'text-emerald-600 dark:text-emerald-400',
};

export default function KpiCard({ label, value, sub, accent = 'default' }: KpiCardProps) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-black/10 bg-white px-5 py-4 dark:border-white/10 dark:bg-zinc-950">
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </p>
      <p className={`text-3xl font-bold tabular-nums ${accentCls[accent]}`}>{value}</p>
      {sub && <p className="text-xs text-zinc-400 dark:text-zinc-600">{sub}</p>}
    </div>
  );
}
