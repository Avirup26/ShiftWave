# ShiftWave — agent guide

Scheduling & timekeeping app for a multi-location swim school (~23 staff): employees view schedules, clock in/out (geofenced), request time off and swaps; managers schedule, approve, review flagged punches, auto-generate schedules with AI, and export payroll to Gusto.

**Prime directive:** `PLAN.md` is the single source of truth. Read it before writing code, re-read the active phase before starting it, and read `PLAN.md §0.5` before Phase 1 — it contains the setup gotchas that otherwise break the build.

---

## Source of truth & flow
- Build the phases in `PLAN.md` **in order (1 → 9)**. Phases 1–3 are the required floor, 4–7 the differentiators, 8–9 ship.
- A phase is **done only when every Acceptance criterion passes.** Don't start the next phase before then.
- One commit per phase, using the commit message given in that phase.

## Stack (decided — do not substitute)
- **Next.js** (App Router) + **TypeScript**; **Tailwind v4** (no `tailwind.config.js`; `@import "tailwindcss"` + `@tailwindcss/postcss`). Skip shadcn/ui for the deadline.
- **Firebase**: Authentication (email/password) + Cloud Firestore. **Firebase Admin SDK** in server Route Handlers.
- **Google Gemini** via `@google/genai` (not the deprecated `@google/generative-ai`) for the AI scheduler — **server-side only**.
- **recharts** (dashboard charts) · **xlsx**/SheetJS (one-off import script).
- Deploy to **Vercel** (free Hobby tier), auto-deploy from GitHub.

## Hard rules (never break)
- **Cost ~$0:** Firebase Spark + Vercel Hobby + Gemini free tier. **No Cloud Functions, no Firebase App Hosting** (those require billing).
- **Secrets are server-only:** `GEMINI_API_KEY` and the Admin service account never appear in client code or behind a `NEXT_PUBLIC_` prefix. The Firebase **web** config is public and fine in the client.
- **Enforce permissions in Firestore Security Rules**, not just the UI.
- Never commit secrets. **Do** commit the demo workbook at `data/scheduling_timekeeping_demo_sample_data.xlsx` (it's demo data, not secret).

## Gotchas that bite every session (condensed from PLAN §0.5)
- **Identity = two collections.** `employees/{I001}` is the roster (the import writes here, referenced by `shifts`/`punches`). `users/{authUid}` is the login identity `{ employeeId, appRole, email }` and exists only for the 2 test accounts. Resolve role/identity by reading `users/{auth.uid}`.
- **Access model.** Employee pages (`/schedule`, `/clock`, `/requests`) are for **any** signed-in user — managers work pool shifts and must be able to clock in. Manager pages (`/dashboard`, `/schedule-editor`, `/review-queue`, `/approvals`, `/payroll`) require `appRole==='manager'`. Enforce with route-group `layout.tsx` guards + redirects, not hidden nav links.
- **AI route role check:** `appRole` is **not** on the Firebase ID token. After verifying the token, read `users/{uid}` via the Admin SDK to confirm `manager`; 401 otherwise. Add `export const runtime = 'nodejs'` to every `/api` route (firebase-admin breaks on Edge).
- **Admin SDK init:** un-escape the private key (`private_key.replace(/\\n/g, '\n')`) or token verification throws "invalid PEM"; guard with `if (!getApps().length)`. Put `import 'server-only';` at the top of `firebase.admin.ts`.
- **IDs for new records:** new shifts (editor + AI) and new punches (clock-in) use Firestore **auto-IDs** via `addDoc`; mirror the doc ID into the `id` field. Never hand-mint `S####`/`P####`.
- **Time:** all locations are US Central; times are local wall-clock strings. Compute hours as minutes-since-midnight on the same local day. The seeded week is **2026-06-22**, so let users pick any upcoming shift to clock into (don't hard-filter to the real "today") or the demo looks empty.
- **Events have no coordinates** → treat event clock-ins as `No Geofence`.
- **Seed scripts** are standalone Node ESM (init Admin directly, don't import the Next lib): `node --env-file=.env.local scripts/import-sample-data.mjs`.

## Definition of done / conventions
- Use the types in `src/lib/types.ts` and constants in `src/lib/constants.ts` as ground truth — don't invent data shapes, coverage rules, or geofence values.
- Conflict/coverage logic lives once in `src/lib/validators.ts` as pure functions (no Firebase imports), reused by the schedule editor and the AI scheduler.
- Keep components small (one per file); UI in client components, secret logic in Route Handlers.
- Real-time views (review queue, schedule) use `onSnapshot`; everything else `getDocs`/`getDoc`.
- `npm run build` must pass before **every** commit; fix all type errors; no `any` where a real type exists. Conventional commits (`feat:`/`fix:`/`chore:`).
- When unsure about a current product/version detail (Gemini model name, a Vercel setting), check official docs — don't guess.

## Done by a human, not the agent
Two console steps the agent can't perform: (1) create the Firebase project + the 2 Auth accounts, (2) set the env vars in Vercel. Everything else is buildable from `PLAN.md`.
