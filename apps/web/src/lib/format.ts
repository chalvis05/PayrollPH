const pesoFormatter = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Format a 2-dp money string (as sent on the wire) for display, e.g. "12345.5" -> "₱12,345.50".
 * Display only: never do arithmetic on the result or on the parsed number.
 * Returns the input unchanged if it is not a valid decimal string.
 */
export function formatPeso(amount: string): string {
  const trimmed = amount.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return amount;
  // Intl formats numeric strings exactly (no float rounding) per ES2023 Intl.NumberFormat v3.
  return pesoFormatter.format(trimmed as `${number}`);
}

/** Human-readable file size, e.g. 1536 -> "1.5 KB". */
export function formatBytes(bytes: number): string {
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  if (unit === 0) return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`;
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit] ?? ''}`;
}
