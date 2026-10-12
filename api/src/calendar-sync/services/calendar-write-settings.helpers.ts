/**
 * ROK-1596 D6: `PATCH /users/me/calendars/:id` — the send-my-events settings.
 *
 * ROK-1593 §1.4: a `read` block is delegated to
 * `calendar-read-settings.helpers.ts` (it replaced 1596's 400
 * `read_not_available`); it is validated before the write half persists and
 * applied after it. Validation runs BEFORE anything is persisted:
 * - write on while another of the user's connections already sends → 409
 *   `write_already_enabled` (Q15 / F6: one destination at a time);
 * - target `primary` on a grant without `calendar.events` → 409
 *   `needs_consent` (the web then starts OAuth with `intent=primary`, D8).
 *
 * The one-write check and the update run in ONE transaction holding
 * `pg_advisory_xact_lock(CALENDAR_WRITE_LOCK_CLASS, userId)`, so two
 * concurrent PATCHes cannot both turn write on (review m2, no migration).
 * The scope check runs whenever the result sends to primary, even when the
 * target is already primary (review m1: a reconnect may have lost the scope).
 *
 * Then the row is updated and the queue does the remote work: enable → one
 * `reconcile` per active upcoming sign-up; disable → one `write-off`; a target
 * flip while sending → one `reconcile` per linked event ∪ active sign-up (the
 * emptied dedicated calendar is kept, F9). The 409 codes travel in the error
 * MESSAGE — the web client reads only `message` (handover W1).
 */
import { BadRequestException, ConflictException } from '@nestjs/common';
import { and, eq, ne, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  UpdateCalendarConnectionSchema,
  type CalendarWriteTarget,
} from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import { hasGoogleEventsScope } from '../providers/google/google-oauth.helpers';
import {
  enqueueCalendarWriteJob,
  type CalendarWriteEnqueueDeps,
} from '../write/calendar-write.enqueue.helpers';
import { decryptCalendarCredentials } from './calendar-credentials.helpers';
import { affectedEventIds } from './calendar-oauth-intent.helpers';
import {
  applyReadUpdate,
  loadOwnCalendarConnection,
  planReadUpdate,
  type CalendarReadSettingsDeps,
} from './calendar-read-settings.helpers';

type Db = PostgresJsDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type ConnectionRow = typeof schema.calendarConnections.$inferSelect;

export interface CalendarWriteSettingsDeps extends CalendarWriteEnqueueDeps {
  db: Db;
  /** ROK-1593: the `read` block's dependencies. */
  read: CalendarReadSettingsDeps;
}

export interface CalendarWriteSettingsInput {
  userId: number;
  connectionId: number;
  body: unknown;
}

/** `pg_advisory_xact_lock(class, userId)` namespace: one-write rule. */
export const CALENDAR_WRITE_LOCK_CLASS = 1596;

interface NextWrite {
  enabled: boolean;
  target: CalendarWriteTarget;
}

/** The PATCH body's `write` block: either key may be absent. */
interface WriteBody {
  enabled?: boolean | undefined;
  target?: CalendarWriteTarget | undefined;
}

/** Validate, persist and enqueue one connection-settings change. */
export async function updateCalendarWriteSettings(
  deps: CalendarWriteSettingsDeps,
  input: CalendarWriteSettingsInput,
): Promise<void> {
  const { read, write } = parseSettingsBody(input.body);
  // Still 404s a foreign id when the body is empty.
  const own = await loadOwnConnection(deps.db, input);
  const readPlan = read ? planReadUpdate(own, read) : null;
  if (write) {
    const { row, next } = await persistWrite(deps.db, input, write);
    await enqueueFollowUp(deps, row, next);
  }
  if (readPlan) await applyReadUpdate(deps.read, readPlan);
}

/**
 * m2: check + write under a per-user advisory lock, one transaction. The row
 * is read INSIDE the lock (final review): a value read before it could be a
 * stale `writeEnabled` that a concurrent target-only PATCH writes back.
 */
async function persistWrite(
  db: Db,
  input: CalendarWriteSettingsInput,
  write: WriteBody,
): Promise<{ row: ConnectionRow; next: NextWrite }> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${CALENDAR_WRITE_LOCK_CLASS}::int4, ${input.userId}::int4)`,
    );
    const row = await loadOwnConnection(tx, input);
    const next = resolveNextWrite(row, write);
    if (next.enabled) await assertNoOtherWriteConnection(tx, row);
    await tx
      .update(schema.calendarConnections)
      .set({
        writeEnabled: next.enabled,
        writeTarget: next.target,
        updatedAt: new Date(),
      })
      .where(eq(schema.calendarConnections.id, row.id));
    return { row, next };
  });
}

/** The settings after the PATCH; 409 `needs_consent` if primary lacks scope. */
function resolveNextWrite(row: ConnectionRow, write: WriteBody): NextWrite {
  const next: NextWrite = {
    enabled: write.enabled ?? row.writeEnabled,
    target: write.target ?? (row.writeTarget as CalendarWriteTarget),
  };
  const flipsToPrimary = row.writeTarget !== 'primary';
  if (next.target === 'primary' && (next.enabled || flipsToPrimary)) {
    assertEventsScope(row);
  }
  return next;
}

/** 400 on a malformed body; the `read` / `write` blocks, either absent. */
function parseSettingsBody(body: unknown) {
  const parsed = UpdateCalendarConnectionSchema.safeParse(body ?? {});
  if (!parsed.success) throw new BadRequestException('invalid_body');
  return { read: parsed.data.read ?? null, write: parsed.data.write ?? null };
}

/** The caller's own row (shared with the read half); else 404. */
const loadOwnConnection = (db: Db | Tx, input: CalendarWriteSettingsInput) =>
  loadOwnCalendarConnection(db, input);

/** Q15 / F6: write on at most one of a user's connections. */
async function assertNoOtherWriteConnection(
  db: Db | Tx,
  row: ConnectionRow,
): Promise<void> {
  const t = schema.calendarConnections;
  const [other] = await db
    .select({ id: t.id })
    .from(t)
    .where(
      and(
        eq(t.userId, row.userId),
        ne(t.id, row.id),
        eq(t.writeEnabled, true),
        ne(t.status, 'disconnecting'),
      ),
    )
    .limit(1);
  if (other) throw new ConflictException('write_already_enabled');
}

/** D8: the primary target needs the sensitive events scope on the grant. */
function assertEventsScope(row: ConnectionRow): void {
  const creds = decryptCalendarCredentials(row.credentialsEncrypted);
  const granted =
    row.provider === 'google' &&
    creds.kind === 'oauth' &&
    hasGoogleEventsScope(creds.scopes);
  if (!granted) throw new ConflictException('needs_consent');
}

/** The remote work for the change, queued (kill switch: guard upstream). */
async function enqueueFollowUp(
  deps: CalendarWriteSettingsDeps,
  row: ConnectionRow,
  next: NextWrite,
): Promise<void> {
  const connectionId = row.id;
  if (!next.enabled) {
    if (row.writeEnabled) {
      await enqueueCalendarWriteJob(deps, { kind: 'write-off', connectionId });
    }
    return;
  }
  const flipped = row.writeEnabled && next.target !== row.writeTarget;
  if (row.writeEnabled && !flipped) return;
  const { userId } = row;
  for (const eventId of await affectedEventIds(deps.db, connectionId, userId)) {
    const job = { kind: 'reconcile' as const, connectionId, eventId, userId };
    await enqueueCalendarWriteJob(deps, job);
  }
}
