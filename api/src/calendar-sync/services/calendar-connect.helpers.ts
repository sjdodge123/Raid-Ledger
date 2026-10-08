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

async function findExisting(
  db: Db,
  input: UpsertCalendarConnectionInput,
): Promise<{ id: number; credentialsEncrypted: string } | null> {
  const [row] = await db
    .select({
      id: calendarConnections.id,
      credentialsEncrypted: calendarConnections.credentialsEncrypted,
    })
    .from(calendarConnections)
    .where(
      and(
        eq(calendarConnections.userId, input.userId),
        eq(calendarConnections.provider, input.provider),
        eq(calendarConnections.accountSubject, input.result.accountSubject),
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

/** The single statement that cannot duplicate: insert, or update on the key. */
async function writeConnection(
  db: Db,
  input: UpsertCalendarConnectionInput,
  credentialsEncrypted: string,
): Promise<number> {
  const accountLabel = input.result.accountLabel;
  const [row] = await db
    .insert(calendarConnections)
    .values({
      userId: input.userId,
      provider: input.provider,
      accountSubject: input.result.accountSubject,
      accountLabel,
      credentialsEncrypted,
      status: 'active',
    })
    .onConflictDoUpdate({
      target: CONNECTION_KEY,
      set: {
        credentialsEncrypted,
        // A grant without an email keeps the stored label (undefined = skip).
        accountLabel: accountLabel ?? undefined,
        status: 'active',
        lastErrorCode: null,
        updatedAt: new Date(),
      },
    })
    .returning({ id: calendarConnections.id });
  if (!row) throw new Error('calendar connection upsert returned no row');
  return row.id;
}

/**
 * Insert or update the connection. Throws `ProviderAuthError
 * ('missing_refresh_token')` when neither the grant nor the stored row has a
 * refresh token: a row that cannot refresh would die within the hour.
 */
export async function upsertCalendarConnection(
  db: Db,
  input: UpsertCalendarConnectionInput,
): Promise<UpsertCalendarConnectionResult> {
  const existing = await findExisting(db, input);
  const creds = mergeGrantWithStored(
    input.result.credentials,
    readStored(existing),
  );
  if (!creds) throw new ProviderAuthError('missing_refresh_token');
  const id = await writeConnection(
    db,
    input,
    encryptCalendarCredentials(creds),
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
