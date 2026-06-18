# PLAN.md — ShiftWave

> Scheduling & timekeeping app for a multi-location swim school (~23 staff).
> This file is the single source of truth. **Cursor and Claude Code: read this top to bottom before writing code, and re-read the relevant phase before starting it.** Build phases in order. Do not start a phase until the previous phase's acceptance criteria pass.

---

## 0. How to use this file (for the AI coding agents)

- Treat every **Acceptance criteria** block as a definition of done. A phase is complete only when all its boxes can be checked.
- Build **Phase 1 → 9 in order.** Phases 1–3 are the required floor; 4–7 are the differentiators; 8–9 finish and ship.
- After each phase: run `npm run build`, fix type errors, then `git commit` with the message given in the phase.
- Use the **business constants in §6** and the **types in §5** as ground truth — do not invent shapes.
- Keep components small (one component per file). Prefer server logic in Route Handlers, UI in client components.
- When unsure about a product/version detail (Gemini model name, a Vercel setting), check the official docs rather than guessing.

---

## 0.5 — End-to-end gotchas & fixes (READ BEFORE PHASE 1)

These close the gaps that otherwise make the build stall or the demo look broken. This section is authoritative; where it conflicts with anything below, follow this.

### Identity model (the critical one)
There are **two separate concepts** — keep their collections distinct:
- `employees/{employeeId}` — the roster (the `Employee` type), keyed by the sheet ID like `I001`. `shifts.employeeId` and `punches.employeeId` reference this. **The import writes here.**
- `users/{authUid}` — the login identity, keyed by the **Firebase Auth UID**, shape `{ employeeId: string, appRole: 'manager'|'employee', email: string }`. Created when an account is provisioned, **not** by the bulk import.

Login flow: sign in → read `users/{auth.uid}` → get `employeeId` + `appRole` → load `employees/{employeeId}` for the profile. Security rules resolve role/identity by reading `users/{auth.uid}`. This is why the two collections must be separate.

For the POC, only the **2 test accounts** get real Firebase Auth logins (+ their `users/{uid}` doc). The other ~21 employees exist only as `employees/*` roster docs — they're schedulable entities, not logins. State this as an assumption.

### Scaffolding (exact)
```bash
npx create-next-app@latest . --typescript --tailwind --app --eslint --src-dir --import-alias "@/*"
npm install firebase firebase-admin recharts xlsx
npm install -D @types/node
```
Tailwind ships v4 now: styling is set up via `@import "tailwindcss";` in `src/app/globals.css` and the `@tailwindcss/postcss` plugin — there is **no** `tailwind.config.js` by default. Don't follow v3 tutorials that add one.

### Firebase Admin SDK init (private-key newline trap)
The service-account JSON stored as one env string keeps its private key with literal `\n`. You **must** un-escape it or token verification throws "invalid PEM":
```ts
const svc = JSON.parse(process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT!);
svc.private_key = svc.private_key.replace(/\\n/g, '\n');
initializeApp({ credential: cert(svc) });
```
Also guard against re-init in dev/serverless: `if (!getApps().length) initializeApp(...)`.

### Route Handlers must use the Node runtime
`firebase-admin` does **not** run on the Edge runtime. In every route under `src/app/api/**`, add:
```ts
export const runtime = 'nodejs';
```

### Gemini SDK + structured output
Use the current unified SDK: `npm install @google/genai` (not the deprecated `@google/generative-ai`). Request JSON-only with a response schema; parse defensively. Confirm the current fast model name in Google AI Studio (e.g. `gemini-2.5-flash`).
```ts
import { GoogleGenAI } from '@google/genai';
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
const res = await ai.models.generateContent({
  model: 'gemini-2.5-flash',
  contents: prompt,
  config: { responseMimeType: 'application/json' /*, responseSchema: {...} */ },
});
const draft = JSON.parse(res.text);
```

### Time, timezone & the demo date
- All locations are **US Central (America/Chicago)**. Times in the data are local wall-clock strings (`'16:30'`). Treat them as Central; don't let `new Date('2026-06-22T16:30')` silently use the server's UTC.
- Compute worked hours as `clockOut − clockIn` on the **same local day**; store/compare as minutes-since-midnight to avoid TZ bugs.
- The seeded schedule is the week of **Mon 2026-06-22**. So "today's shift" will be empty on any other date. **On the clock-in screen, let the user pick any of their upcoming shifts to clock into** (don't hard-filter to the real `today`), or expose a `DEMO_DATE` constant defaulting to `2026-06-22`. Without this the clock-in demo looks broken.

### Firestore indexes
Single-field queries (`shifts where employeeId ==`, `punches where managerReviewStatus ==`) auto-index. If you add a **compound** query (e.g. employee + date range), Firestore throws an error with a one-click link to create the composite index — create it then.

### Add the missing `Role` type
`types.ts` should also include the roster of role configs the import writes to `roles/`:
```ts
export interface RoleConfig {
  role: RoleName; canClockIn: boolean; requiresGeofence: boolean;
  canWorkRemote: boolean; defaultShiftLengthHours: number;
}
```

### Import column mapping (sheet → field)
Sheets are named exactly `Locations`, `Employees`, `Roles`, `Schedule`, `TimePunches`. Headers map directly to the type fields; the only transforms are: split `EligibleLocations` on `,`; convert serial `Date` → ISO; coerce `TRUE/FALSE` strings to booleans; empty lat/lng → `null`; set `employees.appRole = primaryRole === 'Manager' ? 'manager' : 'employee'`.

### Sample data file — where it goes
Commit the provided workbook to the repo at `data/scheduling_timekeeping_demo_sample_data.xlsx` (it's demo data, not a secret, so committing it is correct — it lets the import run on any clone). The import script reads it from there. It does **not** go in the bare project root.

### Running the seed scripts
`scripts/import-sample-data.mjs` and `scripts/link-users.mjs` are standalone Node ESM, **not** part of the Next app — they init the Admin SDK directly (don't import the Next `firebase.admin.ts`) and read env via Node's `--env-file`:
```bash
node --env-file=.env.local scripts/import-sample-data.mjs
node --env-file=.env.local scripts/link-users.mjs   # after creating the 2 Auth accounts
```
Node 20.6+. The service account comes from `FIREBASE_ADMIN_SERVICE_ACCOUNT`; apply the same `\n` un-escape shown above.

### Document IDs for new records
The seed keeps its sheet IDs (`S0001`, `P0001`) so references line up. **New** shifts (editor + AI scheduler) and **new** punches (clock-in) use Firestore **auto-generated IDs** via `addDoc` — never hand-mint the next `S####`. Mirror the generated doc ID into the record's `id` field after creation.

### Data access & the server/client boundary
Client components use the Firebase **web SDK**: `onSnapshot` where a phase says "real-time" (review queue, schedule), `getDocs`/`getDoc` otherwise. Server Route Handlers and the `.mjs` scripts use the **Admin SDK**. Put `import 'server-only';` at the top of `firebase.admin.ts` so it can never be bundled into the client.

### Access model (who sees which pages)
"Employee" pages (`/schedule`, `/clock`, `/requests`) are for **any signed-in user** — managers work pool shifts too, so they must be able to clock in. Only the manager pages (`/dashboard`, `/schedule-editor`, `/review-queue`, `/approvals`, `/payroll`) are gated to `appRole === 'manager'`. Each route group gets a `layout.tsx` that redirects unauthenticated users to `/login` and wrong-role users to their home — protect the routes, don't just hide nav links.

### Events have no coordinates
The `EVT` location has blank lat/lng in the sheet (events are per-occurrence) and this POC does not model per-event coordinates. Treat **event clock-ins as `No Geofence`** (skip the distance check) and note it as a limitation. Pool and remote handling are unchanged.

---

## 1. Goal & scope

A proof-of-concept replacement for When I Work / Teams Shifts. Two experiences in one app, gated by role:

- **Employees** (Instructors, Ambassadors) view their schedule, clock in/out (geofenced), request time off, request shift swaps.
- **Managers** create/manage schedules, approve requests, review flagged punches, auto-generate schedules with AI, see a dashboard, and export payroll to Gusto.

**Four flagship features** (these are the differentiators — build them well):
1. 🤖 **AI Auto-Scheduler** (Phase 6) — "Generate next week" → Gemini drafts a schedule respecting coverage, eligibility, hours, and time-off. Manager reviews + accepts.
2. 🚩 **Punch Review Queue** (Phase 5) — manager inbox of auto-flagged punches (outside geofence / outside time window), one-tap Approve/Reject.
3. ⚠️ **Conflict & coverage detection** (Phase 4) — live warnings in the editor: double-booking, ineligible location, understaffed shift (red).
4. 📊 **Manager dashboard** (Phase 7) — hours per employee, overtime risk, labor-cost estimate, coverage gaps.

---

## 2. Tech stack (decided — do not substitute)

- **Next.js (App Router, latest stable 15+), TypeScript, React 18+**
- **Tailwind CSS** for styling (Tailwind v4 — see §0.5). Skip shadcn/ui for the deadline; plain Tailwind is faster and avoids the v4 init friction.
- **Firebase**: Authentication (email/password) + Cloud Firestore (data)
- **Firebase Admin SDK** (server-side, for verifying ID tokens in Route Handlers)
- **Google Gemini API** for the AI scheduler — call a current fast model (e.g. `gemini-2.5-flash`; confirm exact name in Google AI Studio) from a server Route Handler only
- **recharts** for dashboard charts
- **xlsx** (SheetJS) for the one-off data import script
- **Hosting/deploy: Vercel (free Hobby tier)**, auto-deploy from the GitHub repo
- **PWA**: web app manifest + installability (Phase 9)

**Why Next.js over plain React:** the AI scheduler needs the Gemini key kept server-side. Next.js Route Handlers provide that with no extra infra. Firebase stays the Google-ecosystem data/auth layer.

---

## 3. Hard constraints

- **Long-term cost must be ~$0.** Firebase Spark (free, no card) + Vercel Hobby (free) + Gemini free tier. Stay within Spark — **do not use Cloud Functions or Firebase App Hosting** (those need Blaze/billing).
- **Never expose the Gemini API key client-side.** It lives only in a server Route Handler env var.
- Firebase **web config is public** (safe in client). The **Admin SDK service account is secret** (server env only).
- Enforce permissions in **Firestore Security Rules**, not just the UI.

---

## 4. Repo structure

```
/
├─ PLAN.md                      ← this file
├─ CLAUDE.md                    ← short pointer: "Follow PLAN.md. Stack: Next.js+TS+Firebase+Gemini. Run npm run build before committing."
├─ .env.local                   ← gitignored (see §7)
├─ .env.example                 ← committed, keys with empty values
├─ next.config.ts
├─ public/
│  ├─ manifest.webmanifest
│  └─ icons/
├─ scripts/
│  ├─ import-sample-data.mjs    ← xlsx → Firestore (run once)
│  └─ link-users.mjs            ← create users/{authUid} docs for the 2 test logins
├─ data/
│  └─ scheduling_timekeeping_demo_sample_data.xlsx   ← copy the provided file here
├─ src/
│  ├─ app/
│  │  ├─ layout.tsx
│  │  ├─ page.tsx               ← redirect to /login or role home
│  │  ├─ login/page.tsx
│  │  ├─ (employee)/
│  │  │  ├─ schedule/page.tsx
│  │  │  ├─ clock/page.tsx
│  │  │  └─ requests/page.tsx   ← time-off + swaps
│  │  ├─ (manager)/
│  │  │  ├─ dashboard/page.tsx
│  │  │  ├─ schedule-editor/page.tsx
│  │  │  ├─ review-queue/page.tsx
│  │  │  ├─ approvals/page.tsx
│  │  │  └─ payroll/page.tsx
│  │  └─ api/
│  │     ├─ generate-schedule/route.ts   ← server: verify token + call Gemini
│  │     └─ export/gusto/route.ts         ← (optional) server CSV; client CSV also fine
│  ├─ components/               ← small, reusable UI
│  ├─ lib/
│  │  ├─ firebase.client.ts     ← web SDK init (auth, db)
│  │  ├─ firebase.admin.ts      ← admin SDK init (server only)
│  │  ├─ auth.tsx               ← auth context/hook + role guard
│  │  ├─ constants.ts           ← §6 business rules
│  │  ├─ types.ts               ← §5 types
│  │  ├─ validators.ts          ← §12 shared rules (conflict/coverage/eligibility)
│  │  ├─ geofence.ts            ← Haversine + status
│  │  ├─ gusto.ts               ← CSV builder
│  │  └─ firestore.ts           ← typed read/write helpers
│  └─ styles/
└─ firestore.rules
```

---

## 5. Data model (`src/lib/types.ts`)

Use the sheet IDs as Firestore document IDs so the import maps 1:1.

```ts
export type RoleName = 'Manager' | 'Ambassador' | 'Instructor' | 'Remote Admin' | 'Event Lead';
export type AppRole = 'manager' | 'employee';

export interface Location {
  id: string;            // 'ARL'
  name: string;          // 'Arlington'
  type: string;          // 'Swim School' | 'Remote Work' | 'Community Event'
  address: string;
  lat: number | null;
  lng: number | null;
  geofenceRadiusFt: number;
  geofenceRequired: boolean;
}

export interface Employee {
  id: string;            // 'I001'
  firstName: string;
  lastName: string;
  primaryRole: RoleName;
  secondaryRole?: RoleName;
  eligibleLocations: string[];   // ['ARL','GP']
  avgWeeklyHours: number;
  status: 'Active' | 'Inactive';
  authUid?: string;      // set after they sign up
  email?: string;
  appRole: AppRole;      // 'manager' if Manager, else 'employee'
}

export interface Shift {
  id: string;            // 'S0001'
  date: string;          // ISO 'YYYY-MM-DD'
  day: string;           // 'Monday'
  locationId: string;
  locationName: string;
  shiftType: 'Pool Shift' | 'Remote Admin' | 'Event';
  role: RoleName;
  employeeId: string;
  employeeName: string;
  startTime: string;     // '16:30'
  endTime: string;       // '20:30'
  scheduledHours: number;
  status: 'Scheduled' | 'Draft' | 'Cancelled';
}

export type GeofenceStatus = 'Inside Geofence' | 'Outside Geofence' | 'No Geofence';
export type TimingStatus = 'On Time' | 'Outside Window';
export type ReviewStatus = 'Approved' | 'Needs Review' | 'Rejected';

export interface Punch {
  id: string;            // 'P0001'
  shiftId: string;
  employeeId: string;
  date: string;
  locationId: string;
  scheduledStart: string;
  scheduledEnd: string;
  clockIn: string | null;
  clockOut: string | null;
  clockInLat: number | null;
  clockInLng: number | null;
  geofenceStatus: GeofenceStatus;
  clockInTimingStatus: TimingStatus;
  managerReviewStatus: ReviewStatus;
}

export interface TimeOffRequest {
  id: string;
  employeeId: string;
  startDate: string;
  endDate: string;
  reason: string;
  status: 'Pending' | 'Approved' | 'Denied';
  createdAt: number;
}

export interface SwapRequest {
  id: string;
  shiftId: string;
  fromEmployeeId: string;
  toEmployeeId: string;     // proposed replacement
  status: 'Pending' | 'Approved' | 'Denied';
  createdAt: number;
}
```

**Date conversion (sample uses Excel serials):** `46195` → `2026-06-22`. Formula: `new Date(Date.UTC(1899,11,30) + serial*86400000)`. Spot-check that `46195` parses to Monday June 22, 2026.

---

## 6. Business rules (`src/lib/constants.ts`)

These are derived from the sample data. The validators and the AI scheduler both read from here — never hard-code them elsewhere.

```ts
// Coverage required per shift type. Used by coverage detection AND the AI scheduler.
export const COVERAGE_RULES = {
  'Pool Shift':   { Manager: 1, Ambassador: 1, Instructor: 4 }, // min per pool shift
  'Event':        { 'Event Lead': 1, Ambassador: 2, Instructor: 2 },
  'Remote Admin': { 'Remote Admin': 1 },
} as const;

// Standard shift windows (from the data). Saturday pool shifts are mornings.
export const SHIFT_WINDOWS = {
  ARL: { weeknight: ['16:30','20:30'], saturday: ['08:00','12:00'] },
  GP:  { weeknight: ['16:45','20:45'], saturday: ['08:00','12:00'] },
  MAN: { weeknight: ['17:00','21:00'], saturday: ['08:00','12:00'] },
};

export const GEOFENCE = {
  defaultPoolRadiusFt: 200,
  eventRadiusFt: 300,
  feetToMeters: 0.3048,
  // a clock-in counts "On Time" if within this many minutes of scheduled start
  onTimeWindowMinutes: 10,
};

export const OVERTIME_THRESHOLD_HOURS = 40; // per week, FLSA/TX standard (ASSUMPTION)

// Pay rates are NOT in the source data — ASSUMPTION, configurable. Used only for the
// labor-cost ESTIMATE on the dashboard. Document this clearly in the UI + writeup.
export const DEFAULT_HOURLY_RATE: Record<string, number> = {
  Instructor: 18, Ambassador: 20, Manager: 28, 'Event Lead': 28, 'Remote Admin': 28,
};
```

---

## 7. Environment variables

`.env.local` (gitignored) and `.env.example` (committed, empty values):

```
# Firebase web config (PUBLIC — safe in client, NEXT_PUBLIC_ prefix required)
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=

# Server-only secrets (NEVER prefixed with NEXT_PUBLIC)
GEMINI_API_KEY=
FIREBASE_ADMIN_SERVICE_ACCOUNT=   # the service-account JSON, as a single-line string
```

Set the same vars in the Vercel project settings before deploying.

---

## PHASE 1 — Foundation

**Build:**
- Scaffold Next.js (App Router, TS, Tailwind) if not already done.
- `src/lib/firebase.client.ts` (init Auth + Firestore from `NEXT_PUBLIC_*`).
- `src/lib/firebase.admin.ts` (init Admin SDK from `FIREBASE_ADMIN_SERVICE_ACCOUNT`; server-only).
- `src/lib/types.ts`, `constants.ts`, `firestore.ts` helpers.
- App shell: top nav, role-aware layout, light/dark-safe styling.
- `scripts/import-sample-data.mjs`: read the xlsx in `data/`, convert serial dates, write `locations`, `roles`, `employees` (roster, keyed by employee ID), `shifts`, `punches` to Firestore via Admin SDK. Run once. (See §0.5 "Identity model" and "Import column mapping".)
- Create 2 test logins in Firebase Auth (one manager — e.g. M001 Jordan Reed — and one instructor — e.g. I001 Avery Johnson) and, for each, write a `users/{authUid}` doc `{ employeeId, appRole, email }`. A tiny `scripts/link-users.mjs` is the clean way to do this. Store creds in `docs/TEST_USERS.md` (gitignored).
- Seed a little demo activity so the request/approval and AI flows aren't empty: 1 **approved** and 1 **pending** time-off request (optionally 1 pending swap). Put the approved one inside the demo week so the AI scheduler (Phase 6) visibly routes around that person.

**Acceptance criteria**
- [ ] `npm run build` passes.
- [ ] Firestore contains 5 locations, 23 employees, ~134 shifts, sample punches, and a `users/{uid}` doc for each of the 2 test accounts.
- [ ] Dates are ISO strings; `46195` shows as `2026-06-22`.
- [ ] App runs locally at `/`.
- [ ] Seed includes ≥1 approved and ≥1 pending time-off request.

**Commit:** `feat: foundation — next.js, firebase, types, data import`

---

## PHASE 2 — Auth & employee core (required floor)

**Build:**
- `src/lib/auth.tsx`: auth context, `useAuth()`, sign-in/sign-out, plus route-group `layout.tsx` guards — employee pages allow any signed-in user, manager pages require `appRole==='manager'`; unauthenticated → redirect to `/login`, wrong-role → redirect home. (See §0.5 "Access model".)
- `/login`: email/password sign-in. On success, read `users/{auth.uid}` → get `employeeId` + `appRole`, load `employees/{employeeId}` for the profile, route to employee or manager home by `appRole`. (See §0.5 identity model.)
- **Employee schedule** (`/schedule`): query `shifts where employeeId == me`, grouped by day, card/list view, week navigation.
- **Clock in/out** (`/clock`):
  - Show today's shift(s) for the user.
  - Clock-in captures geolocation via `navigator.geolocation.getCurrentPosition`.
  - Compute geofence + timing status via `src/lib/geofence.ts` (Haversine; convert `geofenceRadiusFt` to meters). Remote shifts → `No Geofence`.
  - Timing: within `onTimeWindowMinutes` of scheduled start → `On Time`, else `Outside Window`.
  - If `Outside Geofence` OR `Outside Window` → set `managerReviewStatus='Needs Review'`, else `Approved`.
  - Write a `punches` doc; clock-out updates `clockOut`.
  - Handle permission-denied gracefully (allow punch with a note, flagged for review).
- **Requests** (`/requests`): time-off form → `timeOffRequests`; shift-swap form (pick my shift + a proposed replacement) → `swapRequests`.

**Acceptance criteria**
- [ ] Instructor login sees only their shifts.
- [ ] Clock-in inside a pool's radius → `Inside Geofence` + `Approved`; faking coords outside → `Outside Geofence` + `Needs Review`.
- [ ] Time-off and swap requests persist with `Pending` status.

**Commit:** `feat: auth + employee schedule, geofenced clock-in, requests`

---

## PHASE 3 — Manager schedule editor (required floor)

**Build:**
- `/schedule-editor`: grid of the week (rows = locations, columns = days). Show all shifts. Add/edit/delete a shift (date, location, role, employee, start/end). Compute `scheduledHours` from start/end on write; new shifts use Firestore auto-IDs (§0.5).
- Employee picker filters to those whose `eligibleLocations` include the chosen location.
- `/approvals`: list pending time-off + swap requests; Approve/Deny updates status (and applies the swap to the shift on approval).

**Acceptance criteria**
- [ ] Manager can create, edit, delete a shift and it persists.
- [ ] Employee dropdown excludes ineligible staff for the selected location.
- [ ] Approving a swap reassigns the shift's `employeeId`.

**Commit:** `feat: manager schedule editor + approvals`

---

## PHASE 4 — ⚠️ Conflict & coverage detection (FLAGSHIP)

Implement once in `src/lib/validators.ts` as **pure functions**, reused by the editor (Phase 3/4) and the AI scheduler (Phase 6).

```ts
// All return structured results so UI can render badges/colors.
export function checkDoubleBooking(shift, allShiftsForEmployeeOnDate): Issue[];   // overlapping times same day, any location
export function checkEligibility(shift, employee): Issue | null;                  // location not in eligibleLocations
export function checkOverHours(employeeId, weekShifts, employee): Issue | null;   // weekly scheduled > avgWeeklyHours (soft) or > OVERTIME_THRESHOLD (hard)
export function checkCoverage(shiftsForLocationDay, shiftType): CoverageResult;   // vs COVERAGE_RULES → missing roles / understaffed
export function validateSchedule(shifts, employees): ValidationReport;            // runs all of the above over a set
```

**Wire into the editor:**
- On add/edit, run the relevant checks live.
- Double-booking → block or warn (red toast). Ineligible location → block. Over-hours → amber warning.
- In the grid, **understaffed pool shifts are highlighted red** with a tooltip listing what's missing (e.g. "needs 1 Ambassador, 2 more Instructors").
- A small "coverage summary" panel shows gaps for the week.

**Acceptance criteria**
- [ ] Assigning the same person to overlapping shifts triggers a visible conflict.
- [ ] A pool shift missing its manager/ambassador/min-instructors renders red with a clear reason.
- [ ] Over-hours assignment shows an amber warning but is allowed.

**Commit:** `feat: conflict + coverage validators wired into editor`

---

## PHASE 5 — 🚩 Punch review queue (FLAGSHIP)

**Build:**
- `/review-queue`: query `punches where managerReviewStatus == 'Needs Review'`.
- Each row: employee, shift context, scheduled vs actual clock times, `geofenceStatus`, `clockInTimingStatus`, distance-from-site (compute from stored lat/lng), and the flag reason.
- One-tap **Approve** (→ `Approved`) / **Reject** (→ `Rejected`, optional reason). Optimistic UI, real-time refresh.
- Badge in the nav with the count of pending reviews.
- (Nice) a small map or distance readout per punch using the location's coords.

**Acceptance criteria**
- [ ] Only flagged punches appear; approving/rejecting removes them from the queue and updates Firestore.
- [ ] The flag reason (geofence vs timing) is shown for each.
- [ ] Approved punches are the ones eligible for payroll export (Phase 8).

**Commit:** `feat: punch review queue with one-tap approve/reject`

---

## PHASE 6 — 🤖 AI auto-scheduler (FLAGSHIP)

**Architecture:** LLM proposes → deterministic validator repairs/flags. Never trust raw LLM output for hard constraints.

**Server Route Handler** `src/app/api/generate-schedule/route.ts`:
1. Verify the caller's Firebase **ID token** with the Admin SDK, then read `users/{uid}` (Admin SDK) to confirm `appRole==='manager'` — `appRole` is **not** a token claim, so it must be read from Firestore. Reject with 401 otherwise.
2. Gather inputs for the target week: locations + `COVERAGE_RULES`, active employees (`eligibleLocations`, `avgWeeklyHours`, role), approved time-off, and `SHIFT_WINDOWS`.
3. Call Gemini (`GEMINI_API_KEY`, server-side only) with a structured prompt. **Request JSON only** (set `responseMimeType: 'application/json'` and provide a response schema). The model returns an array of draft shift assignments.
4. Run `validateSchedule()` (§Phase 4) on the draft. Auto-repair what you safely can (drop ineligible/over-hours assignments); attach a list of remaining issues.
5. Return `{ draftShifts, issues }`. **Do not write to Firestore here.**

**Prompt shape (system + user):**
- System: "You are a scheduling assistant for a swim school. Produce a one-week schedule as JSON only. Honor these hard rules: every Pool Shift needs ≥1 Manager, ≥1 Ambassador, ≥4 Instructors; only assign employees whose eligibleLocations include the shift location; keep each employee near their avgWeeklyHours; never double-book; respect approved time-off. Use the provided shift windows."
- User: JSON blob of locations, employees, time-off, windows, and the target week dates.
- Output schema: `[{ date, locationId, shiftType, role, employeeId, startTime, endTime }]`.

**Client (`/schedule-editor`):**
- "✨ Generate next week" button → calls the route with the user's ID token in the `Authorization: Bearer` header.
- Render the returned draft in a **review modal**: highlight any `issues`, let the manager tweak, then **Accept** writes the shifts to Firestore with `status: 'Scheduled'`. **Reject** discards.

**Acceptance criteria**
- [ ] Non-managers get 401 from the route.
- [ ] Gemini key never appears in the client bundle/network tab.
- [ ] Generated draft respects eligibility + coverage (post-validation); remaining issues are surfaced, not hidden.
- [ ] Manager can accept the draft and it becomes real shifts.

**Commit:** `feat: AI auto-scheduler (Gemini route + validate-and-repair + review)`

---

## PHASE 7 — 📊 Manager dashboard (FLAGSHIP)

**Build** `/dashboard` with `recharts`:
- **Hours per employee** (bar chart) for the selected week — scheduled and/or actual (from approved punches).
- **Overtime risk**: employees over `OVERTIME_THRESHOLD_HOURS` or over their `avgWeeklyHours` flagged.
- **Labor-cost estimate**: Σ hours × `DEFAULT_HOURLY_RATE[role]`. Label clearly as an estimate based on assumed rates.
- **Coverage gaps**: count/list of understaffed shifts this week (reuse `checkCoverage`).
- Top KPI cards: total scheduled hours, # employees scheduled, # coverage gaps, # punches needing review.

**Acceptance criteria**
- [ ] Charts render real Firestore data for the selected week.
- [ ] Overtime and coverage-gap numbers match the validators.
- [ ] Labor cost shows with an explicit "estimated / assumed rates" note.

**Commit:** `feat: manager dashboard (hours, overtime, labor cost, coverage)`

---

## PHASE 8 — Gusto payroll export

**Build** `src/lib/gusto.ts` + a button on `/payroll`:
- Manager picks a pay period (default the week, Mon–Sun).
- Sum hours per employee from **approved** punches (`clockOut − clockIn`). Hours over 40/week → overtime column. Approved time-off → PTO.
- Generate CSV with columns: `First Name, Last Name, Employee ID, Regular Hours, Overtime Hours, PTO Hours`. Round to 2 decimals.
- Trigger a client-side download. (Gusto's importer matches employees by name/ID and maps Regular/Overtime/PTO hour types on upload.)
- Show which punches were excluded (still `Needs Review`/`Rejected`).

**Acceptance criteria**
- [ ] Downloaded CSV opens cleanly and only includes approved hours.
- [ ] Overtime split at 40h/week is correct.

**Commit:** `feat: Gusto-compatible payroll CSV export`

---

## PHASE 9 — PWA, security rules, polish, deploy

**Build:**
- `public/manifest.webmanifest` + icons; make the app installable; ensure mobile clock-in screen is thumb-friendly.
- `firestore.rules`: employees read/write only their own shifts/punches/requests; managers read/write all; deny everything else by default. Deploy rules.
- Empty/loading/error states, a consistent header, a help/"about" note describing assumptions.
- **Deploy to Vercel**: import the GitHub repo, set all env vars (§7), deploy. Confirm the live URL works in an incognito window with the test logins.

**Acceptance criteria**
- [ ] Live Vercel URL loads; both test users can sign in and use their flows.
- [ ] Security rules block cross-user access (test: instructor can't read another's punches).
- [ ] App has a valid web manifest + icons and is installable in Chrome (service worker optional for the POC).

**Commit:** `feat: PWA, security rules, polish, production deploy`

---

## 12. Shared validator module — notes

- Keep `validators.ts` UI-agnostic and pure (no Firebase imports). Pass data in, get structured results out. This lets the editor, the AI repair step, and the dashboard all reuse the exact same logic — a strong architecture talking point.
- Define these result types in `types.ts`:
```ts
export interface Issue {
  kind: 'double-booking' | 'ineligible' | 'over-hours' | 'understaffed';
  severity: 'error' | 'warning';
  message: string;
  employeeId?: string;
  shiftId?: string;
}
export interface CoverageResult {
  locationId: string; date: string; shiftType: Shift['shiftType'];
  satisfied: boolean;
  missing: { role: RoleName; need: number; have: number }[];
}
export interface ValidationReport {
  issues: Issue[];
  coverage: CoverageResult[];
  ok: boolean; // true if no 'error'-severity issues and all coverage satisfied
}
```

## 13. Security rules sketch (`firestore.rules`)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    function signedIn() { return request.auth != null; }
    function profile()  { return get(/databases/$(db)/documents/users/$(request.auth.uid)).data; }
    function myEmployeeId() { return profile().employeeId; }
    function isManager()    { return signedIn() && profile().appRole == 'manager'; }

    match /users/{uid}     { allow read: if request.auth.uid == uid || isManager(); allow write: if false; } // provisioned by Admin SDK only
    match /employees/{id}  { allow read: if signedIn(); allow write: if isManager(); }
    match /locations/{id}  { allow read: if signedIn(); allow write: if isManager(); }
    match /roles/{id}      { allow read: if signedIn(); allow write: if isManager(); }
    match /shifts/{id}     { allow read: if signedIn(); allow write: if isManager(); }
    match /punches/{id} {
      allow read:   if isManager() || resource.data.employeeId == myEmployeeId();
      allow create: if signedIn() && request.resource.data.employeeId == myEmployeeId();
      allow update: if isManager(); // only managers change review status
    }
    match /timeOffRequests/{id} { allow read, create: if signedIn(); allow update: if isManager(); }
    match /swapRequests/{id}    { allow read, create: if signedIn(); allow update: if isManager(); }
  }
}
```
Principle: identity/role comes from `users/{auth.uid}`; the roster lives in `employees/*`; employees touch only their own punches/requests, managers manage all. `users` docs are written only via the Admin SDK (server), never the client.

## 14. Commit conventions / Definition of Done

- Conventional commits (`feat:`, `fix:`, `chore:`). One commit per completed phase minimum.
- `npm run build` must pass before every commit. No `any` where a real type exists. No secrets committed.

## 15. Out of scope (list these as "what I'd build next")

Server-side geofence validation + App Check (anti-spoofing) · push/email notifications · Google SSO · Google Sheets/Calendar sync · recurring shift templates · audit log + payroll-period locking · direct Gusto API integration · native wrapper for background geofencing.

## 16. Assumptions (keep this list updated for the writeup)

- Two access roles: `manager` and `employee` (Ambassadors + Instructors are employees).
- Weekly pay period (Mon–Sun); overtime = hours over 40/week.
- Geofence radius read per location (200 ft pools, 300 ft events, none remote); on-time window = 10 min.
- Only manager-approved punches count toward payroll.
- Clock-in geofencing is client-side for the POC (production: server-side validation — noted limitation).
- Hourly pay rates are assumed/configurable (not in source data) and used only for the labor-cost estimate.
- Sample week is fixed (week of June 22, 2026); times are local to each location.
```
