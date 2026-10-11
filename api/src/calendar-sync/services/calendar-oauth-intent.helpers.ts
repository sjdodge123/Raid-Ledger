/**
 * ROK-1596 D8: incremental consent for the primary-calendar send target.
 *
 * `GET …/oauth/:provider/start?intent=connect|primary` (default `connect`).
 * `primary` asks for the sensitive events scope (F13) on top of the connect
 * set. At the callback, a `primary` grant that still lacks it answers
 * `?error=scopes` with the row unchanged and NO revoke — the existing grant
 * stays valid (mirrors ROK-1593 D17). A grant that has it switches the
 * connection to `write_target='primary'` and queues a reconcile per affected
 * event so existing copies move.
 */
import { BadRequestException } from '@nestjs/common';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  CalendarOAuthIntentSchema,
  type CalendarOAuthIntent,
} from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import type { CalendarProviderKey } from '../providers/calendar-provider.interface';
import { hasGoogleEventsScope } from '../providers/google/google-oauth.helpers';
import {
  enqueueCalendarWriteJob,
  type CalendarWriteQueue,
} from '../write/calendar-write.enqueue.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Sign-up statuses that keep a copy on the calendar (D2). */
const ACTIVE_SIGNUP_STATUSES = ['signed_up', 'tentative'];

/** `?intent=` → the intent; absent = `connect`, anything unknown = 400. */
export function parseOAuthIntentQuery(raw: unknown): CalendarOAuthIntent {
  const parsed = CalendarOAuthIntentSchema.safeParse(raw ?? 'connect');
  if (!parsed.success) throw new BadRequestException('invalid_intent');
  return parsed.data;
}

/** Whether a fresh grant satisfies the intent it was requested for. */
export function grantCoversIntent(
  intent: CalendarOAuthIntent,
  provider: CalendarProviderKey,
  grantedScopes: readonly string[],
): boolean {
  if (intent !== 'primary') return true;
  return provider === 'google' && hasGoogleEventsScope(grantedScopes);
}

export interface ApplyConsentIntentInput {
  intent: CalendarOAuthIntent;
  connectionId: number;
  userId: number;
  /** The write queue. The callback has already checked the kill switch. */
  queue: CalendarWriteQueue;
}

/** After a stored `primary` grant: flip the target and queue reconciles. */
export async function applyConsentIntent(
  db: Db,
  input: ApplyConsentIntentInput,
): Promise<void> {
  if (input.intent !== 'primary') return;
  const { connectionId, userId } = input;
  const deps = {
    queue: input.queue,
    isSyncEnabled: () => Promise.resolve(true),
  };
  const [row] = await db
    .update(schema.calendarConnections)
    .set({ writeTarget: 'primary', updatedAt: new Date() })
    .where(eq(schema.calendarConnections.id, connectionId))
    .returning({ writeEnabled: schema.calendarConnections.writeEnabled });
  if (!row?.writeEnabled) return;
  for (const eventId of await affectedEventIds(db, connectionId, userId)) {
    const job = { kind: 'reconcile' as const, connectionId, eventId, userId };
    await enqueueCalendarWriteJob(deps, job);
  }
}

/** Every linked event plus every active, upcoming sign-up of the user. */
async function affectedEventIds(
  db: Db,
  connectionId: number,
  userId: number,
): Promise<number[]> {
  const { calendarEventLinks: links, eventSignups: su, events } = schema;
  const linked = await db
    .select({ eventId: links.eventId })
    .from(links)
    .where(eq(links.connectionId, connectionId));
  const signedUp = await db
    .select({ eventId: su.eventId })
    .from(su)
    .innerJoin(events, eq(events.id, su.eventId))
    .where(
      and(
        eq(su.userId, userId),
        inArray(su.status, ACTIVE_SIGNUP_STATUSES),
        isNull(events.cancelledAt),
        sql`upper(${events.duration}) > ${new Date().toISOString()}::timestamp`,
      ),
    );
  return [...new Set([...linked, ...signedUp].map((r) => r.eventId))];
}
