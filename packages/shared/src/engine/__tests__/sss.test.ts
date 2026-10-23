import { describe, expect, it } from 'vitest';
import { toMoney } from '../../money';
import { RATES_V1 } from '../../seed/ratesV1';
import { computeSss, sssMsc } from '../sss';
import { ratesWith } from './fixtures/rates';

const msc = (comp: string): string => toMoney(sssMsc(comp, RATES_V1));

describe('sssMsc (2025 table: 5,000 – 35,000 in steps of 500, brackets centred on each step)', () => {
  it.each<[string, string]>([
    ['0', '5000.00'], // below the first bracket → minimum
    ['1000', '5000.00'],
    ['5249.99', '5000.00'], // below 5,000 + 250
    ['5250', '5500.00'], // half-step boundary rounds up
    ['5250.01', '5500.00'],
    ['5749.99', '5500.00'], // 5,250 – 5,749.99 → 5,500
    ['5750', '6000.00'],
    ['14749.99', '14500.00'],
    ['14750', '15000.00'],
    ['19749.99', '19500.00'],
    ['19750', '20000.00'],
    ['20249.99', '20000.00'],
    ['20250', '20500.00'],
    ['30000', '30000.00'], // centre of a bracket
    ['34249.99', '34000.00'],
    ['34250', '34500.00'],
    ['34749.99', '34500.00'],
    ['34750', '35000.00'], // 34,750 and over → maximum
    ['35000', '35000.00'],
    ['1000000', '35000.00'], // huge salaries are capped
  ])('compensation %s → MSC %s', (comp, expected) => {
    expect(msc(comp)).toBe(expected);
  });
});

describe('computeSss', () => {
  it('minimum MSC 5,000: EE 5% = 250, ER 10% = 500, EC 10 (MSC < 15,000)', () => {
    const c = computeSss('3000', RATES_V1);
    expect(
      [c.msc, c.mscRegular, c.mscMpf, c.ee, c.eeMpf, c.er, c.erMpf, c.ec].map(toMoney),
    ).toEqual(['5000.00', '5000.00', '0.00', '250.00', '0.00', '500.00', '0.00', '10.00']);
  });

  it('EC tier: MSC 14,500 → 10; MSC 15,000 → 30', () => {
    expect(toMoney(computeSss('14749.99', RATES_V1).ec)).toBe('10.00');
    expect(toMoney(computeSss('14750', RATES_V1).ec)).toBe('30.00');
  });

  it('MSC 20,000 (top of the regular tier): no MPF; EE 1,000, ER 2,000, EC 30', () => {
    const c = computeSss('20000', RATES_V1);
    expect([c.mscRegular, c.mscMpf, c.ee, c.eeMpf, c.er, c.erMpf, c.ec].map(toMoney)).toEqual([
      '20000.00',
      '0.00',
      '1000.00',
      '0.00',
      '2000.00',
      '0.00',
      '30.00',
    ]);
  });

  it('MSC 20,500: MPF 500 → EE 1,000 + 25 = 1,025; ER 2,000 + 50 = 2,050', () => {
    const c = computeSss('20250', RATES_V1);
    expect([c.msc, c.mscRegular, c.mscMpf, c.ee, c.eeMpf, c.er, c.erMpf].map(toMoney)).toEqual([
      '20500.00',
      '20000.00',
      '500.00',
      '1025.00',
      '25.00',
      '2050.00',
      '50.00',
    ]);
  });

  it('maximum MSC 35,000: MPF 15,000 → EE 1,000 + 750 = 1,750; ER 2,000 + 1,500 = 3,500; EC 30', () => {
    const c = computeSss('250000', RATES_V1);
    expect(
      [c.msc, c.mscRegular, c.mscMpf, c.ee, c.eeMpf, c.er, c.erMpf, c.ec].map(toMoney),
    ).toEqual([
      '35000.00',
      '20000.00',
      '15000.00',
      '1750.00',
      '750.00',
      '3500.00',
      '1500.00',
      '30.00',
    ]);
  });

  it('reads rates from data: EE rate 5% → 4.5% at MSC 10,000 gives EE 450', () => {
    const rates = ratesWith((r) => {
      r.sss.eeRate = '0.045';
    });
    expect(toMoney(computeSss('10000', rates).ee)).toBe('450.00');
  });

  it('reads the MSC ceiling from data: max 30,000 caps a 50,000 salary at MSC 30,000', () => {
    const rates = ratesWith((r) => {
      r.sss.mscMax = '30000';
    });
    expect(toMoney(sssMsc('50000', rates))).toBe('30000.00');
  });
});
