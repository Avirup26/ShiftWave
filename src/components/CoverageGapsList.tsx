import { describeMissing } from '@/lib/validators';
import type { CoverageResult } from '@/lib/types';

interface CoverageGapsListProps {
  coverage: CoverageResult[];
}

export default function CoverageGapsList({ coverage }: CoverageGapsListProps) {
  const gaps = coverage.filter((c) => !c.satisfied);

  if (gaps.length === 0) {
    return (
      <p className="text-sm text-emerald-600 dark:text-emerald-400">
        All shifts fully covered this week.
      </p>
    );
  }

  // Sort chronologically then by location
  const sorted = [...gaps].sort((a, b) => {
    const dateCmp = a.date.localeCompare(b.date);
    if (dateCmp !== 0) return dateCmp;
    return a.locationId.localeCompare(b.locationId);
  });

  return (
    <ul className="flex flex-col gap-2">
      {sorted.map((gap, idx) => (
        <li
          key={idx}
          className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 dark:bg-red-900/15"
        >
          <span className="mt-0.5 shrink-0 text-red-500 dark:text-red-400">⚠</span>
          <div className="text-sm">
            <span className="font-medium text-zinc-800 dark:text-zinc-200">
              {gap.date} · {gap.locationId} · {gap.shiftType}
            </span>
            <span className="ml-2 text-zinc-500 dark:text-zinc-400">
              — needs {describeMissing(gap.missing)}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
