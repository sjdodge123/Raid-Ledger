/**
 * ROK-1597 (Graph verification item 6): `$expand=singleValueExtendedProperties`
 * is documented on single events only, NOT on `calendarView`. The read keeps
 * the expand as the fast path; when NO occurrence of one calendar's read
 * carries the expanded array at all, Graph ignored the expand, so each busy
 * occurrence's copy id is resolved with the documented single-event GET —
 * sequentially (Outlook allows 4 concurrent per mailbox) and bounded by
 * `MICROSOFT_COPY_ID_LOOKUP_MAX` per calendar read.
 *
 * Our property id is sent with the exact casing it was minted with
 * (`RL_COPY_PROP_ID`; Graph matches the `Name` part case-sensitively); our own
 * match (`ourCopyIdOf`) stays case-insensitive. Nothing here logs.
 */
import { assertGraphOk, graphRequest } from './microsoft-graph-errors.helpers';
import {
  GRAPH_API,
  MICROSOFT_EVENTS_EXPAND,
  MICROSOFT_READ_PREFER,
} from './microsoft-graph.constants';
import { isBusyGraphEvent } from './microsoft-normalize.helpers';

/** Per-calendar-read cap on fallback GETs (the rest read as foreign). */
export const MICROSOFT_COPY_ID_LOOKUP_MAX = 50;

/** Which path resolved copy ids (`none` = nothing to resolve). */
export type CopyIdReadPath = 'none' | 'expand' | 'fallback';

/** The occurrences with copy properties filled, plus what it cost. */
export interface CopyIdResolution {
  items: unknown[];
  path: CopyIdReadPath;
  lookups: number;
  /** Busy occurrences left unresolved because the cap was hit. */
  capped: boolean;
}

type Json = Record<string, unknown>;

/** True when any occurrence carries the expanded array (even empty). */
export function expandHonoured(items: readonly unknown[]): boolean {
  return items.some((item) =>
    Array.isArray(toRecord(item).singleValueExtendedProperties),
  );
}

/** Documented single-event form: `/me/events/{id}?$expand=…($filter=…)`. */
export function buildCopyPropLookupUrl(eventId: string): string {
  return (
    `${GRAPH_API}/me/events/${encodeURIComponent(eventId)}?$select=id` +
    `&$expand=${encodeURIComponent(MICROSOFT_EVENTS_EXPAND)}`
  );
}

/**
 * Keep the expanded properties when Graph honoured `$expand`; otherwise
 * GET each busy occurrence's property (bounded). Errors other than 404/410
 * propagate through the read map.
 */
export async function resolveCopyIds(
  token: string,
  items: unknown[],
): Promise<CopyIdResolution> {
  if (items.length === 0) return result(items, 'none', 0, false);
  if (expandHonoured(items)) return result(items, 'expand', 0, false);
  const out: unknown[] = [];
  let lookups = 0;
  let wanted = 0;
  for (const item of items) {
    const event = toRecord(item);
    const id = lookupIdOf(event);
    if (id !== null) wanted += 1;
    if (id === null || lookups >= MICROSOFT_COPY_ID_LOOKUP_MAX) {
      out.push(item);
      continue;
    }
    lookups += 1;
    const props = await fetchCopyProps(token, id);
    out.push({ ...event, singleValueExtendedProperties: props });
  }
  return result(out, 'fallback', lookups, wanted > lookups);
}

function result(
  items: unknown[],
  path: CopyIdReadPath,
  lookups: number,
  capped: boolean,
): CopyIdResolution {
  return { items, path, lookups, capped };
}

/** Only busy occurrences can become blocks, so only they are looked up. */
function lookupIdOf(event: Json): string | null {
  if (!isBusyGraphEvent(event)) return null;
  return typeof event.id === 'string' && event.id ? event.id : null;
}

async function fetchCopyProps(
  token: string,
  eventId: string,
): Promise<unknown[]> {
  const url = buildCopyPropLookupUrl(eventId);
  const res = await graphRequest('GET', url, token, undefined, {
    prefer: MICROSOFT_READ_PREFER,
  });
  if (res.status === 404 || res.status === 410) return [];
  assertGraphOk(res, 'read');
  const props = toRecord(res.json).singleValueExtendedProperties;
  return Array.isArray(props) ? Array.from<unknown>(props) : [];
}

function toRecord(value: unknown): Json {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(Object.entries(value));
}
