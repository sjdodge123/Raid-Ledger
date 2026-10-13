/**
 * ROK-1593 D-R3: the `intent=read` consent, kept apart from the connect /
 * primary branches of `applyConsentIntent` on purpose (spec §1.1): a read
 * grant NEVER touches `write_target` / `write_enabled` /
 * `dedicated_calendar_id`, even when it lacks `calendar.events`.
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { CalendarOAuthIntent } from '@raid-ledger/contract';
import type { CalendarProviderKey } from '../providers/calendar-provider.interface';
import { hasGoogleReadScopes } from '../providers/google/google-oauth.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Whether a grant on `provider` carries the read scopes (Google-only today). */
export function grantAllowsRead(
  provider: CalendarProviderKey,
  grantedScopes: readonly string[],
): boolean {
  return provider === 'google' && hasGoogleReadScopes(grantedScopes);
}

/**
 * A covering read grant was just stored: turn the read sync on. Only the
 * two read flags and `updated_at` are written. Queueing the first sync is
 * the read pipeline's job (lane A6 wires it at the callback).
 */
export async function applyReadConsent(
  db: Db,
  connectionId: number,
): Promise<'read'> {
  const conn = schema.calendarConnections;
  await db
    .update(conn)
    .set({ readAccessGranted: true, readEnabled: true, updatedAt: new Date() })
    .where(eq(conn.id, connectionId));
  return 'read';
}

export interface FirstConnectReadInput {
  intent: CalendarOAuthIntent;
  /** The upsert inserted the row (first connect), not a reconnect. */
  created: boolean;
  connectionId: number;
  provider: CalendarProviderKey;
  grantedScopes: readonly string[];
}

/**
 * ROK-1595 G-3 (operator ruling Q-A): the connect consent now asks for the
 * read scopes, so a FIRST connect whose grant carries them turns read on
 * (`applyReadConsent`: read flags only, write settings never touched). A
 * reconnect keeps the user's read choice — the upsert has already
 * recomputed `read_access_granted` — and a grant without the read boxes
 * stays write-only. `intent=read` is `applyConsentIntent`'s own branch.
 * Answers whether read was turned on (the caller queues the first sync).
 */
export async function applyFirstConnectRead(
  db: Db,
  input: FirstConnectReadInput,
): Promise<boolean> {
  if (input.intent === 'read' || !input.created) return false;
  if (!grantAllowsRead(input.provider, input.grantedScopes)) return false;
  await applyReadConsent(db, input.connectionId);
  return true;
}
