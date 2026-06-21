import { Type } from '@google/genai';
import { NextResponse } from 'next/server';

import { adminDb } from '@/lib/firebase.admin';
import { requireUser } from '@/lib/apiAuth';
import { getGeminiClient, GEMINI_MODEL } from '@/lib/gemini';
import { getMondayOf, weekDatesFrom } from '@/lib/weekHelpers';
import { buildSwapCandidates } from '@/lib/swapMatch';
import type { Employee, Shift, TimeOffRequest } from '@/lib/types';

// firebase-admin does not run on the Edge runtime (§0.5).
export const runtime = 'nodejs';

const SYSTEM_INSTRUCTION = `You help a swim-school employee find the best colleague to cover a shift. You are given the shift and a list of pre-vetted candidates with factual signals (eligibility, current vs projected weekly hours, conflicts, time-off, warnings). Rank the best replacements (most suitable first), preferring people who are eligible, have no warnings, and have lower projected hours (to spread work fairly). Return JSON only. For each, give a concise one-line reason and surface any warnings. Return at most 5.`;

const RESPONSE_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      employeeId: { type: Type.STRING },
      name: { type: Type.STRING },
      rank: { type: Type.NUMBER },
      reason: { type: Type.STRING },
      hoursThisWeek: { type: Type.NUMBER, description: 'projected weekly hours if they take it' },
      warnings: { type: Type.ARRAY, items: { type: Type.STRING } },
    },
    required: ['employeeId', 'name', 'rank', 'reason', 'hoursThisWeek', 'warnings'],
    propertyOrdering: ['employeeId', 'name', 'rank', 'reason', 'hoursThisWeek', 'warnings'],
  },
};

export async function POST(req: Request) {
  const auth = await requireUser(req);
  if (auth instanceof NextResponse) return auth;

  // --- Parse body ---
  let shiftId: string;
  try {
    const body = (await req.json()) as { shiftId?: unknown };
    if (typeof body.shiftId !== 'string' || !body.shiftId) {
      return NextResponse.json({ error: 'shiftId is required' }, { status: 400 });
    }
    shiftId = body.shiftId;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // --- Load the shift ---
  const shiftDoc = await adminDb.collection('shifts').doc(shiftId).get();
  if (!shiftDoc.exists) {
    return NextResponse.json({ error: 'Shift not found' }, { status: 404 });
  }
  const shift = { id: shiftDoc.id, ...shiftDoc.data() } as Shift;

  // The week containing the shift (Mon–Sun) for hours + conflict context.
  const weekDates = weekDatesFrom(getMondayOf(shift.date));
  const weekStart = weekDates[0];
  const weekEnd = weekDates[6];

  const [empSnap, weekShiftSnap, timeOffSnap] = await Promise.all([
    adminDb.collection('employees').get(),
    adminDb.collection('shifts').where('date', '>=', weekStart).where('date', '<=', weekEnd).get(),
    adminDb.collection('timeOffRequests').where('status', '==', 'Approved').get(),
  ]);

  const employees = empSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Employee);
  const weekShifts = weekShiftSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Shift);
  const approvedTimeOff = timeOffSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as TimeOffRequest);

  const candidates = buildSwapCandidates(shift, employees, weekShifts, approvedTimeOff);
  const viable = candidates.filter((c) => c.viable);
  // Prefer viable; if none, send the least-bad few so the user still gets help.
  const shortlist = (viable.length > 0 ? viable : candidates).slice(0, 8);

  if (shortlist.length === 0) {
    return NextResponse.json({ suggestions: [] });
  }

  const payload = {
    shift: {
      date: shift.date,
      locationName: shift.locationName,
      role: shift.role,
      startTime: shift.startTime,
      endTime: shift.endTime,
      scheduledHours: shift.scheduledHours,
    },
    candidates: shortlist,
  };

  try {
    const ai = getGeminiClient();
    const res = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: JSON.stringify(payload),
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0.2,
      },
    });
    const text = res.text;
    if (!text) throw new Error('Empty response from model');
    const suggestions = JSON.parse(text);
    if (!Array.isArray(suggestions)) throw new Error('Model did not return an array');
    return NextResponse.json({ suggestions });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: `Swap suggestions failed: ${message}` }, { status: 502 });
  }
}
