import { Type } from '@google/genai';
import { NextResponse } from 'next/server';

import { adminDb } from '@/lib/firebase.admin';
import { requireManager } from '@/lib/apiAuth';
import { getGeminiClient, GEMINI_MODEL } from '@/lib/gemini';
import { computeAnomalySignals } from '@/lib/anomalies';
import type { Employee, Location, Punch } from '@/lib/types';

// firebase-admin does not run on the Edge runtime (§0.5).
export const runtime = 'nodejs';

const SYSTEM_INSTRUCTION = `You are a timekeeping-fraud analyst for a swim school. You are given pre-computed, factual signals about each employee's clock-in punches and any "buddy-punch" clusters (multiple staff clocking in within minutes of each other at the same site while OUTSIDE the geofence — a classic sign one person is punching for others).

Identify the genuinely suspicious patterns and return them as a ranked JSON array (most concerning first). Ground every claim in the numbers provided — do NOT invent figures. Only flag employees whose signals actually warrant attention; if nobody is suspicious, return an empty array. Severity: 'high' for strong fraud signals (repeated geofence violations, buddy clusters, consistent early clock-ins padding hours), 'medium' for notable patterns, 'low' for minor. Confidence is 0-1. Keep explanations concise and specific.`;

const RESPONSE_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      employeeId: { type: Type.STRING },
      employeeName: { type: Type.STRING },
      severity: { type: Type.STRING, enum: ['low', 'medium', 'high'] },
      confidence: { type: Type.NUMBER, description: '0 to 1' },
      title: { type: Type.STRING, description: 'Short headline for the anomaly' },
      explanation: { type: Type.STRING },
      evidence: { type: Type.ARRAY, items: { type: Type.STRING } },
      recommendedAction: { type: Type.STRING },
    },
    required: [
      'employeeId',
      'employeeName',
      'severity',
      'confidence',
      'title',
      'explanation',
      'evidence',
      'recommendedAction',
    ],
    propertyOrdering: [
      'employeeId',
      'employeeName',
      'severity',
      'confidence',
      'title',
      'explanation',
      'evidence',
      'recommendedAction',
    ],
  },
};

export async function POST(req: Request) {
  const auth = await requireManager(req);
  if (auth instanceof NextResponse) return auth;

  // --- Gather inputs (Admin SDK reads) ---
  const [punchSnap, empSnap, locSnap] = await Promise.all([
    adminDb.collection('punches').get(),
    adminDb.collection('employees').get(),
    adminDb.collection('locations').get(),
  ]);

  const punches = punchSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Punch);
  const employees = empSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Employee);
  const locations = locSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Location);

  const signals = computeAnomalySignals(punches, employees, locations);

  // Nothing to analyze → skip the model call entirely.
  const hasSignal =
    signals.buddyClusters.length > 0 ||
    signals.perEmployee.some(
      (s) => s.geofenceViolations > 0 || s.outsideWindowCount > 0 || s.earlyClockInCount > 0,
    );
  if (!hasSignal) {
    return NextResponse.json({ anomalies: [] });
  }

  // --- Ask Gemini to rank + explain ---
  try {
    const ai = getGeminiClient();
    const res = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: JSON.stringify(signals),
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0.2,
      },
    });
    const text = res.text;
    if (!text) throw new Error('Empty response from model');
    const anomalies = JSON.parse(text);
    if (!Array.isArray(anomalies)) throw new Error('Model did not return an array');
    return NextResponse.json({ anomalies });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: `Anomaly scan failed: ${message}` }, { status: 502 });
  }
}
