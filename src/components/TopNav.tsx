import Link from 'next/link';

// Static shell header for Phase 1. Role-aware nav links + auth state arrive in
// Phase 2 once the auth context and route guards exist.
export default function TopNav() {
  return (
    <header className="border-b border-black/10 bg-white/80 backdrop-blur dark:border-white/15 dark:bg-black/50">
      <nav className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="inline-block h-5 w-5 rounded-full bg-sky-500" aria-hidden />
          ShiftWave
        </Link>
        <span className="text-sm text-zinc-500 dark:text-zinc-400">Swim school scheduling</span>
      </nav>
    </header>
  );
}
