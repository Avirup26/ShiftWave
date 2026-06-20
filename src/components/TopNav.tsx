'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { onSnapshot, query, where } from 'firebase/firestore';
import { useAuth } from '@/lib/auth';
import { collections } from '@/lib/firestore';
import ThemeToggle from '@/components/ThemeToggle';

// Nav links per role
const EMPLOYEE_LINKS = [
  { href: '/schedule', label: 'Schedule' },
  { href: '/clock', label: 'Clock In/Out' },
  { href: '/requests', label: 'Requests' },
] as const;

const MANAGER_EXTRA_LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/schedule-editor', label: 'Editor' },
  { href: '/review-queue', label: 'Review Queue' },
  { href: '/approvals', label: 'Approvals' },
  { href: '/payroll', label: 'Payroll' },
] as const;

export default function TopNav() {
  const { firebaseUser, userIdentity, employee, loading, signOut } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const isManager = userIdentity?.appRole === 'manager';
  const navLinks = isManager
    ? [...EMPLOYEE_LINKS, ...MANAGER_EXTRA_LINKS]
    : EMPLOYEE_LINKS;

  // Live count of punches needing review — only subscribe when manager is signed in.
  const [reviewCount, setReviewCount] = useState(0);

  useEffect(() => {
    if (!isManager || !firebaseUser) {
      setReviewCount(0);
      return;
    }
    const q = query(
      collections.punches(),
      where('managerReviewStatus', '==', 'Needs Review'),
    );
    return onSnapshot(q, (snap) => setReviewCount(snap.size));
  }, [isManager, firebaseUser]);

  const handleSignOut = async () => {
    await signOut();
    router.push('/login');
  };

  return (
    <header className="border-b border-black/10 bg-white/80 backdrop-blur dark:border-white/15 dark:bg-black/50">
      <nav className="mx-auto flex h-14 w-full max-w-6xl items-center gap-6 px-4">
        {/* Brand */}
        <Link
          href={isManager ? '/dashboard' : firebaseUser ? '/schedule' : '/'}
          className="flex shrink-0 items-center gap-2 font-semibold tracking-tight"
        >
          <span className="inline-block h-5 w-5 rounded-full bg-sky-500" aria-hidden />
          ShiftWave
        </Link>

        {/* Nav links — only shown when signed in */}
        {!loading && firebaseUser && (
          <div className="flex flex-1 items-center gap-1 overflow-x-auto">
            {navLinks.map(({ href, label }) => {
              const active = pathname === href || pathname.startsWith(href + '/');
              const showBadge = href === '/review-queue' && reviewCount > 0;
              return (
                <Link
                  key={href}
                  href={href}
                  className={`relative shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition ${
                    active
                      ? 'bg-sky-50 text-sky-600 dark:bg-sky-950 dark:text-sky-400'
                      : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50'
                  }`}
                >
                  {label}
                  {showBadge && (
                    <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white">
                      {reviewCount > 99 ? '99+' : reviewCount}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        )}

        {/* Right side */}
        <div className="ml-auto flex shrink-0 items-center gap-3">
          <ThemeToggle />
          {!loading && firebaseUser ? (
            <>
              {employee && (
                <span className="hidden text-sm text-zinc-500 dark:text-zinc-400 sm:block">
                  {employee.firstName} {employee.lastName}
                  {isManager && (
                    <span className="ml-1.5 rounded-full bg-sky-100 px-1.5 py-0.5 text-xs font-medium text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
                      Manager
                    </span>
                  )}
                </span>
              )}
              <button
                onClick={handleSignOut}
                className="rounded-md px-3 py-1.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
              >
                Sign out
              </button>
            </>
          ) : !loading ? (
            <Link
              href="/login"
              className="rounded-md bg-sky-500 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-sky-600"
            >
              Sign in
            </Link>
          ) : null}
        </div>
      </nav>
    </header>
  );
}
