import {
  collection,
  doc,
  getDoc,
  getDocs,
  type CollectionReference,
  type DocumentData,
  type FirestoreDataConverter,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';

import { db } from '@/lib/firebase.client';
import type {
  CommunityEvent,
  Employee,
  Location,
  Punch,
  RoleConfig,
  Shift,
  SwapRequest,
  TimeOffRequest,
  UserIdentity,
} from '@/lib/types';

// Generic converter: trusts the stored shape and mirrors the doc id into `id`
// where the type has one.
function converter<T>(): FirestoreDataConverter<T> {
  return {
    toFirestore: (data) => data as DocumentData,
    fromFirestore: (snap: QueryDocumentSnapshot): T =>
      ({ id: snap.id, ...snap.data() }) as T,
  };
}

function typedCollection<T>(name: string): CollectionReference<T> {
  return collection(db, name).withConverter(converter<T>());
}

export const collections = {
  locations: () => typedCollection<Location>('locations'),
  roles: () => typedCollection<RoleConfig>('roles'),
  employees: () => typedCollection<Employee>('employees'),
  shifts: () => typedCollection<Shift>('shifts'),
  punches: () => typedCollection<Punch>('punches'),
  timeOffRequests: () => typedCollection<TimeOffRequest>('timeOffRequests'),
  swapRequests: () => typedCollection<SwapRequest>('swapRequests'),
  events: () => typedCollection<CommunityEvent>('events'),
  users: () => typedCollection<UserIdentity>('users'),
};

export async function getAll<T>(ref: CollectionReference<T>): Promise<T[]> {
  const snap = await getDocs(ref);
  return snap.docs.map((d) => d.data());
}

export async function getById<T>(
  ref: CollectionReference<T>,
  id: string,
): Promise<T | null> {
  const snap = await getDoc(doc(ref.firestore, ref.path, id).withConverter(ref.converter!));
  return snap.exists() ? snap.data() : null;
}
