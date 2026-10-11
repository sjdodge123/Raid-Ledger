/**
 * ROK-1596 D1/D5 (epic ROK-669 §4.5.2): reconcile ONE (connection, event,
 * user) copy against what should exist. Never replays the triggering event —
 * it reads the rows, asks `computeDesiredState`, then creates / updates /
 * deletes the copy and its `calendar_event_links` row.
 *
 * Failures: `ProviderAuthError` → connection `needs_reconnect` + link
 * `failed`, no retry (the nightly reconcile re-enqueues after reconnect).
 * `ProviderRequestError` (a permanent 4xx) and an unrecoverable
 * `NotFoundError` → link `failed`, no retry. Anything else (rate limit,
 * transient, unknown) is rethrown so BullMQ retries with backoff.
 */
import { Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import {
  CalendarProviderError,
  NotFoundError,
  ProviderAuthError,
  ProviderRequestError,
} from '../providers/calendar-provider.errors';
import type {
  CalendarCredentials,
  CopyEventInput,
  CopyRef,
} from '../providers/calendar-provider.interface';
import type {
  CalendarProviderRegistry,
  CalendarWriteProvider,
} from '../providers/calendar-provider.registry';
import { withFreshCredentials } from '../services/calendar-credentials.helpers';
import {
  buildCopyInput,
  type CopyEventRow,
  loadCopyEvent,
  loadSignupStatus,
} from './calendar-write-copy.helpers';
import {
  computeDesiredState,
  type DesiredState,
} from './calendar-write-desired.helpers';

type Db = PostgresJsDatabase<typeof schema>;
type ConnectionRow = typeof schema.calendarConnections.$inferSelect;
type LinkRow = typeof schema.calendarEventLinks.$inferSelect;

/** The provider calendar id of the user's main calendar (`write_target`). */
export const PRIMARY_CALENDAR_ID = 'primary';

export interface ReconcileKey {
  connectionId: number;
  eventId: number;
  userId: number;
}

export interface CalendarReconcileDeps {
  db: Db;
  registry: Pick<CalendarProviderRegistry, 'getWriteProviderForConnection'>;
  isSyncEnabled: () => Promise<boolean>;
  getClientUrl: () => Promise<string>;
  now?: () => Date;
}

export type ReconcileOutcome =
  | { result: 'noop'; reason: string }
  | { result: 'created' | 'updated' | 'deleted' }
  | { result: 'failed'; reason: string };

interface WriteCtx {
  db: Db;
  conn: ConnectionRow;
  provider: CalendarWriteProvider;
  creds: CalendarCredentials;
  key: ReconcileKey;
  link: LinkRow | null;
}

const logger = new Logger('CalendarWriteReconcile');

const refOf = (link: LinkRow): CopyRef => ({
  calendarId: link.calendarId,
  providerEventId: link.providerEventId,
  ...(link.etag ? { etag: link.etag } : {}),
});

/** Log-safe, column-sized code: never an error message (may echo a body). */
function errorCode(err: unknown): string {
  if (err instanceof CalendarProviderError)
    return `${err.code}:${err.reason}`.slice(0, 64);
  return err instanceof Error ? err.name.slice(0, 64) : 'unknown';
}

async function loadConnection(db: Db, id: number) {
  const [row] = await db
    .select()
    .from(schema.calendarConnections)
    .where(eq(schema.calendarConnections.id, id))
    .limit(1);
  return row ?? null;
}

async function loadLink(db: Db, key: ReconcileKey) {
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
    )
    .limit(1);
  return row ?? null;
}

/** D5: the target calendar id; persists a changed dedicated calendar id. */
async function resolveTarget(
  ctx: WriteCtx,
  knownId: string | null,
): Promise<string> {
  if (ctx.conn.writeTarget === 'primary') return PRIMARY_CALENDAR_ID;
  const id = await ctx.provider.ensureRaidLedgerCalendar(ctx.creds, knownId);
  if (id !== ctx.conn.dedicatedCalendarId) {
    await ctx.db
      .update(schema.calendarConnections)
      .set({ dedicatedCalendarId: id, updatedAt: new Date() })
      .where(eq(schema.calendarConnections.id, ctx.conn.id));
    ctx.conn = { ...ctx.conn, dedicatedCalendarId: id };
  }
  return id;
}

/** `upsertEvent`, with a 404/410 (copy or calendar gone) mapped to null. */
async function upsertOrNull(
  ctx: WriteCtx,
  calendarId: string,
  input: CopyEventInput,
  existing: CopyRef | null,
): Promise<CopyRef | null> {
  try {
    return await ctx.provider.upsertEvent(
      ctx.creds,
      calendarId,
      input,
      existing,
    );
  } catch (err) {
    if (err instanceof NotFoundError) return null;
    throw err;
  }
}

/** §4.5.2.3/.4/.6: create, update in place, move on a target flip, heal. */
async function writeCopy(ctx: WriteCtx, input: CopyEventInput) {
  const calendarId = await resolveTarget(ctx, ctx.conn.dedicatedCalendarId);
  const moved = ctx.link !== null && ctx.link.calendarId !== calendarId;
  if (ctx.link && moved)
    await ctx.provider.deleteEvent(ctx.creds, refOf(ctx.link));
  const existing = ctx.link && !moved ? refOf(ctx.link) : null;
  const first = await upsertOrNull(ctx, calendarId, input, existing);
  if (first) return first;
  // The copy was deleted remotely → recreate it in the same calendar.
  const again = existing
    ? await upsertOrNull(ctx, calendarId, input, null)
    : null;
  if (again) return again;
  if (ctx.conn.writeTarget !== 'dedicated')
    throw new NotFoundError('calendar_not_found');
  // The dedicated calendar itself is gone → make a new one, once.
  const fresh = await resolveTarget(ctx, null);
  return ctx.provider.upsertEvent(ctx.creds, fresh, input, null);
}

async function saveLink(db: Db, key: ReconcileKey, ref: CopyRef) {
  const t = schema.calendarEventLinks;
  const fields = {
    calendarId: ref.calendarId,
    providerEventId: ref.providerEventId,
    etag: ref.etag ?? null,
    state: 'synced',
    lastErrorCode: null,
    updatedAt: new Date(),
  };
  await db
    .insert(t)
    .values({
      connectionId: key.connectionId,
      eventId: key.eventId,
      userId: key.userId,
      ...fields,
    })
    .onConflictDoUpdate({
      target: [t.connectionId, t.eventId, t.userId],
      set: fields,
    });
}

async function apply(
  ctx: WriteCtx,
  desired: DesiredState,
  event: CopyEventRow | null,
  clientUrl: () => Promise<string>,
): Promise<ReconcileOutcome> {
  if (desired.action === 'delete') {
    if (ctx.link) {
      await ctx.provider.deleteEvent(ctx.creds, refOf(ctx.link));
      await ctx.db
        .delete(schema.calendarEventLinks)
        .where(eq(schema.calendarEventLinks.id, ctx.link.id));
    }
    return { result: 'deleted' };
  }
  if (!event || !desired.copy) throw new Error('create/update without event');
  const input = buildCopyInput({
    clientUrl: await clientUrl(),
    eventId: ctx.key.eventId,
    userId: ctx.key.userId,
    event,
    tentative: desired.copy.tentative,
  });
  await saveLink(ctx.db, ctx.key, await writeCopy(ctx, input));
  return { result: ctx.link ? 'updated' : 'created' };
}

/** Terminal failures are recorded and swallowed; the rest are retried. */
async function handleFailure(
  db: Db,
  connectionId: number,
  link: LinkRow | null,
  err: unknown,
): Promise<ReconcileOutcome> {
  const auth = err instanceof ProviderAuthError;
  const terminal =
    auth || err instanceof ProviderRequestError || err instanceof NotFoundError;
  if (!terminal) throw err;
  const code = errorCode(err);
  const now = new Date();
  if (auth) {
    await db
      .update(schema.calendarConnections)
      .set({ status: 'needs_reconnect', lastErrorCode: code, updatedAt: now })
      .where(eq(schema.calendarConnections.id, connectionId));
  }
  if (link) {
    await db
      .update(schema.calendarEventLinks)
      .set({ state: 'failed', lastErrorCode: code, updatedAt: now })
      .where(eq(schema.calendarEventLinks.id, link.id));
  }
  logger.warn(`calendar copy failed for connection ${connectionId} (${code})`);
  return { result: 'failed', reason: code };
}

/** Load the rows and decide (D2). */
async function decide(
  deps: CalendarReconcileDeps,
  key: ReconcileKey,
  conn: ConnectionRow,
) {
  const [event, signupStatus, link, killSwitchOn] = await Promise.all([
    loadCopyEvent(deps.db, key.eventId),
    loadSignupStatus(deps.db, key.eventId, key.userId),
    loadLink(deps.db, key),
    deps.isSyncEnabled(),
  ]);
  const desired = computeDesiredState({
    connection: { status: conn.status, writeEnabled: conn.writeEnabled },
    killSwitchOn,
    event: event && { ...event, endsAt: event.end },
    signupStatus,
    link,
    now: deps.now?.() ?? new Date(),
  });
  return { desired, event, link };
}

export async function reconcileCalendarCopy(
  deps: CalendarReconcileDeps,
  key: ReconcileKey,
): Promise<ReconcileOutcome> {
  const conn = await loadConnection(deps.db, key.connectionId);
  if (!conn || conn.userId !== key.userId)
    return { result: 'noop', reason: 'connection_missing' };
  const { desired, event, link } = await decide(deps, key, conn);
  if (desired.action === 'noop')
    return { result: 'noop', reason: desired.reason };
  const provider = await deps.registry.getWriteProviderForConnection(conn);
  if (!provider) return { result: 'noop', reason: 'no_write_provider' };
  const ctx = { db: deps.db, conn, provider, key, link };
  try {
    return await withFreshCredentials(deps.db, conn, provider, (creds) =>
      apply({ ...ctx, creds }, desired, event, deps.getClientUrl),
    );
  } catch (err) {
    return handleFailure(deps.db, conn.id, link, err);
  }
}
