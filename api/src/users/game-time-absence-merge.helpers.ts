/**
 * Clip + merge absence spans before the composite view expands them
 * (ROK-1842). N overlapping or duplicate rows collapse to one span, so the
 * expansion costs O(merged spans x 7 days), not O(rows x 7 days).
 */
import { previousCalendarDay } from '../calendar-sync/read/calendar-away-derive.helpers';

/** An inclusive `YYYY-MM-DD` date range. */
export interface DateSpan {
  startDate: string;
  endDate: string;
}

/** `span` clipped to `window`, or null when they do not overlap. */
function clipSpan(span: DateSpan, window: DateSpan): DateSpan | null {
  const startDate =
    span.startDate > window.startDate ? span.startDate : window.startDate;
  const endDate = span.endDate < window.endDate ? span.endDate : window.endDate;
  return startDate <= endDate ? { startDate, endDate } : null;
}

/**
 * Sorted union of `spans`; overlapping and adjacent (next starts the day
 * after the previous ends) spans join. ISO dates compare as strings.
 */
export function mergeAbsenceSpans(spans: DateSpan[]): DateSpan[] {
  const sorted = [...spans].sort((a, b) =>
    a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0,
  );
  const merged: DateSpan[] = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (
      last !== undefined &&
      previousCalendarDay(span.startDate) <= last.endDate
    ) {
      if (span.endDate > last.endDate) last.endDate = span.endDate;
    } else {
      merged.push({ startDate: span.startDate, endDate: span.endDate });
    }
  }
  return merged;
}

/** Clip every span to the inclusive window, then merge the survivors. */
export function mergeWithinWindow(
  spans: DateSpan[],
  window: { firstDate: string; lastDate: string },
): DateSpan[] {
  const bounds = { startDate: window.firstDate, endDate: window.lastDate };
  const clipped = spans
    .map((s) => clipSpan(s, bounds))
    .filter((s): s is DateSpan => s !== null);
  return mergeAbsenceSpans(clipped);
}
