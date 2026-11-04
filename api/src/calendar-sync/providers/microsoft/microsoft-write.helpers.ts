/**
 * ROK-1597 spec §3.4: Graph calls behind the write capability — the
 * dedicated "Raid Ledger" calendar and the per-sign-up copies. Every call
 * goes through `graphRequest` (the spied `microsoft-http` seam) with
 * `Prefer: IdType="ImmutableId"`, so the ids we store match the ids the read
 * side sees, and is mapped by `assertGraphOk(res, 'write')` (§3.5: 401 →
 * ProviderAuthError, 403 → ProviderAuthError('scope'), 404/410 →
 * NotFoundError, 429 → RateLimitError(Retry-After), 5xx → TransientError).
 *
 * Copies never carry attendees (no invitations) and are recognised by the
 * `RL_COPY_PROP_ID` single-value extended property. Nothing here logs.
 */
import { TransientError } from '../calendar-provider.errors';
import type { CopyEventInput, CopyRef } from '../calendar-provider.interface';
import { copyIsBusy, copySummary } from '../copy-presentation.helpers';
import { RAID_LEDGER_CALENDAR_SUMMARY } from '../google/google-write.helpers';
import type {
  MicrosoftHttpResponse,
  MicrosoftJsonMethod,
} from './microsoft-http';
import {
  assertGraphOk,
  graphErrorCode,
  graphRequest,
} from './microsoft-graph-errors.helpers';
import {
  GRAPH_API,
  PREFER_IMMUTABLE_ID,
  PREFER_UTC,
  RL_COPY_PROP_ID,
} from './microsoft-graph.constants';
import {
  buildCalendarListUrl,
  readAllGraphPages,
} from './microsoft-read.helpers';

/** Same name as Google's dedicated calendar — must stay `'Raid Ledger'`. */
export const RAID_LEDGER_CALENDAR_NAME = RAID_LEDGER_CALENDAR_SUMMARY;
/**
 * Every write asks for UTC times and immutable ids (stable across folder
 * moves) — the same pair as the reads, so a returned event is read the same
 * way on both sides (both headers VERIFIED, ROK-1597 Graph verification 9).
 */
export const MICROSOFT_WRITE_PREFER: readonly string[] = [
  PREFER_UTC,
  PREFER_IMMUTABLE_ID,
];
/** UNVERIFIED (spec §3.5): Graph's code for "a calendar with that name exists". */
export const GRAPH_FOLDER_EXISTS = 'ErrorFolderExists';

/** Graph `dateTimeTimeZone`: a zone-less local dateTime plus its zone. */
export interface GraphDateTimeZone {
  dateTime: string;
  timeZone: 'UTC';
}

/** The keys a copy PATCH may carry (no attendees, no location). */
export interface MicrosoftEventPatchBody {
  subject: string;
  body: { contentType: 'text'; content: string };
  start: GraphDateTimeZone;
  end: GraphDateTimeZone;
  showAs: 'busy' | 'free';
}

/** The create body: the patch keys plus our copy-id extended property. */
export interface MicrosoftEventBody extends MicrosoftEventPatchBody {
  singleValueExtendedProperties: { id: string; value: string }[];
}

/** An instant as Graph wants it: `2026-11-01T19:00:00.000` + `UTC`. */
export function toGraphDateTime(d: Date): GraphDateTimeZone {
  return { dateTime: d.toISOString().replace(/Z$/, ''), timeZone: 'UTC' };
}

/**
 * Confirmed → Busy + plain subject; tentative → Free + "(Tentative) ";
 * benched → Free + "(Bench) " (ruled 2026-10-08; rules in copy-presentation).
 * The event URL travels in the body text (Graph has no `source` field).
 */
export function buildMicrosoftPatchBody(
  input: CopyEventInput,
): MicrosoftEventPatchBody {
  return {
    subject: copySummary(input),
    body: { contentType: 'text', content: input.description },
    start: toGraphDateTime(input.start),
    end: toGraphDateTime(input.end),
    showAs: copyIsBusy(input) ? 'busy' : 'free',
  };
}

/** The full create body: patch keys + `singleValueExtendedProperties`. */
export function buildMicrosoftEventBody(
  input: CopyEventInput,
): MicrosoftEventBody {
  return {
    ...buildMicrosoftPatchBody(input),
    singleValueExtendedProperties: [
      { id: RL_COPY_PROP_ID, value: input.copyId },
    ],
  };
}

/** `/me/calendars[/{id}]` (ids are base64url-ish — always encoded). */
export function calendarsUrl(calendarId?: string): string {
  const base = `${GRAPH_API}/me/calendars`;
  return calendarId ? `${base}/${encodeURIComponent(calendarId)}` : base;
}

/** Events collection of a calendar; `'primary'` → `/me/calendar/events`. */
export function calendarEventsPath(calendarId: string): string {
  return calendarId === 'primary'
    ? `${GRAPH_API}/me/calendar/events`
    : `${calendarsUrl(calendarId)}/events`;
}

/** One event by id (update / delete address events directly). */
export function eventUrl(providerEventId: string): string {
  return `${GRAPH_API}/me/events/${encodeURIComponent(providerEventId)}`;
}

/** The adopt lookup: our property with this copy id, in THAT calendar only. */
export function buildCopyIdLookupUrl(
  calendarId: string,
  copyId: string,
): string {
  const filter =
    `singleValueExtendedProperties/Any(ep: ep/id eq '${odata(RL_COPY_PROP_ID)}'` +
    ` and ep/value eq '${odata(copyId)}')`;
  return (
    `${calendarEventsPath(calendarId)}?$filter=${encodeURIComponent(filter)}` +
    `&$select=id&$top=1`
  );
}

/**
 * The calendar named exactly "Raid Ledger" that we may edit, else null.
 * `POST /me/calendars` is NOT documented to refuse a duplicate name (ROK-1597
 * Graph verification, item 5), so `ensureRaidLedgerCalendar` looks here
 * BEFORE creating. Reads the full list (follows `@odata.nextLink`) and
 * matches client-side — `$filter` on `name` is not documented either.
 */
export async function findRaidLedgerCalendar(
  token: string,
): Promise<string | null> {
  const { items } = await readAllGraphPages(token, buildCalendarListUrl());
  for (const item of items) {
    const row = asRecord(item);
    if (row.name !== RAID_LEDGER_CALENDAR_NAME || row.canEdit === false) {
      continue;
    }
    if (typeof row.id === 'string' && row.id) return row.id;
  }
  return null;
}

/**
 * `POST /me/calendars {name:'Raid Ledger'}` → the new id. Fallback only (the
 * caller lists first): a name conflict (409, or the UNVERIFIED
 * `ErrorFolderExists` code) re-lists and adopts the existing one.
 */
export async function insertMicrosoftCalendar(token: string): Promise<string> {
  const res = await send('POST', calendarsUrl(), token, {
    name: RAID_LEDGER_CALENDAR_NAME,
  });
  if (isNameConflict(res)) {
    const existing = await findRaidLedgerCalendar(token);
    if (!existing) throw new TransientError('calendar_name_conflict');
    return existing;
  }
  assertGraphOk(res, 'write');
  return readId(res.json);
}

/** `GET /me/calendars/{id}` — NotFoundError when it is gone. */
export async function getMicrosoftCalendar(
  token: string,
  calendarId: string,
): Promise<string> {
  const res = await call(
    'GET',
    `${calendarsUrl(calendarId)}?$select=id`,
    token,
  );
  return readId(res.json);
}

/** `DELETE /me/calendars/{id}` (its events go with it) — NotFound if gone. */
export async function deleteMicrosoftCalendar(
  token: string,
  calendarId: string,
): Promise<void> {
  await call('DELETE', calendarsUrl(calendarId), token);
}

/** `POST {calendar}/events` of a copy → its ref. */
export async function insertMicrosoftEvent(
  token: string,
  calendarId: string,
  input: CopyEventInput,
): Promise<CopyRef> {
  const url = calendarEventsPath(calendarId);
  const res = await call('POST', url, token, buildMicrosoftEventBody(input));
  return readCopyRef(res.json, calendarId);
}

/** `PATCH /me/events/{id}` (property already set) — NotFound propagates. */
export async function patchMicrosoftEvent(
  token: string,
  calendarId: string,
  providerEventId: string,
  input: CopyEventInput,
): Promise<CopyRef> {
  const body = buildMicrosoftPatchBody(input);
  const res = await call('PATCH', eventUrl(providerEventId), token, body);
  return readCopyRef(res.json, calendarId);
}

/** Review M1: the copy carrying `copyId` in `calendarId`, or null. */
export async function findMicrosoftEventByCopyId(
  token: string,
  calendarId: string,
  copyId: string,
): Promise<CopyRef | null> {
  const res = await call(
    'GET',
    buildCopyIdLookupUrl(calendarId, copyId),
    token,
  );
  const value = asRecord(res.json).value;
  if (!Array.isArray(value)) throw new TransientError('malformed_response');
  const first: unknown = value[0];
  return first === undefined ? null : readCopyRef(first, calendarId);
}

/** `DELETE /me/events/{id}` — NotFoundError on 404/410 (adapter: ok). */
export async function deleteMicrosoftEvent(
  token: string,
  providerEventId: string,
): Promise<void> {
  await call('DELETE', eventUrl(providerEventId), token);
}

/** A created / patched event → `{calendarId, providerEventId, etag?}`. */
export function readCopyRef(json: unknown, calendarId: string): CopyRef {
  const record = asRecord(json);
  const id = readId(record);
  const etag = record['@odata.etag'];
  const ref: CopyRef = { calendarId, providerEventId: id };
  if (typeof etag === 'string' && etag) ref.etag = etag;
  return ref;
}

function isNameConflict(res: MicrosoftHttpResponse): boolean {
  return res.status === 409 || graphErrorCode(res.json) === GRAPH_FOLDER_EXISTS;
}

function send(
  method: MicrosoftJsonMethod,
  url: string,
  token: string,
  body?: unknown,
): Promise<MicrosoftHttpResponse> {
  return graphRequest(method, url, token, body, {
    prefer: MICROSOFT_WRITE_PREFER,
  });
}

async function call(
  method: MicrosoftJsonMethod,
  url: string,
  token: string,
  body?: unknown,
): Promise<MicrosoftHttpResponse> {
  const res = await send(method, url, token, body);
  assertGraphOk(res, 'write');
  return res;
}

function readId(json: unknown): string {
  const id = asRecord(json).id;
  if (typeof id !== 'string' || !id) {
    throw new TransientError('malformed_response');
  }
  return id;
}

/** OData string literal: a single quote is doubled. */
function odata(value: string): string {
  return value.replace(/'/g, "''");
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(Object.entries(value));
}
