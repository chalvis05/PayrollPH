-- Twice-weekly payouts (every Wednesday and Saturday) need a BIR period count. Rates are data:
-- add 104 periods per year to every stored rates version that does not have it yet, so they
-- keep validating against StatutoryRatesSchema. Existing figures are not touched.
UPDATE statutory_rates
SET data = jsonb_set(data, '{bir,periodsPerYear,twice_weekly}', '104'::jsonb, true)
WHERE NOT (data -> 'bir' -> 'periodsPerYear') ? 'twice_weekly';
