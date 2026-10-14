/**
 * The ONLY module that imports `cron-parser` (ROK-1096 D3). Everything else
 * works on `Date`s, so a library swap or upgrade is a one-file change.
 *
 * Verified against cron-parser 5.10.1: `CronExpressionParser.parse(expr,
 * { currentDate, tz })`; `next()` is strictly after `currentDate`, `prev()`
 * strictly before; both return a `CronDate` (`toDate()`). A rejected
 * expression throws from `parse`; an expression that never fires throws
 * "loop limit exceeded" from `next()`/`prev()`. Both propagate.
 */
import { CronExpressionParser, type CronExpression } from 'cron-parser';

/** The five split cron fields Pelican stores (ROK-1773). */
export interface CronFields {
  cronMinute: string;
  cronHour: string;
  cronDayOfMonth: string;
  cronMonth: string;
  cronDayOfWeek: string;
}

/** One field must be a single non-blank token — a space would shift fields. */
const SINGLE_TOKEN = /^\S+$/;
/** Start iterating this far before a bound; cron runs on whole minutes. */
const LEAD_MS = 1_000;

/** `"m h dom mon dow"`; throws if a stored field is blank or holds whitespace. */
export function toCronExpression(row: CronFields): string {
  const fields = [
    row.cronMinute,
    row.cronHour,
    row.cronDayOfMonth,
    row.cronMonth,
    row.cronDayOfWeek,
  ];
  if (!fields.every((f) => SINGLE_TOKEN.test(f))) {
    throw new Error('Invalid cron field');
  }
  return fields.join(' ');
}

function iterate(expr: string, tz: string, fromMs: number): CronExpression {
  return CronExpressionParser.parse(expr, {
    currentDate: new Date(fromMs),
    tz,
  });
}

/** Occurrences in `[from, to)`, chronological, at most `limit` of them. */
export function expandBetween(
  expr: string,
  tz: string,
  from: Date,
  to: Date,
  limit: number,
): Date[] {
  const it = iterate(expr, tz, from.getTime() - LEAD_MS);
  const out: Date[] = [];
  while (out.length < limit) {
    const at = it.next().toDate();
    if (at.getTime() >= to.getTime()) break;
    if (at.getTime() >= from.getTime()) out.push(at);
  }
  return out;
}

/** The last occurrence strictly before `at`. */
export function prevBefore(expr: string, tz: string, at: Date): Date {
  return iterate(expr, tz, at.getTime()).prev().toDate();
}

/** The first occurrence at or after `at`. */
export function nextAtOrAfter(expr: string, tz: string, at: Date): Date {
  const it = iterate(expr, tz, at.getTime() - LEAD_MS);
  let next = it.next().toDate();
  while (next.getTime() < at.getTime()) next = it.next().toDate();
  return next;
}

/** Is `at` (± `toleranceMs`) a run time of `expr` in `tz`? */
export function isOccurrence(
  expr: string,
  tz: string,
  at: Date,
  toleranceMs: number,
): boolean {
  const start = at.getTime() - toleranceMs - LEAD_MS;
  const next = iterate(expr, tz, start).next().toDate();
  return Math.abs(next.getTime() - at.getTime()) <= toleranceMs;
}
