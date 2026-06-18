// Standalone Node ESM script. Run AFTER you create the 2 test accounts in the
// Firebase console (Authentication > Add user):
//   node --env-file=.env.local scripts/link-users.mjs
//
// This does NOT create Auth users. It resolves each account's UID by email and
// writes the matching login-identity doc at users/{authUid} = { employeeId,
// appRole, email }, then backfills employees/{employeeId} with { authUid, email }.

import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

function initAdmin() {
  if (getApps().length) return;
  const raw = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_ADMIN_SERVICE_ACCOUNT is not set');
  const svc = JSON.parse(raw);
  svc.private_key = svc.private_key.replace(/\\n/g, '\n');
  initializeApp({ credential: cert(svc) });
}

// The 2 POC test accounts. Emails come from env to match whatever you used in
// the console; the employeeId/appRole mapping is fixed to the roster.
const ACCOUNTS = [
  {
    email: process.env.TEST_MANAGER_EMAIL,
    employeeId: 'M001', // Jordan Reed
    appRole: 'manager',
  },
  {
    email: process.env.TEST_INSTRUCTOR_EMAIL,
    employeeId: 'I001', // Avery Johnson
    appRole: 'employee',
  },
];

async function main() {
  initAdmin();
  const auth = getAuth();
  const db = getFirestore();

  for (const acct of ACCOUNTS) {
    if (!acct.email) {
      throw new Error(
        `Missing email env var for ${acct.employeeId}. Set TEST_MANAGER_EMAIL and TEST_INSTRUCTOR_EMAIL in .env.local.`,
      );
    }

    let user;
    try {
      user = await auth.getUserByEmail(acct.email);
    } catch {
      throw new Error(
        `No Firebase Auth user found for ${acct.email}. Create it in the console first (Authentication > Add user), then re-run.`,
      );
    }

    const uid = user.uid;

    await db.collection('users').doc(uid).set({
      employeeId: acct.employeeId,
      appRole: acct.appRole,
      email: acct.email,
    });

    await db
      .collection('employees')
      .doc(acct.employeeId)
      .set({ authUid: uid, email: acct.email }, { merge: true });

    console.log(`Linked ${acct.email} -> users/${uid} (${acct.employeeId}, ${acct.appRole})`);
  }

  console.log('Done linking test users.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
