/** Injectable time, so tests control "now". */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

export interface LocalParts {
  /** `YYYY-MM-DD` in the organization's time zone. */
  date: string;
  /** Hour 0–23 in that zone. */
  hour: number;
  /** Minutes after local midnight. */
  minutes: number;
}

export function localParts(instant: Date, timeZone: string): LocalParts {
  const parts = Object.fromEntries(formatterFor(timeZone).formatToParts(instant).map((part) => [part.type, part.value]));
  const hour = Number(parts['hour']);
  return {
    date: `${parts['year']}-${parts['month']}-${parts['day']}`,
    hour,
    minutes: hour * 60 + Number(parts['minute']),
  };
}

/** `YYYY-MM-DD` plus whole days (calendar arithmetic, no time zone involved). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** ISO weekday of a calendar date: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

/** Whole weeks since a fixed Monday, for rotations that change weekly. */
export function weekNumber(date: string): number {
  const days = Math.floor((Date.parse(`${date}T00:00:00Z`) - Date.parse('2024-01-01T00:00:00Z')) / 86_400_000);
  return Math.floor(days / 7);
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
