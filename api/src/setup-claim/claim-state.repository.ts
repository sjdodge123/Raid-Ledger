/**
 * ROK-1701 D-3: the claim state, read and written DIRECTLY over
 * `app_settings` rows (not SettingsService's cache) so bootstrap (no Nest)
 * and the api share it, and the consume is atomic with the password write.
 * Values are `encrypt()`ed like every settings row (reencrypt-settings keeps
 * working). NEVER log a value read here.
 */
import { eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { appSettings, SETTING_KEYS } from '../drizzle/schema/app-settings';
import { decrypt, encrypt } from '../settings/encryption.util';

/** A drizzle db or a transaction handle (bootstrap passes `tx` as this). */
export type ClaimDb = PostgresJsDatabase<typeof schema>;

export interface ClaimState {
  /** sha256 hex of the armed code; null ⇒ not armed or consumed. */
  codeHash: string | null;
  expiresAt: Date | null;
  /** Non-null ⇒ claimed; permanent. */
  claimedAt: Date | null;
}

const CLAIM_STATE_KEYS = [
  SETTING_KEYS.CLAIM_CODE_HASH,
  SETTING_KEYS.CLAIM_EXPIRES_AT,
  SETTING_KEYS.CLAIMED_AT,
];

type ClaimKey =
  | (typeof CLAIM_STATE_KEYS)[number]
  | typeof SETTING_KEYS.CLAIM_TEST_RESTORE_HASH;

/** Parse a stored ISO time; an unparsable value reads as absent. */
function parseIso(value: string | undefined): Date | null {
  if (value === undefined) return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** Decrypt `{key, encryptedValue}` rows into a key → plaintext map. */
export function toClaimState(
  rows: ReadonlyArray<{ key: string; encryptedValue: string }>,
): ClaimState {
  const values = new Map<string, string>();
  for (const row of rows) values.set(row.key, decrypt(row.encryptedValue));
  return {
    codeHash: values.get(SETTING_KEYS.CLAIM_CODE_HASH) ?? null,
    expiresAt: parseIso(values.get(SETTING_KEYS.CLAIM_EXPIRES_AT)),
    claimedAt: parseIso(values.get(SETTING_KEYS.CLAIMED_AT)),
  };
}

/** D-7: claimable ⇔ a code is armed AND the instance is not claimed.
 *  Expiry does NOT clear it (an expired instance still shows /claim). */
export function isClaimRequired(state: ClaimState): boolean {
  return state.codeHash !== null && state.claimedAt === null;
}

/**
 * One SELECT of the three claim rows. `forUpdate` row-locks them for the
 * consume transaction, so a racing second claimer waits, then re-reads a
 * consumed state (→ 409).
 */
export async function readClaimState(
  db: ClaimDb,
  opts: { forUpdate?: boolean } = {},
): Promise<ClaimState> {
  const query = db
    .select({
      key: appSettings.key,
      encryptedValue: appSettings.encryptedValue,
    })
    .from(appSettings)
    .where(inArray(appSettings.key, CLAIM_STATE_KEYS));
  const rows = opts.forUpdate ? await query.for('update') : await query;
  return toClaimState(rows);
}

/** Upsert one encrypted claim row. */
async function writeClaimKey(
  db: ClaimDb,
  key: ClaimKey,
  value: string,
): Promise<void> {
  const encryptedValue = encrypt(value);
  const updatedAt = new Date();
  await db
    .insert(appSettings)
    .values({ key, encryptedValue, updatedAt })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { encryptedValue, updatedAt },
    });
}

/** Arm (or re-arm) a code: store its hash and the new expiry. Callers never
 *  arm a claimed instance (`planClaimArm` returns `claimed`). */
export async function armClaim(
  db: ClaimDb,
  arm: { codeHash: string; expiresAt: Date },
): Promise<void> {
  await writeClaimKey(db, SETTING_KEYS.CLAIM_CODE_HASH, arm.codeHash);
  await writeClaimKey(
    db,
    SETTING_KEYS.CLAIM_EXPIRES_AT,
    arm.expiresAt.toISOString(),
  );
}

/** Consume: record `claimed_at`, delete the hash + expiry. Run inside the
 *  claim transaction, after `readClaimState(tx, { forUpdate: true })`. Also
 *  used by D-14 (`RESET_PASSWORD=true` on an unclaimed cloud instance). */
export async function markClaimed(db: ClaimDb, claimedAt: Date): Promise<void> {
  await writeClaimKey(db, SETTING_KEYS.CLAIMED_AT, claimedAt.toISOString());
  await db
    .delete(appSettings)
    .where(
      inArray(appSettings.key, [
        SETTING_KEYS.CLAIM_CODE_HASH,
        SETTING_KEYS.CLAIM_EXPIRES_AT,
      ]),
    );
}

/** DEMO_MODE fixture: delete hash, expiry and `claimed_at`. */
export async function clearClaimState(db: ClaimDb): Promise<void> {
  await db
    .delete(appSettings)
    .where(inArray(appSettings.key, CLAIM_STATE_KEYS));
}

/** DEMO_MODE fixture: the admin@local hash snapshot, or null. */
export async function readRestoreHash(db: ClaimDb): Promise<string | null> {
  const rows = await db
    .select({ encryptedValue: appSettings.encryptedValue })
    .from(appSettings)
    .where(eq(appSettings.key, SETTING_KEYS.CLAIM_TEST_RESTORE_HASH))
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : decrypt(row.encryptedValue);
}

/** DEMO_MODE fixture: snapshot admin@local's hash (caller checks absence). */
export async function writeRestoreHash(
  db: ClaimDb,
  passwordHash: string,
): Promise<void> {
  await writeClaimKey(db, SETTING_KEYS.CLAIM_TEST_RESTORE_HASH, passwordHash);
}

/** DEMO_MODE fixture: drop the snapshot after restoring it. */
export async function deleteRestoreHash(db: ClaimDb): Promise<void> {
  await db
    .delete(appSettings)
    .where(eq(appSettings.key, SETTING_KEYS.CLAIM_TEST_RESTORE_HASH));
}
