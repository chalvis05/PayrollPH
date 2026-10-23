import Decimal from 'decimal.js';

/** Isolated Decimal constructor so engine math never depends on global config. */
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = InstanceType<typeof D>;

/** Value accepted wherever the engine takes a numeric input. */
export type Numeric = string | number | Dec;

export const ZERO = new D(0);

export function dec(value: Numeric): Dec {
  return new D(value);
}

/** Round to centavos, half-up. */
export function round2(value: Numeric): Dec {
  return new D(value).toDecimalPlaces(2, D.ROUND_HALF_UP);
}

/** Two-decimal string as stored in NUMERIC(14,2) and sent on the wire. */
export function toMoney(value: Numeric): string {
  return round2(value).toFixed(2);
}

export function sum(values: readonly Numeric[]): Dec {
  return values.reduce<Dec>((acc, v) => acc.plus(v), ZERO);
}

export function max(a: Numeric, b: Numeric): Dec {
  return D.max(a, b);
}

export function min(a: Numeric, b: Numeric): Dec {
  return D.min(a, b);
}

export function clamp(value: Numeric, lo: Numeric, hi: Numeric): Dec {
  return D.min(D.max(value, lo), hi);
}
