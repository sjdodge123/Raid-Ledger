/**
 * ROK-1598 (spec §2.7, D10): store an Apple (password) connect, and persist
 * rediscovered CalDAV locations.
 *
 * One row per `(user, provider, account_subject)` — the same insert …
 * on-conflict statement as the OAuth connect (`writeConnectionRow`), so a
 * reconnect of the same email (any case: the subject is the lowercased
 * email) updates credentials, `status='active'` and clears
 * `last_error_code`, never the read/write settings. Credentials (the app
 * password included) are stored only through `encryptCalendarCredentials`.
 */
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import { calendarConnections } from '../../drizzle/schema';
import type { CalDavCredentialPersister } from '../providers/apple/apple-discovery.helpers';
import type {
  CalDavCredentials,
  CalendarProviderKey,
  PasswordConnectResult,
} from '../providers/calendar-provider.interface';
import {
  findExistingConnection,
  writeConnectionRow,
  type UpsertCalendarConnectionResult,
} from './calendar-connect.helpers';
import {
  decryptCalendarCredentials,
  encryptCalendarCredentials,
} from './calendar-credentials.helpers';

type Db = PostgresJsDatabase<typeof schema>;

export interface UpsertPasswordConnectionInput {
  userId: number;
  provider: CalendarProviderKey;
  result: PasswordConnectResult;
}

/** The subject a CalDAV login is stored under (D10). */
export const caldavSubject = (username: string): string =>
  username.trim().toLowerCase();

/** Insert or update the password connection; read access is always on. */
export async function upsertPasswordConnection(
  db: Db,
  input: UpsertPasswordConnectionInput,
): Promise<UpsertCalendarConnectionResult> {
  const row = {
    userId: input.userId,
    provider: input.provider,
    accountSubject: caldavSubject(input.result.accountSubject),
    accountLabel: input.result.accountLabel,
  };
  const existing = await findExistingConnection(db, row);
  const encrypted = encryptCalendarCredentials(input.result.credentials);
  const id = await writeConnectionRow(db, row, encrypted, true);
  return { id, outcome: existing ? 'updated' : 'created' };
}

/** Only the discovered locations change; each row keeps its own password. */
function withLocations(
  stored: CalDavCredentials,
  next: CalDavCredentials,
): CalDavCredentials {
  return {
    ...stored,
    ...(next.principalUrl !== undefined && { principalUrl: next.principalUrl }),
    ...(next.homeSetUrl !== undefined && { homeSetUrl: next.homeSetUrl }),
  };
}

/**
 * Write the rediscovered locations onto ONE row, compare-and-swap on the
 * encrypted value read (Codex r2): a reconnect that stored a new password
 * after the read wins — this update then matches no row and is dropped (the
 * reconnect ran its own discovery). Exported for the integration spec.
 */
export async function persistLocationsOnRow(
  db: Db,
  row: { id: number; credentialsEncrypted: string },
  next: CalDavCredentials,
): Promise<void> {
  let stored;
  try {
    stored = decryptCalendarCredentials(row.credentialsEncrypted);
  } catch {
    return; // unreadable (rotated key): the next connect replaces it
  }
  if (stored.kind !== 'caldav') return;
  await db
    .update(calendarConnections)
    .set({
      credentialsEncrypted: encryptCalendarCredentials(
        withLocations(stored, next),
      ),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(calendarConnections.id, row.id),
        eq(calendarConnections.credentialsEncrypted, row.credentialsEncrypted),
      ),
    );
}

/**
 * The `CALDAV_CREDENTIAL_PERSISTER` binding: the adapter does not know the
 * row, so every Apple row stored under the login's subject gets the
 * rediscovered `principalUrl` / `homeSetUrl` (a partition move is per Apple
 * account, whoever connected it). Each row is swapped on its own read value
 * (`persistLocationsOnRow`), so no row's newer password is overwritten.
 */
export function createCalDavCredentialPersister(
  db: Db,
): CalDavCredentialPersister {
  return async (next) => {
    const rows = await db
      .select({
        id: calendarConnections.id,
        credentialsEncrypted: calendarConnections.credentialsEncrypted,
      })
      .from(calendarConnections)
      .where(
        and(
          eq(calendarConnections.provider, 'apple'),
          eq(calendarConnections.accountSubject, caldavSubject(next.username)),
        ),
      );
    for (const row of rows) await persistLocationsOnRow(db, row, next);
  };
}
