import { describe, expect, it } from 'vitest';
import type { DailyFactor, DayType, PayType } from '../../schemas/common';
import type { StatutoryRates } from '../../schemas/rates';
import { toMoney } from '../../money';
import { RATES_V1 } from '../../seed/ratesV1';
import {
  computePremiums,
  dayMultiplier,
  nightDiffHours,
  otMultiplier,
  salaryCoverage,
  unworkedHolidayPay,
  type DayHours,
} from '../premiums';
import { ratesWith } from './fixtures/rates';

// All premium cases use an hourly rate of 100 so the arithmetic is easy to follow.
const HOURLY = '100';

function linesFor(
  payType: PayType,
  factor: DailyFactor,
  day: Partial<DayHours> & { dayType: DayType },
  rates: StatutoryRates = RATES_V1,
): Record<string, string> {
  const full: DayHours = { hours: 0, otHours: 0, ndHours: 0, ndOtHours: 0, ...day };
  const out: Record<string, string> = {};
  for (const l of computePremiums({ payType, factor, hourly: HOURLY, days: [full], rates })) {
    out[l.code] = l.amount;
  }
  return out;
}

describe('dayMultiplier / otMultiplier', () => {
  // OT on an ordinary day is 1.25; on any other day it is the day rate × 1.30.
  it.each<[DayType, string, string]>([
    ['ordinary', '1.00', '1.25'],
    ['rest_day', '1.30', '1.69'], // 1.30 × 1.30
    ['special', '1.30', '1.69'], // 1.30 × 1.30
    ['special_rest_day', '1.50', '1.95'], // 1.50 × 1.30
    ['regular', '2.00', '2.60'], // 2.00 × 1.30
    ['regular_rest_day', '2.60', '3.38'], // 2.60 × 1.30
    ['double', '3.00', '3.90'], // 3.00 × 1.30
    ['double_rest_day', '3.90', '5.07'], // 3.90 × 1.30
  ])('%s: day %s, OT %s', (dayType, dayM, otM) => {
    expect(dayMultiplier(dayType, RATES_V1).toFixed(2)).toBe(dayM);
    expect(otMultiplier(dayType, RATES_V1).toFixed(2)).toBe(otM);
  });
});

describe('salaryCoverage', () => {
  it('ordinary days are always covered by basic pay', () => {
    for (const pt of ['monthly', 'semi_monthly', 'daily', 'hourly'] as const) {
      expect(salaryCoverage('ordinary', pt, 313)).toBe(1);
    }
  });
  it('daily/hourly: nothing but ordinary days is covered', () => {
    expect(salaryCoverage('regular', 'daily', 365)).toBe(0);
    expect(salaryCoverage('rest_day', 'hourly', 393)).toBe(0);
  });
  it('monthly: rest days covered only by 365/393', () => {
    expect(salaryCoverage('rest_day', 'monthly', 261)).toBe(0);
    expect(salaryCoverage('rest_day', 'monthly', 313)).toBe(0);
    expect(salaryCoverage('rest_day', 'semi_monthly', 365)).toBe(1);
    expect(salaryCoverage('rest_day', 'semi_monthly', 393)).toBe(1);
  });
  it('monthly: the regular-holiday 100% is always in the salary', () => {
    for (const f of [261, 313, 365, 393] as const) {
      expect(salaryCoverage('regular', 'monthly', f)).toBe(1);
      expect(salaryCoverage('double', 'semi_monthly', f)).toBe(1);
    }
  });
});

describe('computePremiums: work on premium days (8 regular hours at 100/h)', () => {
  // Daily/hourly staff: nothing but ordinary days is in basic pay, so the full multiplier applies.
  // 8 h × 100 × multiplier.
  const dailyExpected: [DayType, string][] = [
    ['rest_day', '1040.00'], // × 1.30
    ['special', '1040.00'], // × 1.30
    ['special_rest_day', '1200.00'], // × 1.50
    ['regular', '1600.00'], // × 2.00
    ['regular_rest_day', '2080.00'], // × 2.60
    ['double', '2400.00'], // × 3.00
    ['double_rest_day', '3120.00'], // × 3.90
  ];
  for (const payType of ['daily', 'hourly'] as const) {
    for (const factor of [313, 261, 365, 393] as const) {
      it.each(dailyExpected)(`${payType} f${factor}: %s → %s`, (dayType, expected) => {
        expect(linesFor(payType, factor, { dayType, hours: 8 })).toEqual({
          [`${dayType}_work`]: expected,
        });
      });
    }
  }

  // Monthly/semi-monthly with 261/313: regular-holiday 100% and special-day 100% are in the
  // salary; rest days are not. 8 h × 100 × (multiplier − coverage).
  const notCovered: [DayType, string][] = [
    ['rest_day', '1040.00'], // 1.30 − 0
    ['special', '240.00'], // 1.30 − 1
    ['special_rest_day', '1200.00'], // 1.50 − 0 (rest day not covered)
    ['regular', '800.00'], // 2.00 − 1: worked regular holiday adds 1.00 × hourly per hour
    ['regular_rest_day', '1280.00'], // 2.60 − 1
    ['double', '1600.00'], // 3.00 − 1
    ['double_rest_day', '2320.00'], // 3.90 − 1
  ];
  // With 365/393 every day of the year, rest days included, is in the salary.
  const covered: [DayType, string][] = [
    ['rest_day', '240.00'], // 1.30 − 1: only the 0.30 premium
    ['special', '240.00'], // 1.30 − 1
    ['special_rest_day', '400.00'], // 1.50 − 1
    ['regular', '800.00'], // 2.00 − 1
    ['regular_rest_day', '1280.00'], // 2.60 − 1
    ['double', '1600.00'], // 3.00 − 1
    ['double_rest_day', '2320.00'], // 3.90 − 1
  ];
  for (const payType of ['monthly', 'semi_monthly'] as const) {
    for (const factor of [261, 313] as const) {
      it.each(notCovered)(`${payType} f${factor}: %s → %s`, (dayType, expected) => {
        expect(linesFor(payType, factor, { dayType, hours: 8 })).toEqual({
          [`${dayType}_work`]: expected,
        });
      });
    }
    for (const factor of [365, 393] as const) {
      it.each(covered)(`${payType} f${factor}: %s → %s`, (dayType, expected) => {
        expect(linesFor(payType, factor, { dayType, hours: 8 })).toEqual({
          [`${dayType}_work`]: expected,
        });
      });
    }
  }

  it('ordinary-day regular hours produce no premium line (paid through basic)', () => {
    expect(linesFor('monthly', 261, { dayType: 'ordinary', hours: 8 })).toEqual({});
    expect(linesFor('daily', 313, { dayType: 'ordinary', hours: 8 })).toEqual({});
  });

  it('partial hours: 4.5 h on a regular holiday, daily → 4.5 × 100 × 2.00 = 900', () => {
    expect(linesFor('daily', 313, { dayType: 'regular', hours: '4.5' })).toEqual({
      regular_work: '900.00',
    });
  });
});

describe('computePremiums: overtime (2 h at 100/h), same for every pay type', () => {
  // OT hours are beyond the day's 8, so no part is in the salary: 2 × 100 × OT multiplier.
  const ot: [DayType, string][] = [
    ['ordinary', '250.00'], // × 1.25
    ['rest_day', '338.00'], // × 1.30 × 1.30
    ['special', '338.00'], // × 1.30 × 1.30
    ['special_rest_day', '390.00'], // × 1.50 × 1.30
    ['regular', '520.00'], // × 2.00 × 1.30
    ['regular_rest_day', '676.00'], // × 2.60 × 1.30
    ['double', '780.00'], // × 3.00 × 1.30
    ['double_rest_day', '1014.00'], // × 3.90 × 1.30
  ];
  for (const [payType, factor] of [
    ['monthly', 261],
    ['semi_monthly', 365],
    ['daily', 313],
    ['hourly', 393],
  ] as const) {
    it.each(ot)(`${payType} f${factor}: %s OT → %s`, (dayType, expected) => {
      expect(linesFor(payType, factor, { dayType, otHours: 2 })[`${dayType}_ot`]).toBe(expected);
    });
  }
});

describe('computePremiums: night differential (10% of the applicable hourly rate)', () => {
  // ND on regular hours: 2 h × 100 × day multiplier × 0.10. ND applies to the full applicable
  // rate even for monthly staff (it is never in the salary).
  const nd: [DayType, string][] = [
    ['ordinary', '20.00'], // × 1.00 × 0.10
    ['rest_day', '26.00'], // × 1.30 × 0.10
    ['special', '26.00'],
    ['special_rest_day', '30.00'], // × 1.50 × 0.10
    ['regular', '40.00'], // × 2.00 × 0.10
    ['regular_rest_day', '52.00'], // × 2.60 × 0.10
    ['double', '60.00'], // × 3.00 × 0.10
    ['double_rest_day', '78.00'], // × 3.90 × 0.10
  ];
  // ND on OT hours: 2 h × 100 × OT multiplier × 0.10.
  const ndOt: [DayType, string][] = [
    ['ordinary', '25.00'], // × 1.25 × 0.10
    ['rest_day', '33.80'], // × 1.69 × 0.10
    ['special', '33.80'],
    ['special_rest_day', '39.00'], // × 1.95 × 0.10
    ['regular', '52.00'], // × 2.60 × 0.10
    ['regular_rest_day', '67.60'], // × 3.38 × 0.10
    ['double', '78.00'], // × 3.90 × 0.10
    ['double_rest_day', '101.40'], // × 5.07 × 0.10
  ];
  for (const [payType, factor] of [
    ['monthly', 261],
    ['semi_monthly', 393],
    ['daily', 313],
    ['hourly', 365],
  ] as const) {
    it.each(nd)(`${payType}: ND on regular hours, %s → %s`, (dayType, expected) => {
      const l = linesFor(payType, factor, { dayType, hours: 8, ndHours: 2 });
      expect(l[`${dayType}_nd`]).toBe(expected);
    });
    it.each(ndOt)(`${payType}: ND on OT hours, %s → %s`, (dayType, expected) => {
      const l = linesFor(payType, factor, { dayType, otHours: 2, ndOtHours: 2 });
      expect(l[`${dayType}_nd_ot`]).toBe(expected);
    });
  }

  it('combined night shift on a regular holiday, monthly f261: all four lines', () => {
    // 8 h work: 8 × 100 × (2.00 − 1) = 800; 2 h OT: 2 × 100 × 2.60 = 520;
    // ND on 3 regular hours: 3 × 100 × 2.00 × 0.10 = 60; ND on 2 OT hours: 2 × 100 × 2.60 × 0.10 = 52.
    expect(
      linesFor('monthly', 261, {
        dayType: 'regular',
        hours: 8,
        otHours: 2,
        ndHours: 3,
        ndOtHours: 2,
      }),
    ).toEqual({
      regular_work: '800.00',
      regular_ot: '520.00',
      regular_nd: '60.00',
      regular_nd_ot: '52.00',
    });
  });

  it('rounds each line half-up to centavos', () => {
    // Hourly 30,000 × 12 ÷ 261 ÷ 8 = 172.41379…; 1 h ND × 0.10 = 17.241379… → 17.24
    const lines = computePremiums({
      payType: 'monthly',
      factor: 261,
      hourly: '172.41379310344827586',
      days: [{ dayType: 'ordinary', hours: 8, otHours: 0, ndHours: 1, ndOtHours: 0 }],
      rates: RATES_V1,
    });
    expect(lines.map((l) => l.amount)).toEqual(['17.24']);
  });

  it('several day types in one period produce one set of lines each', () => {
    const lines = computePremiums({
      payType: 'daily',
      factor: 313,
      hourly: HOURLY,
      days: [
        { dayType: 'ordinary', hours: 40, otHours: 3, ndHours: 0, ndOtHours: 0 },
        { dayType: 'special', hours: 8, otHours: 0, ndHours: 0, ndOtHours: 0 },
      ],
      rates: RATES_V1,
    });
    // ordinary OT 3 × 100 × 1.25 = 375; special 8 × 100 × 1.30 = 1040
    expect(lines.map((l) => [l.code, l.amount, l.quantity])).toEqual([
      ['ordinary_ot', '375.00', '3'],
      ['special_work', '1040.00', '8'],
    ]);
  });
});

describe('computePremiums reads multipliers from rates', () => {
  it('otOrdinary 1.25 → 1.50: ordinary OT 2 × 100 × 1.50 = 300', () => {
    const rates = ratesWith((r) => {
      r.premiums.otOrdinary = '1.50';
    });
    expect(linesFor('daily', 313, { dayType: 'ordinary', otHours: 2 }, rates)).toEqual({
      ordinary_ot: '300.00',
    });
  });
  it('otPremiumDay 1.30 → 1.40: rest-day OT 2 × 100 × 1.30 × 1.40 = 364', () => {
    const rates = ratesWith((r) => {
      r.premiums.otPremiumDay = '1.40';
    });
    expect(linesFor('daily', 313, { dayType: 'rest_day', otHours: 2 }, rates)).toEqual({
      rest_day_ot: '364.00',
    });
  });
  it('nightDiff 0.10 → 0.20: ordinary ND 2 × 100 × 0.20 = 40', () => {
    const rates = ratesWith((r) => {
      r.premiums.nightDiff = '0.20';
    });
    expect(linesFor('daily', 313, { dayType: 'ordinary', hours: 8, ndHours: 2 }, rates)).toEqual({
      ordinary_nd: '40.00',
    });
  });
  it('regular 2.00 → 2.50: monthly regular-holiday work 8 × 100 × (2.50 − 1) = 1200', () => {
    const rates = ratesWith((r) => {
      r.premiums.regular = '2.50';
    });
    expect(linesFor('monthly', 261, { dayType: 'regular', hours: 8 }, rates)).toEqual({
      regular_work: '1200.00',
    });
  });
});

describe('unworkedHolidayPay', () => {
  it('daily: 1 unworked regular holiday → 100% of 800 = 800', () => {
    const l = unworkedHolidayPay({
      payType: 'daily',
      daily: '800',
      regularDays: 1,
      doubleDays: 0,
      rates: RATES_V1,
    });
    expect(l.map((x) => [x.code, x.amount, x.category])).toEqual([
      ['regular_holiday_unworked', '800.00', 'holiday'],
    ]);
  });
  it('hourly: 2 unworked regular + 1 unworked double → 2 × 800 = 1600 and 200% × 800 = 1600', () => {
    const l = unworkedHolidayPay({
      payType: 'hourly',
      daily: '800',
      regularDays: 2,
      doubleDays: 1,
      rates: RATES_V1,
    });
    expect(l.map((x) => [x.code, x.amount])).toEqual([
      ['regular_holiday_unworked', '1600.00'],
      ['double_holiday_unworked', '1600.00'],
    ]);
  });
  it('monthly and semi-monthly staff get nothing extra (already in the salary)', () => {
    for (const payType of ['monthly', 'semi_monthly'] as const) {
      expect(
        unworkedHolidayPay({
          payType,
          daily: '800',
          regularDays: 1,
          doubleDays: 1,
          rates: RATES_V1,
        }),
      ).toEqual([]);
    }
  });
  it('zero days produce no lines', () => {
    expect(
      unworkedHolidayPay({
        payType: 'daily',
        daily: '800',
        regularDays: 0,
        doubleDays: 0,
        rates: RATES_V1,
      }),
    ).toEqual([]);
  });
});

describe('nightDiffHours (window 22:00–06:00)', () => {
  it.each<[string, string, string]>([
    ['22:00', '06:00', '8'], // exactly the window
    ['08:00', '17:00', '0'], // fully daytime
    ['23:00', '03:00', '4'], // inside, crossing midnight
    ['18:00', '23:00', '1'], // partial at the start: 22–23
    ['20:00', '02:00', '4'], // partial, crossing midnight: 22–02
    ['05:00', '14:00', '1'], // partial at the end: 05–06
    ['00:00', '08:00', '6'], // starts at midnight: 00–06
    ['21:00', '07:00', '8'], // covers the whole window
    ['04:00', '23:00', '3'], // touches both ends: 04–06 and 22–23
    ['22:30', '23:15', '0.75'], // fractional
    ['06:00', '22:00', '0'], // ends exactly where ND starts
    ['06:00', '06:00', '8'], // 24-hour shift
  ])('%s–%s → %s h', (start, end, hours) => {
    expect(nightDiffHours(start, end, RATES_V1).toString()).toBe(hours);
  });

  it('reads the window from rates', () => {
    // Window 20:00–04:00; shift 18:00–23:00 → 20–23 = 3 h.
    const rates = ratesWith((r) => {
      r.nightDiffWindow = { start: '20:00', end: '04:00' };
    });
    expect(toMoney(nightDiffHours('18:00', '23:00', rates))).toBe('3.00');
  });
});
