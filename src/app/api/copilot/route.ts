import { Type } from '@google/genai';
import { NextResponse } from 'next/server';

import { adminDb } from '@/lib/firebase.admin';
import { requireManager } from '@/lib/apiAuth';
import { getGeminiClient, GEMINI_MODEL } from '@/lib/gemini';
import { COVERAGE_RULES, SHIFT_WINDOWS } from '@/lib/constants';
import { validateSchedule } from '@/lib/validators';
import { resolveCopilotOperations, type RawFunctionCall } from '@/lib/copilot';
import type { Employee, Location, Shift, TimeOffRequest } from '@/lib/types';

// firebase-admin does not run on the Edge runtime (§0.5).
export const runtime = 'nodejs';

const SYSTEM_INSTRUCTION = `You are a scheduling copilot for a multi-location swim school. The manager will give you a plain-English instruction about THIS week's schedule. Translate it into concrete edits by calling the provided tools. Call one tool per discrete change; you may call several.

You are given the current week's shifts (each with its shiftId), the employees (id, name, role, eligibleLocations, avgWeeklyHours), the locations, the standard shiftWindows, the coverage rules, and approved time-off. Rules:
- Only reference shiftIds, employeeIds and locationIds that appear in the provided data. Never invent ids.
- Respect eligibility (assign an employee only to a location in their eligibleLocations), avoid double-booking and exceeding 40h/week where you can, and never schedule someone on approved time-off.
- Use the provided shiftWindows for start/end times when adding shifts unless the manager specifies otherwise. Pools are closed Sunday.
- If the instruction is ambiguous or cannot be satisfied, make the closest reasonable set of tool calls; do not output prose.`;

const ADD_SHIFT = {
  name: 'add_shift',
  description: "Create a new Pool Shift assignment for an employee on a date at a location.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      date: { type: Type.STRING, description: "ISO 'YYYY-MM-DD' within the target week" },
      locationId: { type: Type.STRING },
      role: {
        type: Type.STRING,
        enum: ['Manager', 'Ambassador', 'Instructor', 'Remote Admin', 'Event Lead'],
      },
      employeeId: { type: Type.STRING },
      startTime: { type: Type.STRING, description: "24h 'HH:MM'" },
      endTime: { type: Type.STRING, description: "24h 'HH:MM'" },
    },
    required: ['date', 'locationId', 'role', 'employeeId', 'startTime', 'endTime'],
  },
};

const REMOVE_SHIFT = {
  name: 'remove_shift',
  description: 'Delete an existing shift by its shiftId.',
  parameters: {
    type: Type.OBJECT,
    properties: { shiftId: { type: Type.STRING } },
    required: ['shiftId'],
  },
};

const REASSIGN_SHIFT = {
  name: 'reassign_shift',
  description: 'Assign an existing shift to a different employee.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      shiftId: { type: Type.STRING },
      newEmployeeId: { type: Type.STRING },
    },
    required: ['shiftId', 'newEmployeeId'],
  },
};

const MOVE_SHIFT = {
  name: 'move_shift',
  description: 'Change the date and/or time window of an existing shift.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      shiftId: { type: Type.STRING },
      newDate: { type: Type.STRING, description: "ISO 'YYYY-MM-DD' (optional)" },
      newStartTime: { type: Type.STRING, description: "24h 'HH:MM' (optional)" },
      newEndTime: { type: Type.STRING, description: "24h 'HH:MM' (optional)" },
    },
    required: ['shiftId'],
  },
};

export async function POST(req: Request) {
  const auth = await requireManager(req);
  if (auth instanceof NextResponse) return auth;

  // --- Parse + validate body ---
  let instruction: string;
  let weekDates: string[];
  try {
    const body = (await req.json()) as { instruction?: unknown; weekDates?: unknown };
    if (typeof body.instruction !== 'string' || !body.instruction.trim()) {
      return NextResponse.json({ error: 'instruction is required' }, { status: 400 });
    }
    if (
      !Array.isArray(body.weekDates) ||
      body.weekDates.length !== 7 ||
      !body.weekDates.every((d): d is string => typeof d === 'string')
    ) {
      return NextResponse.json(
        { error: 'weekDates must be an array of 7 ISO date strings' },
        { status: 400 },
      );
    }
    instruction = body.instruction.trim();
    weekDates = body.weekDates;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const weekStart = weekDates[0];
  const weekEnd = weekDates[6];

  // --- Gather inputs (Admin SDK reads) ---
  const [locSnap, empSnap, timeOffSnap, shiftSnap] = await Promise.all([
    adminDb.collection('locations').get(),
    adminDb.collection('employees').where('status', '==', 'Active').get(),
    adminDb.collection('timeOffRequests').where('status', '==', 'Approved').get(),
    adminDb.collection('shifts').where('date', '>=', weekStart).where('date', '<=', weekEnd).get(),
  ]);

  const locations = locSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Location);
  const employees = empSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Employee);
  const currentShifts = shiftSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Shift);
  const approvedTimeOff = timeOffSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as TimeOffRequest)
    .filter((r) => r.startDate <= weekEnd && r.endDate >= weekStart)
    .map(({ employeeId, startDate, endDate }) => ({ employeeId, startDate, endDate }));

  // Compact context for the model.
  const context = {
    weekDates,
    currentShifts: currentShifts.map((s) => ({
      shiftId: s.id,
      date: s.date,
      locationId: s.locationId,
      role: s.role,
      employeeId: s.employeeId,
      employeeName: s.employeeName,
      startTime: s.startTime,
      endTime: s.endTime,
    })),
    locations: locations.map(({ id, name }) => ({ id, name })),
    employees: employees.map((e) => ({
      id: e.id,
      name: `${e.firstName} ${e.lastName}`,
      primaryRole: e.primaryRole,
      eligibleLocations: e.eligibleLocations,
      avgWeeklyHours: e.avgWeeklyHours,
    })),
    approvedTimeOff,
    shiftWindows: SHIFT_WINDOWS,
    coverageRules: COVERAGE_RULES,
  };

  // --- Call Gemini with function-calling ---
  let calls: RawFunctionCall[];
  try {
    const ai = getGeminiClient();
    const res = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: `Instruction: ${instruction}\n\nCurrent schedule context (JSON):\n${JSON.stringify(context)}`,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.1,
        tools: [
          { functionDeclarations: [ADD_SHIFT, REMOVE_SHIFT, REASSIGN_SHIFT, MOVE_SHIFT] },
        ],
      },
    });
    calls = (res.functionCalls ?? []).map((c) => ({
      name: c.name ?? '',
      args: (c.args ?? {}) as Record<string, unknown>,
    }));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: `Copilot failed: ${message}` }, { status: 502 });
  }

  if (calls.length === 0) {
    return NextResponse.json({
      operations: [],
      issues: [],
      skipped: [],
      message: "I couldn't translate that into any concrete schedule changes. Try being more specific (employee, location, day).",
    });
  }

  // --- Resolve → validate (no Firestore writes) ---
  const { operations, resultingShifts, skipped } = resolveCopilotOperations(
    calls,
    currentShifts,
    employees,
    locations,
  );

  const report = validateSchedule(resultingShifts, employees, weekDates);

  return NextResponse.json({
    operations,
    issues: report.issues,
    skipped,
  });
}
