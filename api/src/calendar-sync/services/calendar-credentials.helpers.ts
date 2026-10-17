/**
 * ROK-1592 (plan L7): the ONLY place calendar credentials are decrypted.
 *
 * `credentials_encrypted` = `encrypt(JSON.stringify(CalendarCredentials))`
 * with the settings crypto (AES-256-GCM keyed from JWT_SECRET;
 * `scripts/reencrypt-settings.ts` rotates it). Nothing here logs, and no
 * error carries the plaintext.
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import { calendarConnections } from '../../drizzle/schema';
import { decrypt, encrypt, isEncrypted } from '../../settings/encryption.util';
import type {
  CalendarAccountProvider,
  CalendarCredentials,
  OAuthCredentials,
} from '../providers/calendar-provider.interface';

type Db = PostgresJsDatabase<typeof schema>;

/** Refresh when the access token has less than this left. */
export const CALENDAR_REFRESH_SKEW_MS = 60_000;

/** The stored blob would not decrypt or parse. Carries no content. */
export class CalendarCredentialsUnreadableError extends Error {
  constructor() {
    super('calendar credentials unreadable');
    this.name = 'CalendarCredentialsUnreadableError';
  }
}

export function encryptCalendarCredentials(creds: CalendarCredentials): string {
  return encrypt(JSON.stringify(creds));
}

/** Does this look like an `encrypt()` output (never a plaintext JSON blob)? */
export function isEncryptedCredentials(value: string): boolean {
  return isEncrypted(value);
}

function isCredentials(value: unknown): value is CalendarCredentials {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (v.kind === 'caldav') {
    return typeof v.username === 'string' && typeof v.appPassword === 'string';
  }
  return (
    v.kind === 'oauth' &&
    typeof v.accessToken === 'string' &&
    typeof v.refreshToken === 'string' &&
    typeof v.expiresAt === 'string' &&
    Array.isArray(v.scopes)
  );
}

export function decryptCalendarCredentials(blob: string): CalendarCredentials {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decrypt(blob));
  } catch {
    throw new CalendarCredentialsUnreadableError();
  }
  if (!isCredentials(parsed)) throw new CalendarCredentialsUnreadableError();
  return parsed;
}

/**
 * The view of a connection row that may leave this module (logs, DTOs,
 * job payloads): field by field, so `credentialsEncrypted` and any decrypted
 * token can never ride along.
 */
export interface SafeConnectionView {
  id: number;
  userId: number;
  provider: string;
  accountLabel: string | null;
  status: string;
}

export function toSafeConnectionView(
  row: SafeConnectionView,
): SafeConnectionView {
  return {
    id: row.id,
    userId: row.userId,
    provider: row.provider,
    accountLabel: row.accountLabel,
    status: row.status,
  };
}

/** Persist rotated credentials (`updated_at` has no `$onUpdate`). */
export async function persistCalendarCredentials(
  db: Db,
  connectionId: number,
  creds: CalendarCredentials,
): Promise<void> {
  await db
    .update(calendarConnections)
    .set({
      credentialsEncrypted: encryptCalendarCredentials(creds),
      updatedAt: new Date(),
    })
    .where(eq(calendarConnections.id, connectionId));
}

function needsRefresh(creds: OAuthCredentials, nowMs: number): boolean {
  const expiresMs = Date.parse(creds.expiresAt);
  return (
    !Number.isFinite(expiresMs) || expiresMs - nowMs < CALENDAR_REFRESH_SKEW_MS
  );
}

/**
 * Run `fn` with usable credentials: an OAuth token under 60 s from expiry is
 * refreshed through the provider and persisted first. Provider errors
 * (`ProviderAuthError` → needs_reconnect) propagate to the caller.
 */
export async function withFreshCredentials<T>(
  db: Db,
  conn: { id: number; credentialsEncrypted: string },
  provider: Pick<CalendarAccountProvider, 'refresh'>,
  fn: (creds: CalendarCredentials) => Promise<T>,
  nowMs: number = Date.now(),
): Promise<T> {
  let creds = decryptCalendarCredentials(conn.credentialsEncrypted);
  if (creds.kind === 'oauth' && needsRefresh(creds, nowMs)) {
    creds = await provider.refresh(creds);
    await persistCalendarCredentials(db, conn.id, creds);
  }
  return fn(creds);
}
