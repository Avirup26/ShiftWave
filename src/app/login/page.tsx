'use client';

import { useState, useEffect, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

export default function LoginPage() {
  const { signIn, firebaseUser, userIdentity, loading } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Once auth resolves (after sign-in or on initial page load if already
  // signed in), redirect to the appropriate home.
  useEffect(() => {
    if (loading) return;
    if (firebaseUser && userIdentity) {
      router.replace(userIdentity.appRole === 'manager' ? '/dashboard' : '/schedule');
    }
  }, [loading, firebaseUser, userIdentity, router]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await signIn(email, password);
      // onAuthStateChanged will update context; the useEffect above handles redirect.
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Sign-in failed. Please try again.';
      // Make Firebase error messages a bit friendlier.
      if (msg.includes('invalid-credential') || msg.includes('wrong-password') || msg.includes('user-not-found')) {
        setError('Invalid email or password.');
      } else if (msg.includes('too-many-requests')) {
        setError('Too many attempts. Please wait a moment and try again.');
      } else {
        setError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Avoid flashing the form for already-authed users.
  if (loading || (firebaseUser && userIdentity)) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
      </main>
    );
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="mb-8 text-center">
          <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-sky-500/10">
            <span className="h-5 w-5 rounded-full bg-sky-500" aria-hidden />
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">Sign in to ShiftWave</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Swim school scheduling &amp; timekeeping
          </p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-black/10 bg-white px-6 py-8 shadow-sm dark:border-white/10 dark:bg-zinc-950">
          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
            <div>
              <label
                htmlFor="email"
                className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm outline-none transition placeholder:text-zinc-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 dark:border-white/15 dark:bg-zinc-900 dark:placeholder:text-zinc-600"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm outline-none transition placeholder:text-zinc-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 dark:border-white/15 dark:bg-zinc-900 dark:placeholder:text-zinc-600"
              />
            </div>

            {error && (
              <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting || !email || !password}
              className="mt-1 flex w-full items-center justify-center gap-2 rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting && (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden />
              )}
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
