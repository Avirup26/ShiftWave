# ShiftWave

Scheduling and timekeeping for a multi-location swim school (~23 staff). ShiftWave replaces When I Work / Teams Shifts for a proof-of-concept demo: employees view schedules, clock in/out with geofencing, and submit time-off and swap requests; managers build schedules, approve requests, review flagged punches, auto-generate schedules with AI, monitor a live dashboard, and export payroll to Gusto.

**Live demo:** deploy to [Vercel](https://vercel.com) (see [Deploy](#deploy-to-vercel) below).

---

## Table of contents

- [About](#about)
- [Features](#features)
- [Tech stack](#tech-stack)
- [Architecture](#architecture)
- [Navigation guide](#navigation-guide)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Firebase setup](#firebase-setup)
- [Scripts](#scripts)
- [Testing](#testing)
- [Security model](#security-model)
- [Assumptions & limitations](#assumptions--limitations)
- [Project structure](#project-structure)
- [Deploy to Vercel](#deploy-to-vercel)
- [Out of scope](#out-of-scope)

---

## About

ShiftWave is a full-stack web app built as a portfolio / POC project. It models real-world scheduling constraints for three pool locations (Arlington, Grand Prairie, Mansfield), remote admin work, and community events. The seeded demo week is **Mon 2026-06-22** — all schedule and clock-in screens default to that week so the demo looks populated regardless of the real calendar date.

Two access roles drive the UI:

| Role | Who | Home route |
|------|-----|------------|
| **Employee** | Instructors, Ambassadors | `/schedule` |
| **Manager** | Schedule admins | `/dashboard` |

Only **two Firebase Auth accounts** exist in the demo (one manager, one instructor). The other ~21 employees are roster records in Firestore — schedulable entities, not logins.

---

## Features

### Employee (any signed-in user)

| Page | Route | What it does |
|------|-------|--------------|
| **My Schedule** | `/schedule` | Real-time list of your shifts for the selected week, grouped by day |
| **Clock In/Out** | `/clock` | Pick a demo-week shift, clock in with geolocation, clock out when done. Geofence + timing status computed client-side; all new punches land as `Needs Review` until a manager approves |
| **Requests** | `/requests` | Submit time-off or shift-swap requests; view history and status |

Managers also use employee pages — they work pool shifts and must be able to clock in.

### Manager only

| Page | Route | What it does |
|------|-------|--------------|
| **Dashboard** | `/dashboard` | KPI cards, coverage and punch-review gauges, hours-per-employee chart, overtime risk, labor-cost estimate, coverage gaps |
| **Schedule Editor** | `/schedule-editor` | Week grid (locations × days), add/edit/delete shifts, live conflict & coverage warnings, AI auto-scheduler |
| **Review Queue** | `/review-queue` | Real-time inbox of flagged punches; one-tap Approve / Reject |
| **Approvals** | `/approvals` | Approve or deny pending time-off and swap requests |
| **Payroll** | `/payroll` | Export Gusto-compatible CSV for approved punches only |

### Flagship differentiators

1. **AI Auto-Scheduler** — Gemini drafts a one-week schedule; deterministic validators repair ineligible/double-booked assignments; manager reviews and accepts.
2. **Punch Review Queue** — Auto-flagged punches (outside geofence or outside on-time window) with distance readout and one-tap resolution.
3. **Conflict & Coverage Detection** — Live warnings in the editor: double-booking, ineligible location, over-hours, understaffed pool shifts (red cells).
4. **Manager Dashboard** — Hours, overtime risk, labor-cost estimate, coverage gaps from the same validator logic as the editor.

### App polish

- **Dark / light mode** — Toggle in the top nav (persisted in `localStorage`, respects system preference on first visit).
- **PWA** — Installable via web manifest + network-first no-op service worker (no offline caching).
- **Responsive** — Schedule editor grid scrolls horizontally on mobile; dashboard gauges stack vertically.

---

## Tech stack

| Layer | Choice | Notes |
|-------|--------|-------|
| Framework | **Next.js 16** (App Router) + **TypeScript** | Server Route Handlers keep secrets server-side |
| Styling | **Tailwind CSS v4** | `@import "tailwindcss"` — no `tailwind.config.js` |
| Auth & DB | **Firebase Auth** + **Cloud Firestore** | Spark (free) tier |
| Server SDK | **Firebase Admin SDK** | Token verification + AI route reads |
| AI | **Google Gemini** (`gemini-2.5-flash`) via `@google/genai` | Server-only; JSON structured output |
| Charts | **recharts** | Dashboard bar chart and gauges |
| Data import | **xlsx** (SheetJS) | One-off seed script |
| Hosting | **Vercel Hobby** | Auto-deploy from GitHub |

**Cost target:** ~$0 — Firebase Spark + Vercel Hobby + Gemini free tier. No Cloud Functions, no Firebase App Hosting (both require Blaze billing).

**Gemini model note:** `gemini-2.5-flash` is current as of deploy. Google has announced earliest shutdown **2026-10-16**; the model ID is isolated in `src/app/api/generate-schedule/route.ts` as `GEMINI_MODEL` — a future swap (e.g. to `gemini-3.5-flash`) is a one-line change.

---

## Architecture

### High-level system diagram

```mermaid
flowchart TB
  subgraph client [Browser - Client]
    UI[Next.js App Router pages]
    WebSDK[Firebase Web SDK]
    UI --> WebSDK
  end

  subgraph vercel [Vercel]
    API["/api/generate-schedule Route Handler"]
    AdminSDK[Firebase Admin SDK]
    Gemini[Google Gemini API]
    API --> AdminSDK
    API --> Gemini
  end

  subgraph firebase [Firebase Spark]
    Auth[Firebase Auth]
    Firestore[(Cloud Firestore)]
    Rules[Security Rules]
    Firestore --> Rules
  end

  WebSDK --> Auth
  WebSDK --> Firestore
  AdminSDK --> Firestore
  AdminSDK --> Auth
```

### Identity model

Login identity and employee roster are **separate collections**:

```mermaid
flowchart LR
  AuthUID[Firebase Auth UID] --> UsersDoc["users/{authUid}"]
  UsersDoc -->|"employeeId, appRole, email"| EmpDoc["employees/{employeeId}"]
  EmpDoc --> Shifts[shifts.employeeId]
  EmpDoc --> Punches[punches.employeeId]
```

- `users/{authUid}` — written by `scripts/link-users.mjs`; `appRole` is **not** a token claim — server routes and security rules read it from Firestore.
- `employees/{I001}` — roster from the Excel import; referenced by shifts and punches.

### Request flow — AI scheduler

```mermaid
sequenceDiagram
  participant M as Manager browser
  participant API as /api/generate-schedule
  participant Admin as Firebase Admin
  participant Gemini as Gemini API
  participant Val as validators.ts

  M->>API: POST + Bearer ID token + weekDates
  API->>Admin: verifyIdToken
  API->>Admin: read users/{uid} → appRole
  alt not manager
    API-->>M: 401
  end
  API->>Admin: load locations, employees, time-off
  API->>Gemini: generateContent (JSON schema)
  Gemini-->>API: draft shift array
  API->>Val: validateSchedule + auto-repair
  API-->>M: { draftShifts, issues }
  Note over M: Manager reviews modal, Accept writes to Firestore
```

### Access control layers

```mermaid
flowchart TD
  Req[Incoming request] --> RouteGuard[Route-group layout.tsx guards]
  RouteGuard --> UI[Page renders or redirects]
  UI --> FirestoreRead[Firestore read/write]
  FirestoreRead --> Rules[firestore.rules]
  Rules --> Allow[Allow or PERMISSION_DENIED]
```

1. **UI guards** — `(manager)/layout.tsx` requires `appRole === 'manager'`; `(employee)/layout.tsx` requires any signed-in user.
2. **Firestore rules** — Real backstop; identity resolved via `users/{request.auth.uid}` and `isManager()` helper.
3. **API route** — AI endpoint verifies ID token + reads `users/{uid}` for manager role.

### Shared validator module

Conflict and coverage logic lives once in `src/lib/validators.ts` as pure functions (no Firebase imports). Reused by:

- Schedule editor (live warnings)
- AI scheduler (post-generation repair)
- Dashboard (coverage gaps, overtime)

---

## Navigation guide

After sign-in, you land on your role home:

| Role | Default redirect |
|------|------------------|
| Manager | `/dashboard` |
| Employee | `/schedule` |

**Top navigation** (always visible when signed in):

```
[ShiftWave]  Schedule | Clock In/Out | Requests | Dashboard | Editor | Review Queue | Approvals | Payroll     [theme toggle] [name] [Sign out]
             └──────── employee links ────────┘  └──────────────── manager-only ────────────────┘
```

- **Review Queue** shows a red badge with the count of punches needing review (managers only).
- **Theme toggle** — sun/moon pill switch on the right, before your name.
- **Demo week** — Schedule, Clock, Dashboard, Editor, and Payroll pages include a "Demo week" button that jumps to the week of 2026-06-22.

**Typical manager workflow:**

1. Open **Dashboard** → scan coverage gaps and punches needing review.
2. **Schedule Editor** → fix understaffed cells or run **Generate week with AI**.
3. **Review Queue** → approve/reject flagged punches.
4. **Approvals** → resolve time-off and swap requests.
5. **Payroll** → export approved hours as Gusto CSV.

**Typical employee workflow:**

1. **Schedule** → confirm upcoming shifts.
2. **Clock In/Out** → select a shift, allow location, clock in/out.
3. **Requests** → submit time-off or propose a swap.

---

## Getting started

### Prerequisites

- **Node.js 20.6+** (for `--env-file` in seed scripts)
- A **Firebase project** on the Spark (free) plan
- A **Gemini API key** ([Google AI Studio](https://aistudio.google.com))

### Local development

```bash
git clone https://github.com/Avirup26/ShiftWave.git
cd ShiftWave
npm install
cp .env.example .env.local
# Fill in .env.local (see Environment variables)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Seed Firestore (first time)

```bash
# Import locations, employees, roles, shifts, punches from the demo workbook
node --env-file=.env.local scripts/import-sample-data.mjs

# After creating the 2 Auth accounts in Firebase Console:
node --env-file=.env.local scripts/link-users.mjs
```

### Build

```bash
npm run build   # must pass before every commit
npm start       # production server locally
npm test        # Gusto overtime split unit test
```

---

## Environment variables

Copy `.env.example` to `.env.local` (gitignored). Set the same values in Vercel before deploy.

| Variable | Scope | Description |
|----------|-------|-------------|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Public (client) | Firebase web config |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Public | |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Public | |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | Public | |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Public | |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Public | |
| `FIREBASE_ADMIN_SERVICE_ACCOUNT` | **Server only** | Full service-account JSON as one line; `\n` in `private_key` stays escaped |
| `GEMINI_API_KEY` | **Server only** | Google AI Studio key |
| `TEST_MANAGER_EMAIL` | Scripts | Email for manager test account |
| `TEST_INSTRUCTOR_EMAIL` | Scripts | Email for instructor test account |

Never prefix secrets with `NEXT_PUBLIC_`. Never commit `.env.local`.

---

## Firebase setup

1. Create a Firebase project (Spark plan, no billing card required).
2. Enable **Email/Password** authentication.
3. Create **Firestore** database.
4. Create two Auth users (manager + instructor) matching `TEST_MANAGER_EMAIL` / `TEST_INSTRUCTOR_EMAIL`.
5. Generate a **service account key** (Project settings → Service accounts → Generate new private key). Paste the JSON as a single-line string into `FIREBASE_ADMIN_SERVICE_ACCOUNT`.
6. Run seed scripts (see [Getting started](#getting-started)).
7. Deploy security rules:

```bash
firebase deploy --only firestore:rules
```

Verify rules in Firebase Console → Firestore → Rules → Rules Playground.

---

## Scripts

| Script | Command | Purpose |
|--------|---------|---------|
| Dev server | `npm run dev` | Hot reload at localhost:3000 |
| Build | `npm run build` | Production build + typecheck |
| Lint | `npm run lint` | ESLint |
| Test | `npm test` | Gusto CSV overtime split |
| Import data | `node --env-file=.env.local scripts/import-sample-data.mjs` | xlsx → Firestore |
| Link users | `node --env-file=.env.local scripts/link-users.mjs` | Auth UID → `users/{uid}` docs |

---

## Testing

```bash
npm test
```

Runs `src/lib/gusto.test.ts` — verifies the 40h/week regular/overtime split on unrounded minutes (synthetic >40h case). Seed punches are all under 40h; overtime is 0 in the demo export.

Manual smoke tests before demo:

- [ ] Instructor login → `/schedule`, `/clock`, `/requests` work; `/dashboard` redirects to `/schedule`
- [ ] Manager login → all pages accessible; review queue badge updates live
- [ ] Clock-in outside geofence → punch appears in review queue
- [ ] AI scheduler → non-manager gets 401; manager gets draft + issues modal
- [ ] Payroll export → only `Approved` punches; excluded list links to review queue
- [ ] Theme toggle persists across refresh

---

## Security model

Firestore rules (`firestore.rules`) enforce:

| Collection | Read | Write |
|------------|------|-------|
| `users/{uid}` | Own doc or manager | Admin SDK only |
| `employees`, `locations`, `roles`, `shifts` | Any signed-in user | Manager only |
| `punches` | Own punches or manager (all) | Create own (no `Approved` on create); update own except `managerReviewStatus`; manager updates all |
| `timeOffRequests` | Own or manager | Create own; manager updates status |
| `swapRequests` | From/to employee or manager | Create as requester; manager updates status |

Employee-facing queries are scoped to `where('employeeId', '==', ownId)` so list reads match per-doc rules.

---

## Assumptions & limitations

- **Two app roles:** `manager` and `employee` (Ambassadors + Instructors are employees).
- **Weekly pay period:** Mon–Sun; overtime = hours over 40/week (FLSA/TX assumption).
- **Geofence:** 200 ft pools, 300 ft events, none for remote; on-time window = 5 min (reverse-engineered from seed data).
- **Client-side geofencing:** POC only — production would validate server-side + App Check.
- **Hourly pay rates:** Assumed in `constants.ts`; used only for dashboard labor-cost **estimate**, not payroll export.
- **Demo week:** Fixed to week of 2026-06-22; clock page shows demo-week shifts, not filtered to real "today".
- **Events (EVT):** No per-event coordinates in POC — event clock-ins treated as `No Geofence`.
- **PTO:** Approved time off tracked in Approvals; not included in the Gusto worked-hours CSV (separate PTO import out of scope).
- **Only manager-approved punches** count toward payroll export.
- **New punch create:** Always `Needs Review`; manager must approve (integrity gate). Seeded punches retain their original statuses.
- **Gemini model:** `gemini-2.5-flash` — earliest announced shutdown 2026-10-16.

---

## Project structure

```
/
├── PLAN.md                 # Build spec (source of truth for phases)
├── firestore.rules         # Firestore security rules
├── data/
│   └── scheduling_timekeeping_demo_sample_data.xlsx
├── scripts/
│   ├── import-sample-data.mjs
│   └── link-users.mjs
├── public/
│   └── sw.js               # PWA service worker (network-only, no cache)
└── src/
    ├── app/
    │   ├── (employee)/     # /schedule, /clock, /requests
    │   ├── (manager)/      # /dashboard, /schedule-editor, /review-queue, /approvals, /payroll
    │   ├── api/generate-schedule/
    │   ├── login/
    │   ├── layout.tsx
    │   ├── manifest.ts     # PWA manifest
    │   └── icon.tsx        # App icon (ImageResponse)
    ├── components/         # TopNav, ThemeToggle, charts, modals, …
    └── lib/
        ├── auth.tsx        # Auth context + role resolution
        ├── theme.tsx       # Dark/light mode context
        ├── constants.ts    # Coverage rules, geofence, pay rates
        ├── types.ts        # Data model types
        ├── validators.ts   # Conflict & coverage (pure functions)
        ├── geofence.ts     # Haversine + timing
        ├── gusto.ts        # CSV builder
        ├── firebase.client.ts
        └── firebase.admin.ts
```

---

## Deploy to Vercel

1. Push to GitHub (Vercel auto-deploys on push to `main`).
2. In Vercel project settings → **Environment Variables**, set all vars from [Environment variables](#environment-variables).
3. Confirm Firebase Auth accounts exist and `users/{uid}` docs are linked.
4. Deploy Firestore rules: `firebase deploy --only firestore:rules`.
5. Open the live URL in incognito; sign in with both test accounts.

**Vercel Hobby limits (relevant):** 100 GB bandwidth/month, 100 build minutes/month — sufficient for this POC.

**Firebase Spark limits (relevant):** 1 GB storage, 50K reads/day, 20K writes/day — sufficient for demo traffic.

---

## Out of scope

What would come next in a production version:

- Server-side geofence validation + App Check (anti-spoofing)
- Push / email notifications
- Google SSO
- Google Sheets / Calendar sync
- Recurring shift templates
- Audit log + payroll-period locking
- Direct Gusto API integration
- Native mobile wrapper for background geofencing

---

## License

Private / portfolio project. Demo data in `data/` is synthetic sample data, safe to commit.
