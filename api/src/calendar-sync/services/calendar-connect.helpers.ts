/**
 * ROK-1592 (plan L8): store a successful connect.
 *
 * One row per `(user_id, provider, account_subject)`; a second connect of the
 * same account updates it (`calendar_connections_user_provider_subject_uq`).
 * The update sets credentials, label, `status='active'`, clears
 * `last_error_code` and stamps `updated_at`. It never touches `read_*`,
 * `write_*` or `dedicated_calendar_id`, so a reconnect keeps the user's sync
 * settings. When the provider omits `refresh_token` on re-consent, the stored
 * one is kept (decrypt, merge, re-encrypt).
 */
import { Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import { calendarConnections } from '../../drizzle/schema';
import { ProviderAuthError } from '../providers/calendar-provider.errors';
import { grantAllowsRead } from './calendar-read-consent.helpers';
import type {
  CalendarAccountProvider,
  CalendarCredentials,
  CalendarProviderKey,
  ConnectResult,
  OAuthCredentials,
  OAuthTokenGrant,
} from '../providers/calendar-provider.interface';
import {
  decryptCalendarCredentials,
  encryptCalendarCredentials,
} from './calendar-credentials.helpers';

type Db = PostgresJsDatabase<typeof schema>;

const logger = new Logger('CalendarConnect');

export interface UpsertCalendarConnectionInput {
  userId: number;
  provider: CalendarProviderKey;
  result: ConnectResult;
}

export interface UpsertCalendarConnectionResult {
  id: number;
  outcome: 'created' | 'updated';
}

/** L8: the grant, keeping the stored refresh token when the grant has none. */
export function mergeGrantWithStored(
  grant: OAuthTokenGrant,
  stored: CalendarCredentials | null,
): OAuthCredentials | null {
  const kept = stored?.kind === 'oauth' ? stored.refreshToken : null;
  const refreshToken = grant.refreshToken ?? kept;
  if (!refreshToken) return null;
  return {
    kind: 'oauth',
    accessToken: grant.accessToken,
    refreshToken,
    expiresAt: grant.expiresAt,
    scopes: grant.scopes,
  };
}

/** The row's unique key (`calendar_connections_user_provider_subject_uq`). */
export interface ConnectionKey {
  userId: number;
  provider: CalendarProviderKey;
  accountSubject: string;
}

/** What `writeConnectionRow` stores besides the credentials. */
export interface ConnectionRowInput extends ConnectionKey {
  /** null keeps the stored label on an update. */
  accountLabel: string | null;
}

export async function findExistingConnection(
  db: Db,
  key: ConnectionKey,
): Promise<{ id: number; credentialsEncrypted: string } | null> {
  const [row] = await db
    .select({
      id: calendarConnections.id,
      credentialsEncrypted: calendarConnections.credentialsEncrypted,
    })
    .from(calendarConnections)
    .where(
      and(
        eq(calendarConnections.userId, key.userId),
        eq(calendarConnections.provider, key.provider),
        eq(calendarConnections.accountSubject, key.accountSubject),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** An unreadable stored blob (rotated key) counts as "nothing to keep". */
function readStored(
  row: { credentialsEncrypted: string } | null,
): CalendarCredentials | null {
  if (!row) return null;
  try {
    return decryptCalendarCredentials(row.credentialsEncrypted);
  } catch {
    return null;
  }
}

/** `calendar_connections_user_provider_subject_uq`. */
const CONNECTION_KEY = [
  calendarConnections.userId,
  calendarConnections.provider,
  calendarConnections.accountSubject,
];

/**
 * The single statement that cannot duplicate: insert, or update on the key.
 * ROK-1593 D-R3: every grant recomputes read access; `write_*` untouched.
 * ROK-1598 D10: shared with the Apple password connect.
 */
export async function writeConnectionRow(
  db: Db,
  input: ConnectionRowInput,
  credentialsEncrypted: string,
  readAccessGranted: boolean,
): Promise<number> {
  const { accountLabel } = input;
  const both = {
    credentialsEncrypted,
    status: 'active' as const,
    readAccessGranted,
  };
  const [row] = await db
    .insert(calendarConnections)
    .values({
      userId: input.userId,
      provider: input.provider,
      accountSubject: input.accountSubject,
      accountLabel,
      ...both,
    })
    .onConflictDoUpdate({
      target: CONNECTION_KEY,
      set: {
        ...both,
        // A grant without an email keeps the stored label (undefined = skip).
        accountLabel: accountLabel ?? undefined,
        lastErrorCode: null,
        updatedAt: new Date(),
      },
    })
    .returning({ id: calendarConnections.id });
  if (!row) throw new Error('calendar connection upsert returned no row');
  return row.id;
}

const accountOf = (r: ConnectResult) => ({
  accountSubject: r.accountSubject,
  accountLabel: r.accountLabel,
});

/**
 * Insert or update the connection. Throws `ProviderAuthError
 * ('missing_refresh_token')` when neither the grant nor the stored row has a
 * refresh token: a row that cannot refresh would die within the hour.
 */
export async function upsertCalendarConnection(
  db: Db,
  input: UpsertCalendarConnectionInput,
): Promise<UpsertCalendarConnectionResult> {
  const { userId, provider, result } = input;
  const row = { userId, provider, ...accountOf(result) };
  const existing = await findExistingConnection(db, row);
  const creds = mergeGrantWithStored(result.credentials, readStored(existing));
  if (!creds) throw new ProviderAuthError('missing_refresh_token');
  const id = await writeConnectionRow(
    db,
    row,
    encryptCalendarCredentials(creds),
    grantAllowsRead(provider, result.credentials.scopes),
  );
  return { id, outcome: existing ? 'updated' : 'created' };
}

/**
 * Best-effort revoke of a fresh grant the upsert did not store (DB failure,
 * or `missing_refresh_token` — then the access token is revoked, which Google
 * accepts). A failure is logged by error class only, never a token.
 */
export async function revokeUnstoredGrant(
  provider: Pick<CalendarAccountProvider, 'disconnect'>,
  grant: OAuthTokenGrant,
): Promise<void> {
  try {
    await provider.disconnect({
      ...grant,
      refreshToken: grant.refreshToken ?? '',
    });
  } catch (err) {
    const name = err instanceof Error ? err.constructor.name : typeof err;
    logger.warn(`revoke of an unstored calendar grant failed (${name})`);
  }
}
