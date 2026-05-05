import type { AutomationSchedule } from "@cemeworm/shared";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const MAX_SEARCH_MINUTES = 5 * 366 * 24 * 60;
const WEEKDAY_INDEX: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};

type RRuleParts = {
  freq: string;
  interval: number;
  byMinute?: Set<number>;
  byHour?: Set<number>;
  byDay?: Set<number>;
  byMonthDay?: Set<number>;
};

export function previewAutomationSchedule(
  schedule: AutomationSchedule,
  from = Date.now(),
  limit = 5,
): number[] {
  if (limit <= 0) return [];
  if (schedule.kind === "once") {
    return schedule.at > from ? [schedule.at] : [];
  }

  const parts = parseRRule(schedule.rrule);
  const startAt = schedule.startAt ?? from;
  const occurrences: number[] = [];
  let cursor = ceilToNextMinute(Math.max(from + 1, startAt));
  for (let i = 0; i < MAX_SEARCH_MINUTES && occurrences.length < limit; i += 1) {
    if (matchesRRule(cursor, startAt, parts)) {
      occurrences.push(cursor);
    }
    cursor += 60_000;
  }
  return occurrences;
}

export function nextAutomationRunAt(schedule: AutomationSchedule, from = Date.now()): number | undefined {
  return previewAutomationSchedule(schedule, from, 1)[0];
}

function parseRRule(rrule: string): RRuleParts {
  const record: Record<string, string> = {};
  for (const segment of rrule.split(";")) {
    const [rawKey, ...rawValue] = segment.split("=");
    const key = rawKey?.trim().toUpperCase();
    const value = rawValue.join("=").trim();
    if (key && value) {
      record[key] = value;
    }
  }

  const freq = record.FREQ?.toUpperCase();
  if (!freq || !["MINUTELY", "HOURLY", "DAILY", "WEEKLY", "MONTHLY"].includes(freq)) {
    throw new Error(`Unsupported automation RRULE frequency '${record.FREQ ?? ""}'.`);
  }

  return {
    freq,
    interval: Math.max(1, parsePositiveInt(record.INTERVAL) ?? 1),
    byMinute: parseNumberSet(record.BYMINUTE, 0, 59),
    byHour: parseNumberSet(record.BYHOUR, 0, 23),
    byDay: parseWeekdaySet(record.BYDAY),
    byMonthDay: parseNumberSet(record.BYMONTHDAY, 1, 31),
  };
}

function matchesRRule(timestamp: number, startAt: number, parts: RRuleParts): boolean {
  if (timestamp < startAt) return false;

  const date = new Date(timestamp);
  if (parts.byMinute && !parts.byMinute.has(date.getMinutes())) return false;
  if (parts.byHour && !parts.byHour.has(date.getHours())) return false;
  if (parts.byDay && !parts.byDay.has(date.getDay())) return false;
  if (parts.byMonthDay && !parts.byMonthDay.has(date.getDate())) return false;

  switch (parts.freq) {
    case "MINUTELY":
      return elapsedWholeMinutes(startAt, timestamp) % parts.interval === 0;
    case "HOURLY":
      return elapsedWholeHours(startAt, timestamp) % parts.interval === 0;
    case "DAILY":
      return elapsedWholeDays(startAt, timestamp) % parts.interval === 0;
    case "WEEKLY":
      return elapsedWholeWeeks(startAt, timestamp) % parts.interval === 0;
    case "MONTHLY":
      return elapsedWholeMonths(startAt, timestamp) % parts.interval === 0;
    default:
      return false;
  }
}

function parseNumberSet(value: string | undefined, min: number, max: number): Set<number> | undefined {
  if (!value) return undefined;
  const values = value
    .split(",")
    .map((item) => parsePositiveInt(item.trim()))
    .filter((item): item is number => item !== undefined && item >= min && item <= max);
  return values.length > 0 ? new Set(values) : undefined;
}

function parseWeekdaySet(value: string | undefined): Set<number> | undefined {
  if (!value) return undefined;
  const values = value
    .split(",")
    .map((item) => WEEKDAY_INDEX[item.trim().toUpperCase()])
    .filter((item): item is number => typeof item === "number");
  return values.length > 0 ? new Set(values) : undefined;
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function ceilToNextMinute(timestamp: number): number {
  return Math.ceil(timestamp / 60_000) * 60_000;
}

function elapsedWholeMinutes(startAt: number, timestamp: number): number {
  return Math.floor((timestamp - startAt) / 60_000);
}

function elapsedWholeHours(startAt: number, timestamp: number): number {
  return Math.floor((timestamp - startAt) / 3_600_000);
}

function elapsedWholeDays(startAt: number, timestamp: number): number {
  return Math.floor((startOfDay(timestamp) - startOfDay(startAt)) / DAY_MS);
}

function elapsedWholeWeeks(startAt: number, timestamp: number): number {
  return Math.floor((startOfWeek(timestamp) - startOfWeek(startAt)) / WEEK_MS);
}

function elapsedWholeMonths(startAt: number, timestamp: number): number {
  const start = new Date(startAt);
  const current = new Date(timestamp);
  return (current.getFullYear() - start.getFullYear()) * 12 + current.getMonth() - start.getMonth();
}

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function startOfWeek(timestamp: number): number {
  const date = new Date(startOfDay(timestamp));
  const day = date.getDay();
  const delta = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + delta);
  return date.getTime();
}
