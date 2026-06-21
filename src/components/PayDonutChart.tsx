'use client';

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { PayBreakdown } from '@/lib/pay';

const COLORS = {
  netPay: '#34d399',
  federalTax: '#f87171',
  socialSecurityTax: '#fb923c',
  medicareTax: '#fbbf24',
};

export default function PayDonutChart({ breakdown }: { breakdown: PayBreakdown }) {
  const { netPay, federalTax, socialSecurityTax, medicareTax, grossPay } = breakdown;

  if (grossPay <= 0) {
    return (
      <div className="flex h-[220px] items-center justify-center">
        <span className="h-32 w-32 rounded-full border-[16px] border-zinc-100 dark:border-zinc-800" />
      </div>
    );
  }

  const data = [
    { name: 'Take Home', value: netPay, color: COLORS.netPay },
    { name: 'Federal Tax', value: federalTax, color: COLORS.federalTax },
    { name: 'Social Security', value: socialSecurityTax, color: COLORS.socialSecurityTax },
    { name: 'Medicare', value: medicareTax, color: COLORS.medicareTax },
  ].filter((d) => d.value > 0);

  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius={64}
          outerRadius={96}
          paddingAngle={2}
        >
          {data.map((d) => (
            <Cell key={d.name} fill={d.color} />
          ))}
        </Pie>
        <Tooltip formatter={(value) => `$${Number(value).toFixed(2)}`} />
      </PieChart>
    </ResponsiveContainer>
  );
}
