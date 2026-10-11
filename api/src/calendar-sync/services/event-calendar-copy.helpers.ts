/**
 * ROK-1596 D9: the viewer's own calendar copy of one event.
 *
 * - `getEventCalendarCopy` → null when the user has no write connection (or
 *   none of theirs is usable); `pending` when sending is on, the sign-up is
 *   active and no link exists yet; otherwise the link's state.
 * - `undoEventCalendarCopy` (Q4) suppresses that ONE copy: best-effort remote
 *   delete in the request, then link `state='suppressed'` — reconcile treats a
 *   suppressed link as `noop` forever. The sign-up is never touched. Works
 *   before the copy exists (placeholder suppressed link, Lead ruling).
 * - `googleOpenUrl` (F4, UNVERIFIED): Google's `eid` is
 *   base64url(`<eventId> <calendarId>`); `primary` is not a real calendar id,
 *   so it is replaced by the account email (null when unknown).
 */
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { EventCalendarCopy } from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import type { CalendarProviderRegistry } from '../providers/calendar-provider.registry';
import { withFreshCredentials } from './calendar-credentials.helpers';
import {
  loadCopyEvent,
  loadSignupStatus,
} from '../write/calendar-write-copy.helpers';
import { PRIMARY_CALENDAR_ID } from '../write/calendar-write-reconcile.helpers';

type Db = PostgresJsDatabase<typeof schema>;
type ConnectionRow = typeof schema.calendarConnections.$inferSelect;
type LinkRow = typeof schema.calendarEventLinks.$inferSelect;

const ACTIVE_STATUSES = new Set(['signed_up', 'tentative']);
const GOOGLE_EVENT_URL = 'https://www.google.com/calendar/event?eid=';

/** F4: the "Open" link for a Google copy, or null when it cannot be built. */
export function googleOpenUrl(
  link: Pick<LinkRow, 'providerEventId' | 'calendarId'>,
  accountEmail: string | null,
): string | null {
  const calendar =
    link.calendarId === PRIMARY_CALENDAR_ID ? accountEmail : link.calendarId;
  if (!calendar || !link.providerEventId) return null;
  const eid = Buffer.from(
    `${link.providerEventId} ${calendar}`,
    'utf8',
  ).toString('base64url');
  return `${GOOGLE_EVENT_URL}${eid}`;
}

function openUrlFor(conn: ConnectionRow, link: LinkRow): string | null {
  if (conn.provider !== 'google') return null;
  return googleOpenUrl(link, conn.accountLabel);
}

/**
 * The user's write-enabled connection (Q15: at most one), else null. A
 * deterministic order in case two slipped through: an `active` one first,
 * then the newest.
 */
async function findWriteConnection(
  db: Db,
  userId: number,
): Promise<ConnectionRow | null> {
  const t = schema.calendarConnections;
  const [row] = await db
    .select()
    .from(t)
    .where(
      and(
        eq(t.userId, userId),
        eq(t.writeEnabled, true),
        ne(t.status, 'disconnecting'),
      ),
    )
    .orderBy(sql`(${t.status} = 'active') desc`, desc(t.id))
    .limit(1);
  return row ?? null;
}

async function findLink(
  db: Db,
  key: { connectionId: number; eventId: number; userId: number },
): Promise<LinkRow | null> {
  const t = schema.calendarEventLinks;
  const [row] = await db
    .select()
    .from(t)
    .where(
      and(
        eq(t.connectionId, key.connectionId),
        eq(t.eventId, key.eventId),
        eq(t.userId, key.userId),
      ),
    );
  return row ?? null;
}

/** Would reconcile create a copy for this sign-up right now? */
async function wantsCopy(
  db: Db,
  eventId: number,
  userId: number,
  now: Date,
): Promise<boolean> {
  const event = await loadCopyEvent(db, eventId);
  if (!event || event.cancelled || event.end <= now) return false;
  const status = await loadSignupStatus(db, eventId, userId);
  return status !== null && ACTIVE_STATUSES.has(status);
}

/** `GET /users/me/calendars/events/:eventId` (D9). */
export async function getEventCalendarCopy(
  db: Db,
  userId: number,
  eventId: number,
  now: Date = new Date(),
): Promise<EventCalendarCopy | null> {
  const conn = await findWriteConnection(db, userId);
  if (!conn) return null;
  const provider = conn.provider as EventCalendarCopy['provider'];
  const link = await findLink(db, { connectionId: conn.id, eventId, userId });
  if (link) {
    const state = link.state as EventCalendarCopy['state'];
    const openUrl = state === 'synced' ? openUrlFor(conn, link) : null;
    return { provider, state, openUrl };
  }
  if (!(await wantsCopy(db, eventId, userId, now))) return null;
  return { provider, state: 'pending', openUrl: null };
}

type UndoDeps = {
  db: Db;
  registry: Pick<CalendarProviderRegistry, 'getWriteProviderForConnection'>;
  onRemoteError?: (err: unknown) => void;
};

/**
 * `POST …/events/:eventId/undo` (Q4). Existing links: delete the remote copy
 * (best-effort) and suppress. No link yet (Lead ruling: the sign-up toast's
 * Undo fires before the 5s-debounced job ran): an active sign-up + a write
 * connection → insert a PLACEHOLDER suppressed link (`calendar_id` and
 * `provider_event_id` = '' — no remote copy exists), so the queued reconcile
 * becomes a noop. false → nothing to undo (404).
 */
export async function undoEventCalendarCopy(
  deps: UndoDeps,
  userId: number,
  eventId: number,
): Promise<boolean> {
  if (await suppressExistingLinks(deps, userId, eventId)) return true;
  const conn = await findWriteConnection(deps.db, userId);
  if (!conn) return false;
  const status = await loadSignupStatus(deps.db, eventId, userId);
  if (status === null || !ACTIVE_STATUSES.has(status)) return false;
  const inserted = await deps.db
    .insert(schema.calendarEventLinks)
    .values({
      connectionId: conn.id,
      userId,
      eventId,
      calendarId: '',
      providerEventId: '',
      state: 'suppressed',
    })
    .onConflictDoNothing()
    .returning({ id: schema.calendarEventLinks.id });
  // Lost a race with the reconcile job: a real link exists now — suppress it.
  if (inserted.length === 0) await suppressExistingLinks(deps, userId, eventId);
  return true;
}

/** Suppress every link of (user, event); false when there are none. */
async function suppressExistingLinks(
  deps: UndoDeps,
  userId: number,
  eventId: number,
): Promise<boolean> {
  const l = schema.calendarEventLinks;
  const links = await deps.db
    .select({ link: l, conn: schema.calendarConnections })
    .from(l)
    .innerJoin(
      schema.calendarConnections,
      eq(schema.calendarConnections.id, l.connectionId),
    )
    .where(and(eq(l.userId, userId), eq(l.eventId, eventId)));
  for (const { link, conn } of links) {
    if (link.state === 'suppressed') continue;
    await deleteCopyBestEffort(deps, conn, link);
    await deps.db
      .update(l)
      .set({ state: 'suppressed', updatedAt: new Date() })
      .where(eq(l.id, link.id));
  }
  return links.length > 0;
}

/** Any failure is swallowed: suppression must land even if Google is down. */
async function deleteCopyBestEffort(
  deps: UndoDeps,
  conn: ConnectionRow,
  link: LinkRow,
): Promise<void> {
  const { calendarId, providerEventId } = link;
  if (!providerEventId) return; // a placeholder: no remote copy (review m3)
  try {
    const provider = await deps.registry.getWriteProviderForConnection(conn);
    if (!provider) return;
    await withFreshCredentials(deps.db, conn, provider, (creds) =>
      provider.deleteEvent(creds, { calendarId, providerEventId }),
    );
  } catch (err) {
    deps.onRemoteError?.(err);
  }
}
