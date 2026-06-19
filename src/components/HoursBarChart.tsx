'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Employee, Issue, Punch, Shift } from '@/lib/types';

function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

interface HoursBarChartProps {
  shifts: Shift[];
  punches: Punch[];
  employees: Employee[];
  overtimeIssues: Issue[];
}

interface RowData {
  name: string;
  Scheduled: number;
  Actual: number;
  isOvertime: boolean;
}

export default function HoursBarChart({
  shifts,
  punches,
  employees,
  overtimeIssues,
}: HoursBarChartProps) {
  const overtimeEmpIds = new Set(overtimeIssues.map((i) => i.employeeId).filter(Boolean));

  // Build per-employee rows
  const empById = new Map(employees.map((e) => [e.id, e]));
  const shiftsById = new Map(shifts.map((s) => [s.id, s]));

  // All employee IDs that appear in active shifts this week
  const activeEmpIds = Array.from(
    new Set(shifts.filter((s) => s.status !== 'Cancelled').map((s) => s.employeeId)),
  );

  const rows: RowData[] = activeEmpIds
    .map((empId) => {
      const emp = empById.get(empId);
      const name = emp ? `${emp.firstName} ${emp.lastName}` : empId;

      const scheduled = shifts
        .filter((s) => s.employeeId === empId && s.status !== 'Cancelled')
        .reduce((sum, s) => sum + s.scheduledHours, 0);

      const actual = punches
        .filter(
          (p) =>
            p.employeeId === empId &&
            p.managerReviewStatus === 'Approved' &&
            p.clockIn !== null &&
            p.clockOut !== null,
        )
        .reduce((sum, p) => {
          const shift = shiftsById.get(p.shiftId);
          if (!shift) return sum;
          const hours = (toMinutes(p.clockOut!) - toMinutes(p.clockIn!)) / 60;
          return sum + hours;
        }, 0);

      return {
        name,
        Scheduled: Math.round(scheduled * 100) / 100,
        Actual: Math.round(actual * 100) / 100,
        isOvertime: overtimeEmpIds.has(empId),
      };
    })
    .sort((a, b) => b.Scheduled - a.Scheduled);

  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-zinc-400">No shifts scheduled this week.</p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={Math.max(300, rows.length * 28)}>
      <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" unit="h" tick={{ fontSize: 12 }} />
        <YAxis
          type="category"
          dataKey="name"
          width={140}
          tick={{ fontSize: 12 }}
          tickLine={false}
        />
        <Tooltip
          formatter={(value) => [`${value ?? 0}h`]}
          contentStyle={{ fontSize: 13 }}
        />
        <Legend wrapperStyle={{ fontSize: 13 }} />

        {/* Scheduled bar — red if overtime employee, sky-blue otherwise */}
        <Bar dataKey="Scheduled" name="Scheduled" radius={[0, 3, 3, 0]}>
          {rows.map((row, idx) => (
            <Cell
              key={idx}
              fill={row.isOvertime ? '#ef4444' : '#38bdf8'}
            />
          ))}
        </Bar>

        {/* Actual bar — always emerald */}
        <Bar dataKey="Actual" name="Actual (approved)" fill="#34d399" radius={[0, 3, 3, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
