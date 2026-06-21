import { NextResponse } from 'next/server';

import { adminDb } from '@/lib/firebase.admin';
import { requireUser } from '@/lib/apiAuth';
import { getGeminiClient, GEMINI_MODEL } from '@/lib/gemini';
import { DEMO_DATE } from '@/lib/constants';
import { getMondayOf, weekDatesFrom } from '@/lib/weekHelpers';
import { punchMinutes, round2 } from '@/lib/payHours';
import { hourlyRateForRole, TAX_RATES } from '@/lib/pay';
import type { Employee, Punch, Shift, SwapRequest, TimeOffRequest, UserIdentity } from '@/lib/types';

// firebase-admin does not run on the Edge runtime (§0.5).
export const runtime = 'nodejs';

const APP_KNOWLEDGE = `ShiftWave is a scheduling & timekeeping web app for a multi-location swim school (locations: Arlington/ARL, Grand Prairie/GP, Mansfield/MAN, plus community events). Roles: Manager, Ambassador, Instructor, Remote Admin, Event Lead.

PAGES & WHAT THEY DO:
- Schedule (/schedule): an employee views their own assigned shifts for the week.
- Clock In/Out (/clock): clock in/out of a shift; clock-in is geofenced (must be within ~200ft of the pool) and time-checked (within 5 min of the scheduled start is "On Time"). Punches outside the geofence or window are flagged for manager review.
- Timecard (/timecard): a pay-period (weekly, Mon–Sun) day-by-day breakdown of hours worked from punches, with Regular vs Overtime (over 40h/week).
- Pay (/pay): a simulated pay estimate — gross (approved hours × role rate) minus a flat-rate tax estimate = take-home. It's a demo estimate, not real payroll.
- Requests (/requests): submit Time Off (date range + reason) or a Shift Swap (pick your shift + a proposed replacement; there's an AI "Suggest best replacement" button).
- MANAGER-ONLY pages: Dashboard (/dashboard, KPIs/charts: hours, overtime, labor cost, coverage), Schedule Editor (/schedule-editor, build the week; "Generate week with AI" drafts it; the ✨ Copilot bar edits it with plain English), Review Queue (/review-queue, approve/reject flagged punches), Approvals (/approvals, approve/deny time-off & swaps), Payroll (/payroll, export approved hours as a Gusto CSV), Insights (/insights, AI scan for timekeeping anomalies).

RULES: Overtime threshold is 40h/week. Coverage minimums per Pool Shift: 1 Manager, 1 Ambassador, 4 Instructors. Only manager-approved punches count toward pay/payroll. Managers are paid staff too, so they also have Schedule/Clock/Timecard/Pay/Requests.`;

export async function POST(req: Request) {
  const auth = await requireUser(req);
  if (auth instanceof NextResponse) return auth;
  const { uid } = auth;

  // --- Parse conversation ---
  let messages: { role: 'user' | 'model'; text: string }[];
  try {
    const body = (await req.json()) as { messages?: unknown };
    if (
      !Array.isArray(body.messages) ||
      body.messages.length === 0 ||
      !body.messages.every(
        (m): m is { role: 'user' | 'model'; text: string } =>
          !!m &&
          typeof (m as { text?: unknown }).text === 'string' &&
          ((m as { role?: unknown }).role === 'user' || (m as { role?: unknown }).role === 'model'),
      )
    ) {
      return NextResponse.json({ error: 'messages must be a non-empty array' }, { status: 400 });
    }
    messages = body.messages.slice(-12); // cap history
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // --- Resolve the signed-in user ---
  const idSnap = await adminDb.collection('users').doc(uid).get();
  if (!idSnap.exists) {
    return NextResponse.json({ error: 'No identity for this user' }, { status: 403 });
  }
  const identity = idSnap.data() as UserIdentity;
  const isManager = identity.appRole === 'manager';

  const empSnap = await adminDb.collection('employees').doc(identity.employeeId).get();
  const employee = empSnap.exists
    ? ({ id: empSnap.id, ...empSnap.data() } as Employee)
    : null;

  const weekDates = weekDatesFrom(getMondayOf(DEMO_DATE));
  const weekStart = weekDates[0];
  const weekEnd = weekDates[6];

  // --- Gather the user's own scoped data ---
  const [myShiftsSnap, myPunchSnap, myTimeOffSnap, mySwapSnap] = await Promise.all([
    adminDb.collection('shifts').where('employeeId', '==', identity.employeeId)
      .where('date', '>=', weekStart).where('date', '<=', weekEnd).get(),
    adminDb.collection('punches').where('employeeId', '==', identity.employeeId)
      .where('date', '>=', weekStart).where('date', '<=', weekEnd).get(),
    adminDb.collection('timeOffRequests').where('employeeId', '==', identity.employeeId).get(),
    adminDb.collection('swapRequests').where('fromEmployeeId', '==', identity.employeeId).get(),
  ]);

  const myShifts = myShiftsSnap.docs.map((d) => d.data() as Shift).filter((s) => s.status !== 'Cancelled');
  const myPunches = myPunchSnap.docs.map((d) => d.data() as Punch);
  const myTimeOff = myTimeOffSnap.docs.map((d) => d.data() as TimeOffRequest);
  const mySwaps = mySwapSnap.docs.map((d) => d.data() as SwapRequest);

  const hoursThisWeek = round2(myPunches.reduce((sum, p) => sum + punchMinutes(p) / 60, 0));

  const userContext: Record<string, unknown> = {
    role: identity.appRole,
    name: employee ? `${employee.firstName} ${employee.lastName}` : identity.employeeId,
    primaryRole: employee?.primaryRole,
    eligibleLocations: employee?.eligibleLocations,
    avgWeeklyHours: employee?.avgWeeklyHours,
    weekRange: `${weekStart} to ${weekEnd}`,
    myShiftsThisWeek: myShifts.map((s) => ({
      date: s.date, location: s.locationName, role: s.role, start: s.startTime, end: s.endTime,
    })),
    myHoursThisWeek: hoursThisWeek,
    myPendingTimeOff: myTimeOff.filter((r) => r.status === 'Pending').map((r) => ({ start: r.startDate, end: r.endDate, reason: r.reason })),
    myPendingSwaps: mySwaps.filter((r) => r.status === 'Pending').length,
    // Simulated pay model (matches the /pay page exactly) so you can answer
    // "how much would I make for N hours" yourself.
    pay: {
      hourlyRate: employee ? hourlyRateForRole(employee.primaryRole) : null,
      taxRates: TAX_RATES, // { federal, socialSecurity, medicare } as fractions
      grossFormula: 'gross = hours * hourlyRate',
      takeHomeFormula: 'takeHome = gross - gross*(federal + socialSecurity + medicare)',
      note: 'Simulated estimate only — not real payroll. Only manager-approved hours count toward actual pay.',
    },
  };

  // --- Manager-only snapshot ---
  if (isManager) {
    const [needsReviewSnap, pendingTimeOffSnap, pendingSwapSnap] = await Promise.all([
      adminDb.collection('punches').where('managerReviewStatus', '==', 'Needs Review').get(),
      adminDb.collection('timeOffRequests').where('status', '==', 'Pending').get(),
      adminDb.collection('swapRequests').where('status', '==', 'Pending').get(),
    ]);
    userContext.managerSnapshot = {
      punchesNeedingReview: needsReviewSnap.size,
      pendingTimeOffRequests: pendingTimeOffSnap.size,
      pendingSwapRequests: pendingSwapSnap.size,
    };
  }

  const systemInstruction = `You are the ShiftWave AI assistant, a friendly in-app helper. Answer the user's questions about the app and their own schedule/hours/pay/requests.

${APP_KNOWLEDGE}

The signed-in user's role is "${identity.appRole}". ${isManager ? 'They are a MANAGER and can see manager pages and aggregate data.' : 'They are an EMPLOYEE — do NOT offer manager-only actions or other people\'s data; only their own.'}

Here is live context about this user (JSON):
${JSON.stringify(userContext)}

GUIDELINES:
- Be concise and conversational. Use the live context to answer data questions (e.g. "what are my hours this week", "when do I work next", "do I have pending requests").
- PAY MATH: You CAN compute simulated pay yourself using context.pay. For a given number of hours: gross = hours × hourlyRate; total tax = gross × (federal + socialSecurity + medicare); take-home = gross − total tax. Show the gross and take-home, round to 2 decimals, and note it's a simulated estimate. Example: 40h at $18/hr → gross $720.00, take-home ≈ $574.92. Never refuse a pay calculation when hourlyRate is present in context.
- For "how do I…" questions, explain the steps and name the page to use.
- Only discuss ShiftWave. If asked something unrelated, briefly say you can only help with ShiftWave.
- Never invent data not present in the context. If you don't have it, say so and point them to the right page.
- You cannot perform actions (you can't clock them in or submit requests); guide them to the page that does.`;

  // --- Call Gemini (multi-turn) ---
  try {
    const ai = getGeminiClient();
    const res = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: messages.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
      config: { systemInstruction, temperature: 0.4 },
    });
    const reply = res.text;
    if (!reply) throw new Error('Empty response from model');
    return NextResponse.json({ reply });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: `Assistant failed: ${message}` }, { status: 502 });
  }
}
