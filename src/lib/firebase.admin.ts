import 'server-only';

import { cert, getApps, initializeApp, type ServiceAccount } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

function initAdmin() {
  if (getApps().length) return;

  const raw = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT;
  if (!raw) {
    throw new Error('FIREBASE_ADMIN_SERVICE_ACCOUNT is not set');
  }

  const svc = JSON.parse(raw) as ServiceAccount & { private_key: string };
  // The service-account JSON stored as one env string keeps its private key
  // with literal "\n"; un-escape it or token verification throws "invalid PEM".
  svc.private_key = svc.private_key.replace(/\\n/g, '\n');

  initializeApp({ credential: cert(svc) });
}

initAdmin();

export const adminAuth = getAuth();
export const adminDb = getFirestore();
