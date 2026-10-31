/**
 * ROK-1597 spec §3.2: one Graph `calendarView` occurrence → a `BusyBlock`.
 *
 * Privacy (§6.4.1): only instants, all-day dates and our copy id are copied
 * out; subject, body, location and attendees never leave this file (they are
 * not even requested — `MICROSOFT_EVENTS_SELECT`). Pure — no I/O, no logging.
 */
import type { BusyBlock } from '../calendar-provider.interface';
import { decodeCopyId } from '../rl-copy-id.helpers';
import { RL_COPY_PROP_ID } from './microsoft-graph.constants';
import { allDayBounds, graphUtcInstant } from './microsoft-all-day.helpers';

type Json = Record<string, unknown>;

/**
 * §3.2 `showAs` → busy. `tentative` is NOT busy (operator Q3), nor are
 * `free`, `workingElsewhere`, `unknown`, a missing value or any value Graph
 * adds later — never invent busy time.
 */
export const MICROSOFT_SHOW_AS_BUSY: ReadonlySet<string> = new Set([
  'busy',
  'oof',
]);

/** Busy by the table, and neither cancelled nor declined by the user (Q2). */
export function isBusyGraphEvent(event: Json): boolean {
  if (event.isCancelled === true) return false;
  if (toRecord(event.responseStatus).response === 'declined') return false;
  return (
    typeof event.showAs === 'string' && MICROSOFT_SHOW_AS_BUSY.has(event.showAs)
  );
}

/** The Raid Ledger copy id in the expanded extended property, else null. */
export function ourCopyIdOf(event: Json): string | null {
  const props = event.singleValueExtendedProperties;
  if (!Array.isArray(props)) return null;
  const wanted = RL_COPY_PROP_ID.toLowerCase();
  for (const raw of props) {
    const prop = toRecord(raw);
    const id = typeof prop.id === 'string' ? prop.id.toLowerCase() : '';
    if (id === wanted && decodeCopyId(prop.value)) {
      return typeof prop.value === 'string' ? prop.value : null;
    }
  }
  return null;
}

/**
 * One occurrence → a block, or null when it is not busy or its times are
 * unusable (non-UTC, inverted, degenerate). All-day events go through the
 * §3.3 resolution; `ourId` is set when the occurrence is one of our copies.
 */
export function normalizeGraphEvent(item: unknown): BusyBlock | null {
  const event = toRecord(item);
  if (!isBusyGraphEvent(event)) return null;
  const block = toBounds(event);
  if (!block) return null;
  const copyId = ourCopyIdOf(event);
  if (copyId !== null) block.ourId = copyId;
  return block;
}

function toBounds(event: Json): BusyBlock | null {
  const from = graphUtcInstant(event.start);
  const to = graphUtcInstant(event.end);
  if (from === null || to === null) return null;
  if (event.isAllDay === true) {
    const day = allDayBounds(from, to, event.originalStartTimeZone);
    if (!day) return null;
    return {
      start: day.start,
      end: day.end,
      allDay: true,
      allDayDates: { first: day.first, lastInclusive: day.lastInclusive },
    };
  }
  if (to <= from) return null;
  return { start: new Date(from), end: new Date(to), allDay: false };
}

function toRecord(value: unknown): Json {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(Object.entries(value));
}
