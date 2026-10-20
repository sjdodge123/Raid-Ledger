/**
 * ROK-1598 (spec §2.6, D6): the write half of the Apple adapter — the
 * dedicated "Raid Ledger" calendar and the conditional PUT / DELETE of
 * copies.
 *
 * A copy lives at a deterministic resource name, so a retried create (lost
 * link row, review M1) lands on the same object and is adopted. The name is
 * salted with the calendar id: the shared write suite requires a copy with
 * the same rlCopyId in ANOTHER calendar to get a different `providerEventId`
 * (spec D6 hashes the copy id alone — divergence flagged by L3).
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  NotFoundError,
  ProviderRequestError,
  TransientError,
} from '../calendar-provider.errors';
import type { CopyRef } from '../calendar-provider.interface';
import type { CalDavAuth } from './apple-caldav-http';
import {
  deleteObject,
  getEtag,
  mkcalendar,
  putObject,
  type PutConditions,
} from './apple-caldav-client.helpers';
import type { CalDavCollection } from './apple-caldav-xml.helpers';
import { collectionUrl, isSafeSegment } from './apple-discovery.helpers';

/** Q8: the dedicated calendar's display name. */
export const RAID_LEDGER_CALENDAR_NAME = 'Raid Ledger';
export const RAID_LEDGER_CALENDAR_PREFIX = 'raid-ledger-';

/** D6: `rl-<32 hex>.ics`, stable per (calendar, copy id). */
export function copyResourceName(calendarId: string, copyId: string): string {
  const hex = createHash('sha256')
    .update(`${calendarId}\n${copyId}`)
    .digest('hex');
  return `rl-${hex.slice(0, 32)}.ics`;
}

/** The collection URL, or a permanent refusal for an unsafe id. */
export function mustCollectionUrl(home: string, calendarId: string): string {
  const url = collectionUrl(home, calendarId);
  if (!url) throw new ProviderRequestError('calendar_id');
  return url;
}

/** The object URL of `ref`; an unsafe resource name is refused. */
export function objectUrl(home: string, ref: CopyRef): string {
  if (!isSafeSegment(ref.providerEventId)) {
    throw new ProviderRequestError('event_id');
  }
  return new URL(ref.providerEventId, mustCollectionUrl(home, ref.calendarId))
    .href;
}

/** D6 + Q8: the known calendar when it still exists, else a new one. */
export async function ensureCalendar(
  auth: CalDavAuth,
  home: string,
  cols: CalDavCollection[],
  knownId: string | null,
): Promise<string> {
  if (knownId && cols.some((c) => c.id === knownId)) return knownId;
  const id = `${RAID_LEDGER_CALENDAR_PREFIX}${randomUUID()}`;
  try {
    await mkcalendar(
      auth,
      mustCollectionUrl(home, id),
      RAID_LEDGER_CALENDAR_NAME,
    );
  } catch (err) {
    if (err instanceof ProviderRequestError) {
      throw new ProviderRequestError('mkcalendar_refused');
    }
    throw err;
  }
  return id;
}

async function putOnce(
  auth: CalDavAuth,
  url: string,
  ics: string,
  cond: PutConditions,
): Promise<string | null | 'conflict'> {
  const res = await putObject(auth, url, ics, cond);
  if (res.status === 'precondition_failed') return 'conflict';
  return res.etag ?? (await getEtag(auth, url));
}

/**
 * D6: create = `If-None-Match: *`, update = `If-Match` (no etag →
 * unconditional). A 412 re-reads the etag and PUTs once more (adopt on
 * create, last-writer-wins on update); a second 412 is transient.
 */
export async function putCopy(
  auth: CalDavAuth,
  url: string,
  ics: string,
  existing: CopyRef | null,
): Promise<string | null> {
  const first: PutConditions = existing
    ? existing.etag
      ? { ifMatch: existing.etag }
      : {}
    : { ifNoneMatch: '*' };
  const etag = await putOnce(auth, url, ics, first);
  if (etag !== 'conflict') return etag;
  const current = await getEtag(auth, url);
  const retry = await putOnce(
    auth,
    url,
    ics,
    current ? { ifMatch: current } : {},
  );
  if (retry === 'conflict') throw new TransientError('etag_conflict');
  return retry;
}

/** DELETE `url`; gone counts as success. */
async function deleteIgnoringGone(
  auth: CalDavAuth,
  url: string,
  ifMatch?: string,
): Promise<'ok' | 'conflict'> {
  try {
    const res = await deleteObject(auth, url, ifMatch);
    return res.status === 'ok' ? 'ok' : 'conflict';
  } catch (err) {
    if (err instanceof NotFoundError) return 'ok';
    throw err;
  }
}

/** D6: `If-Match` delete; a 412 (user edited it) deletes once unconditionally. */
export async function deleteCopy(
  auth: CalDavAuth,
  url: string,
  etag: string | undefined,
): Promise<void> {
  const first = await deleteIgnoringGone(auth, url, etag);
  if (first === 'conflict') await deleteIgnoringGone(auth, url);
}

/** DELETE the dedicated collection; already gone → success. */
export async function deleteCalendar(
  auth: CalDavAuth,
  home: string,
  calendarId: string,
): Promise<void> {
  await deleteIgnoringGone(auth, mustCollectionUrl(home, calendarId));
}
