/** Date helpers. Business dates are Asia/Manila calendar dates as `YYYY-MM-DD` strings. */

const MANILA = 'Asia/Manila';
const pad2 = (n: number) => String(n).padStart(2, '0');

/** Today in Asia/Manila as `YYYY-MM-DD` (en-CA formats as an ISO date). */
export function manilaToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: MANILA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Current calendar year in Asia/Manila. */
export function manilaYear(): number {
  return Number(manilaToday().slice(0, 4));
}

/** `YYYY-MM` of the month before the current Manila month. */
export function previousMonth(): string {
  const [y = 1970, m = 1] = manilaToday().split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${pad2(m - 1)}`;
}

/** The semi-monthly cutoff containing `today`: 1–15 or 16–end of month. */
export function currentCutoff(today: string = manilaToday()): { from: string; to: string } {
  const [y = 1970, m = 1, d = 1] = today.split('-').map(Number);
  const ym = `${y}-${pad2(m)}`;
  if (d <= 15) return { from: `${ym}-01`, to: `${ym}-15` };
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-16`, to: `${ym}-${pad2(lastDay)}` };
}

export const isIsoDate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s);

const dateStyles = {
  /** "Oct 15, 2026" */
  medium: { month: 'short', day: 'numeric', year: 'numeric' },
  /** "Tue, Oct 20" */
  weekday: { weekday: 'short', month: 'short', day: 'numeric' },
  /** "Tue, Oct 20, 2026" */
  full: { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' },
} as const satisfies Record<string, Intl.DateTimeFormatOptions>;

export type DateStyle = keyof typeof dateStyles;

const dateFormatters = Object.fromEntries(
  Object.entries(dateStyles).map(([k, opts]) => [
    k,
    new Intl.DateTimeFormat('en-PH', { ...opts, timeZone: 'UTC' }),
  ]),
) as Record<DateStyle, Intl.DateTimeFormat>;

/**
 * Display a `YYYY-MM-DD` calendar date without shifting it through the browser's timezone.
 * Returns the input unchanged when it is not a valid date.
 */
export function formatDate(iso: string, style: DateStyle = 'medium'): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(ms) ? iso : dateFormatters[style].format(ms);
}

export function formatPeriod(start: string, end: string): string {
  return `${formatDate(start)} – ${formatDate(end)}`;
}

const dateTimeFormatter = new Intl.DateTimeFormat('en-PH', {
  timeZone: MANILA,
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** Display an ISO timestamp in Manila time, e.g. "Oct 24, 2026, 2:15 AM". */
export function formatDateTime(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? iso : dateTimeFormatter.format(ms);
}
