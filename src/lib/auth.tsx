'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  type User,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase.client';
import type { Employee, UserIdentity } from '@/lib/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuthState {
  firebaseUser: User | null;
  userIdentity: UserIdentity | null;
  employee: Employee | null;
  /** true while Firebase is restoring the session or reading Firestore */
  loading: boolean;
}

interface AuthContextValue extends AuthState {
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    firebaseUser: null,
    userIdentity: null,
    employee: null,
    loading: true,
  });

  useEffect(() => {
    // onAuthStateChanged fires once immediately with the restored session
    // (or null), then again whenever the user signs in / out.
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setState({ firebaseUser: null, userIdentity: null, employee: null, loading: false });
        return;
      }

      // Step 1: read users/{authUid} for employeeId + appRole.
      // appRole is NOT a token claim — must be read from Firestore.
      const identitySnap = await getDoc(doc(db, 'users', user.uid));
      if (!identitySnap.exists()) {
        // Account exists in Auth but has no identity doc — treat as unprovisioned.
        setState({ firebaseUser: user, userIdentity: null, employee: null, loading: false });
        return;
      }
      const identity = identitySnap.data() as UserIdentity;

      // Step 2: load the full employee roster doc.
      const empSnap = await getDoc(doc(db, 'employees', identity.employeeId));
      const employee = empSnap.exists()
        ? ({ id: empSnap.id, ...empSnap.data() } as Employee)
        : null;

      setState({ firebaseUser: user, userIdentity: identity, employee, loading: false });
    });

    return unsubscribe;
  }, []);

  const signIn = async (email: string, password: string) => {
    // Actual sign-in; onAuthStateChanged handles the state update.
    await signInWithEmailAndPassword(auth, email, password);
  };

  const signOut = async () => {
    await fbSignOut(auth);
  };

  return (
    <AuthContext.Provider value={{ ...state, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
