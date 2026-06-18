'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

export default function Home() {
  const { firebaseUser, userIdentity, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!firebaseUser) {
      router.replace('/login');
      return;
    }
    if (userIdentity?.appRole === 'manager') {
      router.replace('/dashboard');
    } else {
      router.replace('/schedule');
    }
  }, [loading, firebaseUser, userIdentity, router]);

  return (
    <main className="flex flex-1 items-center justify-center">
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
    </main>
  );
}
