import 'server-only';

import { NextResponse } from 'next/server';

import { adminAuth, adminDb } from '@/lib/firebase.admin';

/**
 * Shared auth for AI route handlers. Mirrors the pattern proven in
 * generate-schedule/route.ts: verify the Firebase ID token, and (for manager
 * routes) confirm appRole via users/{uid} — appRole is NOT a token claim.
 *
 * Each helper returns `{ uid }` on success or a ready-to-return NextResponse
 * (401) on failure. Call sites do: `const a = await requireManager(req); if (a
 * instanceof NextResponse) return a;`.
 */

function unauthorized(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 401 });
}

/** Verify the bearer token only — any signed-in user passes. */
export async function requireUser(req: Request): Promise<{ uid: string } | NextResponse> {
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) return unauthorized('Missing bearer token');

  try {
    const decoded = await adminAuth.verifyIdToken(token);
    return { uid: decoded.uid };
  } catch {
    return unauthorized('Invalid or expired token');
  }
}

/** Verify the token AND confirm the caller is a manager via users/{uid}. */
export async function requireManager(req: Request): Promise<{ uid: string } | NextResponse> {
  const result = await requireUser(req);
  if (result instanceof NextResponse) return result;

  const userSnap = await adminDb.collection('users').doc(result.uid).get();
  if (!userSnap.exists || userSnap.data()?.appRole !== 'manager') {
    return unauthorized('Manager role required');
  }
  return result;
}
