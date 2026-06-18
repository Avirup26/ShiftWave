// Dashboard — Phase 7 placeholder.
// The full manager dashboard (hours chart, overtime risk, labor-cost estimate,
// coverage gaps) is built in Phase 7. This stub keeps the /dashboard route
// functional so the manager login redirect target exists.
export default function DashboardPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-12">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Manager overview — hours, overtime risk, labor cost, coverage gaps.
        </p>
      </div>

      <div className="rounded-xl border border-black/10 bg-white p-8 text-center dark:border-white/10 dark:bg-zinc-950">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Dashboard charts arrive in Phase 7. In the meantime, use the nav
          links above to access the schedule editor, review queue, approvals,
          and payroll pages.
        </p>
      </div>
    </main>
  );
}
