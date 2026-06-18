'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

/**
 * Guard for employee-facing pages (/schedule, /clock, /requests).
 * Any signed-in user (employee OR manager) passes — managers work pool
 * shifts too, so they need access to these pages.
 * Unauthenticated users are redirected to /login.
 */
export default function EmployeeLayout({ children }: { children: ReactNode }) {
  const { firebaseUser, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!firebaseUser) {
      router.replace('/login');
    }
  }, [loading, firebaseUser, router]);

  if (loading) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
      </main>
    );
  }

  if (!firebaseUser) {
    // Will redirect via useEffect; render nothing while navigating.
    return null;
  }

  return <>{children}</>;
}
