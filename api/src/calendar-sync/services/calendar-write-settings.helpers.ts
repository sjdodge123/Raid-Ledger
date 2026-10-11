/**
 * ROK-1596 D6: `PATCH /users/me/calendars/:id` — the send-my-events settings.
 *
 * This story accepts the `write` block only; a `read` key answers 400
 * `read_not_available` until ROK-1593. Validation runs BEFORE anything is
 * persisted:
 * - write on while another of the user's connections already sends → 409
 *   `write_already_enabled` (Q15 / F6: one destination at a time);
 * - target `primary` on a grant without `calendar.events` → 409
 *   `needs_consent` (the web then starts OAuth with `intent=primary`, D8).
 *
 * Then the row is updated and the queue does the remote work: enable → one
 * `reconcile` per active upcoming sign-up; disable → one `write-off`; a target
 * flip while sending → one `reconcile` per linked event ∪ active sign-up (the
 * emptied dedicated calendar is kept, F9). The 409 codes travel in the error
 * MESSAGE — the web client reads only `message` (handover W1).
 */
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, ne } from 'drizzle-orm';
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

type Db = PostgresJsDatabase<typeof schema>;
type ConnectionRow = typeof schema.calendarConnections.$inferSelect;

export interface CalendarWriteSettingsDeps extends CalendarWriteEnqueueDeps {
  db: Db;
}

export interface CalendarWriteSettingsInput {
  userId: number;
  connectionId: number;
  body: unknown;
}

interface NextWrite {
  enabled: boolean;
  target: CalendarWriteTarget;
}

/** Validate, persist and enqueue one write-settings change. */
export async function updateCalendarWriteSettings(
  deps: CalendarWriteSettingsDeps,
  input: CalendarWriteSettingsInput,
): Promise<void> {
  const write = parseWriteBody(input.body);
  const row = await loadOwnConnection(deps.db, input);
  if (!write) return;
  const next: NextWrite = {
    enabled: write.enabled ?? row.writeEnabled,
    target: write.target ?? (row.writeTarget as CalendarWriteTarget),
  };
  if (next.enabled) await assertNoOtherWriteConnection(deps.db, row);
  if (next.target === 'primary' && row.writeTarget !== 'primary') {
    assertEventsScope(row);
  }
  await deps.db
    .update(schema.calendarConnections)
    .set({
      writeEnabled: next.enabled,
      writeTarget: next.target,
      updatedAt: new Date(),
    })
    .where(eq(schema.calendarConnections.id, row.id));
  await enqueueFollowUp(deps, row, next);
}

/** 400 on a malformed body or any `read` key; the `write` block or null. */
function parseWriteBody(body: unknown) {
  const parsed = UpdateCalendarConnectionSchema.safeParse(body ?? {});
  if (!parsed.success) throw new BadRequestException('invalid_body');
  if (parsed.data.read !== undefined) {
    throw new BadRequestException('read_not_available');
  }
  return parsed.data.write ?? null;
}

/** The caller's own row; anything else (incl. another user's id) → 404. */
async function loadOwnConnection(
  db: Db,
  input: CalendarWriteSettingsInput,
): Promise<ConnectionRow> {
  const t = schema.calendarConnections;
  const [row] = await db
    .select()
    .from(t)
    .where(and(eq(t.id, input.connectionId), eq(t.userId, input.userId)))
    .limit(1);
  if (!row || row.status === 'disconnecting') throw new NotFoundException();
  return row;
}

/** Q15 / F6: write on at most one of a user's connections. */
async function assertNoOtherWriteConnection(
  db: Db,
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
