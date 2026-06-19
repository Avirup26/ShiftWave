import type { Issue } from '@/lib/types';

interface OvertimeRiskListProps {
  issues: Issue[];
}

export default function OvertimeRiskList({ issues }: OvertimeRiskListProps) {
  const overtimeIssues = issues.filter((i) => i.kind === 'over-hours');

  if (overtimeIssues.length === 0) {
    return (
      <p className="text-sm text-emerald-600 dark:text-emerald-400">
        No overtime risk this week.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {overtimeIssues.map((issue, idx) => {
        const isError = issue.severity === 'error';
        return (
          <li key={idx} className="flex items-start gap-2">
            <span
              className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
                isError
                  ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                  : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
              }`}
            >
              {isError ? 'OT Risk' : 'Over target'}
            </span>
            <span className="text-sm text-zinc-700 dark:text-zinc-300">{issue.message}</span>
          </li>
        );
      })}
    </ul>
  );
}
