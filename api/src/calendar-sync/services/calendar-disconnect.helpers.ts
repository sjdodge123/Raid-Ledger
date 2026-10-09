/**
 * ROK-1592 (plan L9, Q-D, Q-E): disconnect one of the caller's connections.
 *
 * In the request, awaited: load the row by `id AND user_id` (anything else
 * is "not found" → 404), mark it `disconnecting`, delete it (event links
 * cascade), then revoke best-effort with the credentials already loaded.
 * Shaped as the job body ROK-1596 queues.
 *
 * The revoke is SKIPPED while another row still has the same `(provider,
 * account_subject)`: two RL users may connect one Google account, and a
 * revoke would kill both grants (U8). Deleting BEFORE counting the remaining
 * rows makes two concurrent disconnects of one account safe: the last one to
 * delete always sees zero and revokes (a double revoke is harmless). A revoke
 * failure is logged with its error code only. Independent of the kill
 * switch (Lead ruling on Q-E): a user can always remove stored credentials.
 */
import { Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import { calendarConnections } from '../../drizzle/schema';
import { CalendarProviderError } from '../providers/calendar-provider.errors';
import type { CalendarProviderRegistry } from '../providers/calendar-provider.registry';
import { decryptCalendarCredentials } from './calendar-credentials.helpers';

type Db = PostgresJsDatabase<typeof schema>;

export type AccountProviderResolver = Pick<
  CalendarProviderRegistry,
  'getAccountProviderForConnection'
>;

export type CalendarRevokeOutcome =
  'revoked' | 'skipped_sibling' | 'skipped_no_provider' | 'failed';

export type CalendarDisconnectResult =
  { found: false } | { found: true; revoke: CalendarRevokeOutcome };

interface OwnRow {
  id: number;
  provider: string;
  accountSubject: string;
  credentialsEncrypted: string;
}

const logger = new Logger('CalendarDisconnect');

async function loadOwnRow(
  db: Db,
  userId: number,
  connectionId: number,
): Promise<OwnRow | null> {
  const [row] = await db
    .select({
      id: calendarConnections.id,
      provider: calendarConnections.provider,
      accountSubject: calendarConnections.accountSubject,
      credentialsEncrypted: calendarConnections.credentialsEncrypted,
    })
    .from(calendarConnections)
    .where(
      and(
        eq(calendarConnections.id, connectionId),
        eq(calendarConnections.userId, userId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Any row left with this account, AFTER the caller's row was deleted. */
async function accountStillHeld(db: Db, row: OwnRow): Promise<boolean> {
  const remaining = await db
    .select({ id: calendarConnections.id })
    .from(calendarConnections)
    .where(
      and(
        eq(calendarConnections.provider, row.provider),
        eq(calendarConnections.accountSubject, row.accountSubject),
      ),
    )
    .limit(1);
  return remaining.length > 0;
}

/** A log-safe code: never an error message, which may echo a response body. */
function errorCode(err: unknown): string {
  if (err instanceof CalendarProviderError) return `${err.code}:${err.reason}`;
  return err instanceof Error ? err.name : 'unknown';
}

async function revokeBestEffort(
  registry: AccountProviderResolver,
  row: OwnRow,
): Promise<CalendarRevokeOutcome> {
  try {
    const provider = await registry.getAccountProviderForConnection(row);
    if (!provider) return 'skipped_no_provider';
    await provider.disconnect(
      decryptCalendarCredentials(row.credentialsEncrypted),
    );
    return 'revoked';
  } catch (err) {
    logger.warn(
      `calendar revoke failed for connection ${row.id} (${errorCode(err)})`,
    );
    return 'failed';
  }
}

export async function runCalendarDisconnect(
  db: Db,
  registry: AccountProviderResolver,
  input: { userId: number; connectionId: number },
): Promise<CalendarDisconnectResult> {
  const row = await loadOwnRow(db, input.userId, input.connectionId);
  if (!row) return { found: false };
  await db
    .update(calendarConnections)
    .set({ status: 'disconnecting', updatedAt: new Date() })
    .where(eq(calendarConnections.id, row.id));
  await db
    .delete(calendarConnections)
    .where(
      and(
        eq(calendarConnections.id, row.id),
        eq(calendarConnections.userId, input.userId),
      ),
    );
  const revoke = (await accountStillHeld(db, row))
    ? 'skipped_sibling'
    : await revokeBestEffort(registry, row);
  return { found: true, revoke };
}
