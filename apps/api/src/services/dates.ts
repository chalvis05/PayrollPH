/** Date helpers. All business dates are Asia/Manila calendar dates as `YYYY-MM-DD` strings. */

const MANILA = 'Asia/Manila';

/** Today's date in Manila. */
export function manilaToday(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: MANILA }).format(now);
}

function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.split('-').map(Number);
  if (y === undefined || m === undefined || d === undefined) throw new Error(`Bad date ${iso}`);
  return [y, m, d];
}

const toIso = (dt: Date): string => dt.toISOString().slice(0, 10);
// Date arithmetic is done on UTC midnights so it never depends on the server's timezone.
const fromIso = (iso: string): Date => {
  const [y, m, d] = parts(iso);
  return new Date(Date.UTC(y, m - 1, d));
};

export function addDays(iso: string, days: number): string {
  const dt = fromIso(iso);
  dt.setUTCDate(dt.getUTCDate() + days);
  return toIso(dt);
}

export function lastDayOfMonth(year: number, month: number): string {
  return toIso(new Date(Date.UTC(year, month, 0)));
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(iso: string): number {
  const d = fromIso(iso).getUTCDay();
  return d === 0 ? 7 : d;
}

/** Inclusive list of dates from start to end. */
export function eachDate(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

export function yearOf(iso: string): number {
  return parts(iso)[0];
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}
