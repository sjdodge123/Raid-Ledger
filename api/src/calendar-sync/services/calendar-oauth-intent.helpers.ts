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
 *
 * Review m4: a `primary` grant for a DIFFERENT account than the one sending
 * (the user picked another Google account) never flips that row while
 * another of the user's connections has write on — it is stored as a plain
 * connect, so there is never a second primary-target row beside the writer.
 * Review m1: a `connect` grant without the events scope on a row whose
 * target is `primary` (reconnect after a Google-side revoke) falls back to
 * `dedicated`, so the row does not loop on `needs_reconnect`.
 */
import { BadRequestException } from '@nestjs/common';
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  CalendarOAuthIntentSchema,
  type CalendarOAuthIntent,
} from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import type { CalendarProviderKey } from '../providers/calendar-provider.interface';
import { hasGoogleEventsScope } from '../providers/google/google-oauth.helpers';
import {
  applyReadConsent,
  grantAllowsRead,
} from './calendar-read-consent.helpers';
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
  if (intent === 'read') return grantAllowsRead(provider, grantedScopes);
  if (intent !== 'primary') return true;
  return provider === 'google' && hasGoogleEventsScope(grantedScopes);
}

export interface ApplyConsentIntentInput {
  intent: CalendarOAuthIntent;
  connectionId: number;
  userId: number;
  provider: CalendarProviderKey;
  /** The scopes on the grant just stored. */
  grantedScopes: readonly string[];
  /** The write queue. The callback has already checked the kill switch. */
  queue: CalendarWriteQueue;
}

export type ConsentIntentOutcome =
  'none' | 'primary' | 'other_account' | 'fell_back' | 'read';

/**
 * After a stored grant: `primary` flips the target (m4 guard); `connect`
 * without the events scope demotes a `primary` target (m1). A changed target
 * on a sending row queues a reconcile per affected event.
 */
export async function applyConsentIntent(
  db: Db,
  input: ApplyConsentIntentInput,
): Promise<ConsentIntentOutcome> {
  // ROK-1593 §1.1: read is its own branch — never the m1 write fall-back.
  if (input.intent === 'read') return applyReadConsent(db, input.connectionId);
  const conn = schema.calendarConnections;
  const { connectionId, userId } = input;
  let target: CalendarWriteTargetValue;
  let outcome: ConsentIntentOutcome;
  if (input.intent === 'primary') {
    if (await otherWriterExists(db, userId, connectionId)) {
      return 'other_account';
    }
    [target, outcome] = ['primary', 'primary'];
  } else {
    if (grantCoversIntent('primary', input.provider, input.grantedScopes)) {
      return 'none';
    }
    [target, outcome] = ['dedicated', 'fell_back'];
  }
  const [row] = await db
    .update(conn)
    .set({ writeTarget: target, updatedAt: new Date() })
    .where(and(eq(conn.id, connectionId), ne(conn.writeTarget, target)))
    .returning({ writeEnabled: conn.writeEnabled });
  if (!row) return outcome === 'fell_back' ? 'none' : outcome;
  if (row.writeEnabled) await queueReconciles(db, input);
  return outcome;
}

type CalendarWriteTargetValue = 'primary' | 'dedicated';

/** Another of the user's live connections has write on. */
async function otherWriterExists(
  db: Db,
  userId: number,
  connectionId: number,
): Promise<boolean> {
  const conn = schema.calendarConnections;
  const [other] = await db
    .select({ id: conn.id })
    .from(conn)
    .where(
      and(
        eq(conn.userId, userId),
        ne(conn.id, connectionId),
        eq(conn.writeEnabled, true),
        ne(conn.status, 'disconnecting'),
      ),
    )
    .limit(1);
  return !!other;
}

async function queueReconciles(
  db: Db,
  input: ApplyConsentIntentInput,
): Promise<void> {
  const { connectionId, userId } = input;
  const deps = {
    queue: input.queue,
    isSyncEnabled: () => Promise.resolve(true),
  };
  for (const eventId of await affectedEventIds(db, connectionId, userId)) {
    const job = { kind: 'reconcile' as const, connectionId, eventId, userId };
    await enqueueCalendarWriteJob(deps, job);
  }
}

/** Every linked event plus every active, upcoming sign-up of the user. */
export async function affectedEventIds(
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
