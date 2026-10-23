import { describe, expect, it } from 'vitest';
import type { DailyFactor, PayFrequency, PayType } from '../../schemas/common';
import { toMoney } from '../../money';
import { RATES_V1 } from '../../seed/ratesV1';
import { rateBasis } from '../dailyRate';
import { computeBasicPay, EMPTY_ATTENDANCE, type AttendanceSummary } from '../earnings';

function basic(
  payType: PayType,
  baseRate: string,
  factor: DailyFactor,
  frequency: PayFrequency,
  attendance: Partial<AttendanceSummary>,
): { lines: [string, string, string | undefined][]; basicEarned: string } {
  const r = computeBasicPay({
    payType,
    basis: rateBasis(payType, baseRate, factor, RATES_V1),
    frequency,
    attendance: { ...EMPTY_ATTENDANCE, ...attendance },
    rates: RATES_V1,
  });
  return {
    lines: r.lines.map((l) => [l.code, l.amount, l.quantity]),
    basicEarned: toMoney(r.basicEarned),
  };
}

describe('computeBasicPay', () => {
  it('monthly 30,000 paid semi-monthly: 30,000 × 12 ÷ 24 = 15,000', () => {
    expect(basic('monthly', '30000', 261, 'semi_monthly', {})).toEqual({
      lines: [['basic', '15000.00', '1']],
      basicEarned: '15000.00',
    });
  });

  it('monthly 30,000 paid monthly: 30,000', () => {
    expect(basic('monthly', '30000', 313, 'monthly', {}).basicEarned).toBe('30000.00');
  });

  it('semi_monthly base 15,000 per cutoff → monthly 30,000 → 15,000 per semi-monthly period', () => {
    expect(basic('semi_monthly', '15000', 261, 'semi_monthly', {}).basicEarned).toBe('15000.00');
  });

  it('monthly f261 with 1 absence and 30 min tardy/undertime', () => {
    // daily = 30,000 × 12 ÷ 261 = 1,379.3103 → absence −1,379.31
    // hourly = 1,379.3103 ÷ 8 = 172.4138; 20 + 10 = 30 min = 0.5 h → −86.2069 → −86.21
    // basic earned = 15,000 − 1,379.31 − 86.21 = 13,534.48
    expect(
      basic('monthly', '30000', 261, 'semi_monthly', {
        absentDays: 1,
        tardyMinutes: 20,
        undertimeMinutes: 10,
      }),
    ).toEqual({
      lines: [
        ['basic', '15000.00', '1'],
        ['absences', '-1379.31', '1'],
        ['tardy_undertime', '-86.21', '30'],
      ],
      basicEarned: '13534.48',
    });
  });

  it('monthly staff: paid leave is already in the salary (no extra line)', () => {
    expect(basic('monthly', '30000', 261, 'semi_monthly', { paidLeaveDays: 2 }).lines).toEqual([
      ['basic', '15000.00', '1'],
    ]);
  });

  it('daily 600 f313: 11 days + 1 paid leave − 15 min tardy', () => {
    // 11 × 600 = 6,600; leave 1 × 600 = 600; tardy 0.25 h × 75 = 18.75; earned 7,181.25
    expect(
      basic('daily', '600', 313, 'semi_monthly', {
        daysWorked: 11,
        paidLeaveDays: 1,
        tardyMinutes: 15,
      }),
    ).toEqual({
      lines: [
        ['basic', '6600.00', '11'],
        ['paid_leave', '600.00', '1'],
        ['tardy_undertime', '-18.75', '15'],
      ],
      basicEarned: '7181.25',
    });
  });

  it('hourly 100: 80 h + 1 paid leave day (8 h × 100); tardiness is not deducted (unpaid hours)', () => {
    expect(
      basic('hourly', '100', 313, 'semi_monthly', {
        regularHours: 80,
        paidLeaveDays: 1,
        tardyMinutes: 30,
      }),
    ).toEqual({
      lines: [
        ['basic', '8000.00', '80'],
        ['paid_leave', '800.00', '1'],
      ],
      basicEarned: '8800.00',
    });
  });

  it('daily staff paid weekly: 6 × 645 = 3,870', () => {
    expect(basic('daily', '645', 313, 'weekly', { daysWorked: 6 }).basicEarned).toBe('3870.00');
  });

  it('basic earned never goes negative: 20 absences on a 5,000 cutoff', () => {
    // daily = 10,000 × 12 ÷ 261 = 459.7701 → 20 × = 9,195.40 > 5,000 → earned 0
    const r = basic('monthly', '10000', 261, 'semi_monthly', { absentDays: 20 });
    expect(r.lines[1]).toEqual(['absences', '-9195.40', '20']);
    expect(r.basicEarned).toBe('0.00');
  });

  it('a daily employee with no attendance gets no lines', () => {
    expect(basic('daily', '600', 313, 'semi_monthly', {})).toEqual({
      lines: [],
      basicEarned: '0.00',
    });
  });
});
