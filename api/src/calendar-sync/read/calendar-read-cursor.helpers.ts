/**
 * ROK-1598 (spec D7, §2.8): the provider read cursor round-trip and the
 * `primary` alias for providers whose primary calendar has a real id.
 *
 * - `sync_cursor` is jsonb: anything but a flat string→string object is
 *   treated as "no cursor" (a full read), never trusted.
 * - Google answers `primary` itself; Apple has no such alias, so the
 *   connection's default selection (`[]` → `primary`) reads the calendar
 *   `listCalendars` flags primary (`home`).
 */
import type {
  CalendarProviderKey,
  ProviderCalendar,
} from '../providers/calendar-provider.interface';

const PRIMARY_ALIAS = 'primary';

/** A flat `Record<string, string>` (the shape `fetchBusy` returns). */
export function isCursor(v: unknown): v is Record<string, string> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  return Object.values(v).every((x) => typeof x === 'string');
}

/** The stored cursor, or undefined when absent or malformed. */
export function storedCursor(raw: unknown): Record<string, string> | undefined {
  return isCursor(raw) ? raw : undefined;
}

/** Providers whose calendars have no literal `primary` id. */
const NO_PRIMARY_ALIAS: ReadonlySet<CalendarProviderKey> = new Set(['apple']);

/**
 * Swap `primary` for the listed primary calendar's id where needed, then
 * drop `excluded` (R1: the dedicated calendar). Apple flags a primary even
 * with no `home` — the first collection by href, which can be the Raid
 * Ledger calendar; the first eligible calendar by id reads instead.
 */
export function resolvePrimaryAlias(
  provider: CalendarProviderKey,
  ids: readonly string[],
  calendars: readonly ProviderCalendar[],
  excluded: ReadonlySet<string> = new Set(),
): string[] {
  if (!NO_PRIMARY_ALIAS.has(provider)) return [...ids];
  const primary = eligiblePrimary(calendars, excluded);
  const out = ids.flatMap((id) =>
    id === PRIMARY_ALIAS ? (primary ? [primary] : []) : [id],
  );
  return [...new Set(out)].filter((id) => !excluded.has(id));
}

function eligiblePrimary(
  calendars: readonly ProviderCalendar[],
  excluded: ReadonlySet<string>,
): string | undefined {
  const eligible = (c: ProviderCalendar) =>
    !c.isRaidLedger && !excluded.has(c.id);
  const flagged = calendars.find((c) => c.primary);
  if (!flagged) return undefined;
  if (eligible(flagged)) return flagged.id;
  const rest = calendars.filter(eligible).map((c) => c.id);
  return rest.sort((a, b) => a.localeCompare(b))[0];
}

/** `buildSyncedFields`' cursor part: written only when the provider sent one. */
export function cursorFields(cursor: Record<string, string> | undefined): {
  syncCursor?: Record<string, string>;
} {
  return cursor ? { syncCursor: cursor } : {};
}
