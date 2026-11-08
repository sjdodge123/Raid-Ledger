/**
 * ROK-2133: pure rules for the roster Armory snapshot — which roster members
 * are due a fetch, how a failure backs off, when a fetched profile may be
 * stored against a member, and how a snapshot maps onto `characters` for a
 * claim. No I/O here; the fetch/apply module and the job build on these.
 */
import type * as schema from '../../../drizzle/schema';
import {
  AUTOLINK_MAX_BACKOFF_MS,
  backoffDelay,
} from '../forever-auto-link/forever-auto-link.helpers';

/** Max due members one hourly roster Armory run attempts. */
export const MAX_MEMBERS_PER_RUN = 150;
/** A stored snapshot is refreshed once it is older than this. */
export const RESYNC_AFTER_MS = 24 * 60 * 60 * 1000;
/** Below this level Blizzard's realmless profile route 404s. */
export const MIN_LEVEL = 10;

/** Why an attempt failed — stored in `guild_member_armory.last_error`. */
export type MemberArmoryErrorKind =
  'not_found' | 'upstream' | 'invalid_name' | 'id_mismatch';

type ArmoryRow = typeof schema.guildMemberArmory.$inferSelect;

/** The D1 data columns of a member snapshot (no retry state). */
export type MemberArmorySnapshot = Pick<
  ArmoryRow,
  | 'blizzardCharacterId'
  | 'level'
  | 'class'
  | 'race'
  | 'spec'
  | 'role'
  | 'itemLevel'
  | 'avatarUrl'
  | 'equipment'
  | 'talents'
  | 'armoryProfessions'
  | 'lastLoginAt'
  | 'syncedAt'
>;

/** The snapshot-row columns the due rule reads. */
export type MemberDueState = Pick<ArmoryRow, 'level' | 'syncedAt' | 'retryAt'>;

/** Input to {@link isMemberDue}; `snapshot` is null when no row exists. */
export interface MemberDueInput {
  snapshot: MemberDueState | null;
  rosterLevel: number | null;
  now: Date;
}

/** The `characters` columns a claim copies from a verified snapshot. */
export type SnapshotCharacterColumns = Pick<
  typeof schema.characters.$inferInsert,
  | 'level'
  | 'class'
  | 'race'
  | 'spec'
  | 'role'
  | 'itemLevel'
  | 'avatarUrl'
  | 'equipment'
  | 'talents'
  | 'armoryProfessions'
  | 'externalId'
  | 'gameVariant'
  | 'lastSyncedAt'
>;

/**
 * Whether a roster member is due a fetch: roster level known and ≥ 10, its
 * backoff (`retry_at`) elapsed, and either never synced, synced more than
 * 24 h ago, or the roster level differs from the snapshot's (a ding).
 */
export function isMemberDue(input: MemberDueInput): boolean {
  const { snapshot, rosterLevel, now } = input;
  if (rosterLevel === null || rosterLevel < MIN_LEVEL) return false;
  if (snapshot === null) return true;
  if (snapshot.retryAt !== null && snapshot.retryAt > now) return false;
  if (snapshot.syncedAt === null) return true;
  if (now.getTime() - snapshot.syncedAt.getTime() > RESYNC_AFTER_MS) {
    return true;
  }
  return snapshot.level !== rosterLevel;
}

/**
 * When the next attempt may run after `failures` consecutive failures of
 * `kind`. A name the route cannot address or a profile whose id is not the
 * roster's waits the full 24 h; 404 / upstream follow the ROK-2124 curve
 * (1 h doubling, capped at 24 h).
 */
export function nextRetryAt(
  kind: MemberArmoryErrorKind,
  failures: number,
  now: Date,
): Date {
  const delay =
    kind === 'invalid_name' || kind === 'id_mismatch'
      ? AUTOLINK_MAX_BACKOFF_MS
      : backoffDelay(failures);
  return new Date(now.getTime() + delay);
}

/** An upstream failure ends the run so a 429/5xx storm costs one call. */
export function stopsRosterArmoryRun(kind: MemberArmoryErrorKind): boolean {
  return kind === 'upstream';
}

/**
 * A fetched profile may be stored against a member only when its Blizzard id
 * equals the roster's — the route is name-addressed, so a renamed or recycled
 * name must never write another character's data.
 */
export function isSnapshotVerified(
  fetchedId: string | number | null | undefined,
  rosterBlizzardId: number | null,
): boolean {
  if (rosterBlizzardId === null || !Number.isSafeInteger(rosterBlizzardId)) {
    return false;
  }
  if (fetchedId === null || fetchedId === undefined || fetchedId === '') {
    return false;
  }
  return String(fetchedId) === String(rosterBlizzardId);
}

/**
 * Map a verified snapshot onto the `characters` Armory columns for the
 * claim-time copy (marks the row Armory-linked). Returns null when the
 * snapshot was never synced or carries no verified Blizzard id.
 */
export function snapshotToCharacterColumns(
  snapshot: MemberArmorySnapshot,
): SnapshotCharacterColumns | null {
  const { blizzardCharacterId, syncedAt } = snapshot;
  if (blizzardCharacterId === null || syncedAt === null) return null;
  return {
    level: snapshot.level,
    class: snapshot.class,
    race: snapshot.race,
    spec: snapshot.spec,
    role: snapshot.role,
    itemLevel: snapshot.itemLevel,
    avatarUrl: snapshot.avatarUrl,
    equipment: snapshot.equipment,
    talents: snapshot.talents,
    armoryProfessions: snapshot.armoryProfessions,
    externalId: String(blizzardCharacterId),
    gameVariant: 'wow_forever',
    lastSyncedAt: syncedAt,
  };
}
