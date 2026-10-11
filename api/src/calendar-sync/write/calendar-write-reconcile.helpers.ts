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
 * transient, unknown) is rethrown so BullMQ retries with backoff; the final
 * attempt also records `failed` + reports to Sentry. Races (review B1/M2):
 * see `calendar-write-reconcile-persist.helpers.ts`.
 */
import { Logger } from '@nestjs/common';
import { and, eq, ne } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { NotFoundError } from '../providers/calendar-provider.errors';
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
  loadSignupBenched,
  loadSignupStatus,
} from './calendar-write-copy.helpers';
import {
  computeDesiredState,
  type DesiredState,
} from './calendar-write-desired.helpers';
import {
  claimDedicatedCalendar,
  DedicatedTargetGoneError,
  errorCode,
  handleFailure,
  saveLink,
} from './calendar-write-reconcile-persist.helpers';

export { errorCode };

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

/** Best-effort cleanup of something this run created but must not keep. */
async function bestEffort(what: string, op: () => Promise<void>) {
  try {
    await op();
  } catch (err) {
    logger.warn(`calendar ${what} cleanup failed (${errorCode(err)})`);
  }
}

/**
 * D5: the target calendar id. A changed dedicated calendar id is claimed by
 * compare-and-swap (B1); on a lost race the calendar this run just created
 * is deleted and the winner's id used.
 */
async function resolveTarget(
  ctx: WriteCtx,
  knownId: string | null,
): Promise<string> {
  if (ctx.conn.writeTarget === 'primary') return PRIMARY_CALENDAR_ID;
  const id = await ctx.provider.ensureRaidLedgerCalendar(ctx.creds, knownId);
  const current = ctx.conn.dedicatedCalendarId;
  if (id === current) return id;
  const winner = await claimDedicatedCalendar(
    ctx.db,
    ctx.conn.id,
    current,
    id,
  ).catch(async (err: unknown) => {
    if (err instanceof DedicatedTargetGoneError)
      await bestEffort('calendar', () =>
        ctx.provider.deleteRaidLedgerCalendar(ctx.creds, id),
      );
    throw err;
  });
  if (winner !== id)
    await bestEffort('calendar', () =>
      ctx.provider.deleteRaidLedgerCalendar(ctx.creds, id),
    );
  ctx.conn = { ...ctx.conn, dedicatedCalendarId: winner };
  return winner;
}

/** A link with a copy behind it ('' ids = an Undo/failed placeholder). */
const copyLink = (link: LinkRow | null) =>
  link && link.providerEventId ? link : null;

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
  const prior = copyLink(ctx.link);
  const moved = prior !== null && prior.calendarId !== calendarId;
  if (prior && moved) await ctx.provider.deleteEvent(ctx.creds, refOf(prior));
  const existing = prior && !moved ? refOf(prior) : null;
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

/** Delete the copy and its link — a link suppressed meanwhile is kept. */
async function applyDelete(ctx: WriteCtx): Promise<ReconcileOutcome> {
  const prior = copyLink(ctx.link);
  if (prior) await ctx.provider.deleteEvent(ctx.creds, refOf(prior));
  if (ctx.link) {
    const t = schema.calendarEventLinks;
    await ctx.db
      .delete(t)
      .where(and(eq(t.id, ctx.link.id), ne(t.state, 'suppressed')));
  }
  return { result: 'deleted' };
}

async function apply(
  ctx: WriteCtx,
  desired: DesiredState,
  event: CopyEventRow | null,
  clientUrl: () => Promise<string>,
): Promise<ReconcileOutcome> {
  if (desired.action === 'delete') return applyDelete(ctx);
  if (!event || !desired.copy) throw new Error('create/update without event');
  const input = buildCopyInput({
    clientUrl: await clientUrl(),
    eventId: ctx.key.eventId,
    userId: ctx.key.userId,
    event,
    tentative: desired.copy.tentative,
    benched: desired.copy.benched,
  });
  const ref = await writeCopy(ctx, input);
  if (!(await saveLink(ctx.db, ctx.key, ref))) {
    // M2: Undo suppressed the link mid-flight — honour it, drop the copy.
    await bestEffort('copy', () => ctx.provider.deleteEvent(ctx.creds, ref));
    return { result: 'noop', reason: 'suppressed' };
  }
  return { result: ctx.link ? 'updated' : 'created' };
}

/** Load the rows and decide (D2). */
async function decide(
  deps: CalendarReconcileDeps,
  key: ReconcileKey,
  conn: ConnectionRow,
) {
  const [event, signupStatus, benched, link, killSwitchOn] = await Promise.all([
    loadCopyEvent(deps.db, key.eventId),
    loadSignupStatus(deps.db, key.eventId, key.userId),
    loadSignupBenched(deps.db, key.eventId, key.userId),
    loadLink(deps.db, key),
    deps.isSyncEnabled(),
  ]);
  const desired = computeDesiredState({
    connection: { status: conn.status, writeEnabled: conn.writeEnabled },
    killSwitchOn,
    event: event && { ...event, endsAt: event.end },
    signupStatus,
    benched,
    link,
    now: deps.now?.() ?? new Date(),
  });
  return { desired, event, link };
}

export interface ReconcileOptions {
  /** The job's last attempt: a retryable error is recorded too (m4). */
  finalAttempt?: boolean;
}

export async function reconcileCalendarCopy(
  deps: CalendarReconcileDeps,
  key: ReconcileKey,
  opts: ReconcileOptions = {},
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
    // Connection deleted / sending off mid-run: nothing to record, no retry.
    if (err instanceof DedicatedTargetGoneError)
      return { result: 'noop', reason: err.reason };
    return handleFailure(deps.db, key, err, opts.finalAttempt ?? false);
  }
}
