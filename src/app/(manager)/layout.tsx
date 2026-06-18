'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

/**
 * Guard for manager-only pages (/dashboard, /schedule-editor, /review-queue,
 * /approvals, /payroll).
 * - Unauthenticated → /login
 * - Signed in but not a manager → /schedule (employee home)
 */
export default function ManagerLayout({ children }: { children: ReactNode }) {
  const { firebaseUser, userIdentity, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!firebaseUser) {
      router.replace('/login');
      return;
    }
    if (userIdentity?.appRole !== 'manager') {
      router.replace('/schedule');
    }
  }, [loading, firebaseUser, userIdentity, router]);

  if (loading) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
      </main>
    );
  }

  if (!firebaseUser || userIdentity?.appRole !== 'manager') {
    // Redirect is firing via useEffect; render nothing while navigating.
    return null;
  }

  return <>{children}</>;
}
