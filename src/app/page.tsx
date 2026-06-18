import Link from "next/link";

// Phase 1 placeholder home. In Phase 2 this redirects to /login or the
// role-appropriate home based on the signed-in user's appRole.
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-16">
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">ShiftWave</h1>
        <p className="max-w-2xl text-zinc-600 dark:text-zinc-400">
          Scheduling &amp; timekeeping for a multi-location swim school. Employees
          view schedules, clock in/out (geofenced), and request time off or swaps.
          Managers schedule, approve, review flagged punches, auto-generate
          schedules with AI, and export payroll.
        </p>
      </div>

      <section className="rounded-xl border border-black/10 bg-white p-5 dark:border-white/15 dark:bg-zinc-950">
        <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
          Foundation (Phase 1)
        </h2>
        <p className="mt-2 text-sm">
          App scaffold, Firebase setup, shared types/constants, and the data
          import are in place. Authentication and the employee/manager flows
          arrive in the next phases.
        </p>
        <div className="mt-4 flex flex-wrap gap-2 text-sm">
          <span className="rounded-full bg-zinc-100 px-3 py-1 dark:bg-zinc-800">
            Next.js + TypeScript
          </span>
          <span className="rounded-full bg-zinc-100 px-3 py-1 dark:bg-zinc-800">
            Firebase Auth + Firestore
          </span>
          <span className="rounded-full bg-zinc-100 px-3 py-1 dark:bg-zinc-800">
            Tailwind v4
          </span>
        </div>
      </section>

      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Sign-in lands in Phase 2 at{" "}
        <Link href="/" className="underline">
          /login
        </Link>
        .
      </p>
    </main>
  );
}
