import { StatutoryRatesSchema, type StatutoryRates } from '../../../schemas/rates';
import { RATES_V1 } from '../../../seed/ratesV1';

/** A validated deep copy of RATES_V1, optionally modified, to prove the engine reads rates from data. */
export function ratesWith(mutate: (r: StatutoryRates) => void = () => undefined): StatutoryRates {
  const copy = StatutoryRatesSchema.parse(JSON.parse(JSON.stringify(RATES_V1)));
  mutate(copy);
  return StatutoryRatesSchema.parse(copy);
}
