// Simplified, clearly-labeled pay estimate. NOT real payroll tax math — a
// flat-percentage simulation for the demo /pay page. No Firebase imports.

import { DEFAULT_HOURLY_RATE } from './constants';
import { round2 } from './payHours';
import type { RoleName } from './types';

export const TAX_RATES = {
  federal: 0.12,
  socialSecurity: 0.062,
  medicare: 0.0145,
} as const;

export interface PayBreakdown {
  rate: number;
  grossPay: number;
  federalTax: number;
  socialSecurityTax: number;
  medicareTax: number;
  totalTax: number;
  netPay: number;
}

export function hourlyRateForRole(role: RoleName): number {
  return DEFAULT_HOURLY_RATE[role] ?? 0;
}

/**
 * totalHours = regular + overtime hours already summed. No OT premium is
 * applied — the codebase has no 1.5x multiplier anywhere (DEFAULT_HOURLY_RATE
 * is a flat role rate), so this stays consistent rather than inventing one.
 */
export function computePayBreakdown(totalHours: number, role: RoleName): PayBreakdown {
  const rate = hourlyRateForRole(role);
  const grossPay = round2(totalHours * rate);
  const federalTax = round2(grossPay * TAX_RATES.federal);
  const socialSecurityTax = round2(grossPay * TAX_RATES.socialSecurity);
  const medicareTax = round2(grossPay * TAX_RATES.medicare);
  const totalTax = round2(federalTax + socialSecurityTax + medicareTax);
  const netPay = round2(grossPay - totalTax);
  return { rate, grossPay, federalTax, socialSecurityTax, medicareTax, totalTax, netPay };
}
