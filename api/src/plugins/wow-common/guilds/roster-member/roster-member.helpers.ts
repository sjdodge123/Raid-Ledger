/**
 * ROK-2149 — pure rules of the read-only roster-member page: who may see
 * it (two audiences, operator direction 2026-11-09 ~15:30Z), whether the
 * stored Armory snapshot is still the member's (AC-4), and why there is no
 * Armory data (D1).
 */
import type { RosterMemberNoArmoryReason } from '@raid-ledger/contract';

/**
 * `member` = hub members + staff (full payload incl. rank / last seen);
 * `claim_preview` = any signed-in user, unclaimed member of a claimable
 * Forever guild (no roster-only keys); `forbidden` = 403.
 */
export type RosterMemberAudience = 'member' | 'claim_preview' | 'forbidden';

export interface AudienceInput {
  canView: boolean;
  unclaimed: boolean;
  claimable: boolean;
}

export function selectAudience(input: AudienceInput): RosterMemberAudience {
  if (input.canView) return 'member';
  if (input.unclaimed && input.claimable) return 'claim_preview';
  return 'forbidden';
}

/** The snapshot columns the reason / verification rules read. */
export interface SnapshotState {
  blizzardCharacterId: number | null;
  syncedAt: Date | null;
  lastError: string | null;
}

/**
 * The `memberSnapshotJoin` rule (`roster-armory-fields.ts`) in TS: the
 * snapshot was verified against the member's CURRENT Blizzard id (SQL `=`,
 * so a null on either side never matches) and was ever synced.
 */
export function isVerifiedSnapshot(
  memberBlizzardId: number | null,
  snap: SnapshotState | null,
): boolean {
  if (snap === null || snap.syncedAt === null) return false;
  if (memberBlizzardId === null || snap.blizzardCharacterId === null) {
    return false;
  }
  return snap.blizzardCharacterId === memberBlizzardId;
}

export interface ReasonInput {
  memberBlizzardId: number | null;
  rosterLevel: number | null;
  snapshot: SnapshotState | null;
}

const ERROR_REASONS: readonly RosterMemberNoArmoryReason[] = [
  'invalid_name',
  'not_found',
  'id_mismatch',
];

/** The D1 error reason for `lastError`, or null (`upstream` is transient). */
function errorReason(
  lastError: string | null,
): RosterMemberNoArmoryReason | null {
  return ERROR_REASONS.find((r) => r === lastError) ?? null;
}

/**
 * D1: undefined when a verified snapshot exists (it wins over any
 * `last_error`), else the first matching reason in table order.
 */
export function noArmoryReason(
  input: ReasonInput,
): RosterMemberNoArmoryReason | undefined {
  const { memberBlizzardId, rosterLevel, snapshot } = input;
  if (isVerifiedSnapshot(memberBlizzardId, snapshot)) return undefined;
  if (memberBlizzardId === null) return 'no_blizzard_id';
  if (rosterLevel !== null && rosterLevel < 10) return 'below_level_10';
  return errorReason(snapshot?.lastError ?? null) ?? 'pending';
}
