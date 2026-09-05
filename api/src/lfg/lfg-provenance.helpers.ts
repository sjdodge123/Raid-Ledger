/**
 * Provenance reads for a CONVERTED LFG group (ROK-1454 D5).
 *
 * A converted group is historical on TWO axes at once: `convertGroup`
 * (`lfg-write.helpers.ts`) flips every live row to `status = 'converted'` and
 * never resets `expires_at`. The live predicate family in
 * `lfg-query.helpers.ts` filters on BOTH (`status = 'active'` AND
 * `expires_at > now()`), so composing it here would return an empty roster and
 * the terminal Discord embed would silently lose every player. Round 1 of this
 * story did exactly that and was rejected for it.
 *
 * So this file reads by PROVENANCE — the `converted_to_poll_id` /
 * `converted_to_event_id` FKs the conversion wrote — and composes exactly one
 * thing from the live family: `eligibleUser()`. That one is deliberate. A
 * deactivated or banned player must not be named in a public channel message
 * (ROK-313 guard family), whatever the group's history says.
 *
 * Nothing here may import the live intent predicate; `lfg-provenance.helpers.spec.ts`
 * asserts that mechanically against this file's own source.
 *
 * The reads in `lfg-query.helpers.ts` are UNCHANGED by this story. They stay
 * correct for what they describe — a group that is live right now.
 */
import { and, asc, eq, type SQL } from 'drizzle-orm';
import type { LfgMemberDto } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import { eligibleUser, type LfgDb } from './lfg-query.helpers';
// Type-only: erased at compile time, so the `lfg-write.helpers` -> this-file
// import of `convertedToTarget` cannot become a runtime require cycle.
import type { LfgConversionTarget } from './lfg-write.helpers';

/**
 * SQL predicate: an intent whose conversion provenance points at `target`.
 *
 * Moved verbatim out of `lfg-write.helpers.ts`, where it was private and only
 * `isGroupParticipant` could reach it. The `pollId !== undefined` tie-break is
 * part of the contract, not an accident: a caller passing both fields gets the
 * poll branch, exactly as before the move.
 *
 * Requires `lfg_intents` to be in the query.
 *
 * @param target - Exactly one of `pollId` / `eventId`, as `convertGroup` wrote it.
 * @returns The provenance equality condition.
 */
export function convertedToTarget(target: LfgConversionTarget): SQL {
  return target.pollId !== undefined
    ? eq(schema.lfgIntents.convertedToPollId, target.pollId)
    : eq(schema.lfgIntents.convertedToEventId, target.eventId as number);
}

/**
 * The seven columns `listGroupMembers` (`lfg-query.helpers.ts`) selects. Kept
 * identical so the two rosters render the same way whichever read produced
 * them.
 */
const MEMBER_COLUMNS = {
  userId: schema.users.id,
  username: schema.users.username,
  displayName: schema.users.displayName,
  avatar: schema.users.avatar,
  customAvatarUrl: schema.users.customAvatarUrl,
  expiresAt: schema.lfgIntents.expiresAt,
  joinedAt: schema.lfgIntents.createdAt,
};

/** Project a selected row onto the wire DTO, exactly as the live read does. */
function toMemberDto(row: {
  userId: number;
  username: string;
  displayName: string | null;
  avatar: string | null;
  customAvatarUrl: string | null;
  expiresAt: Date;
  joinedAt: Date;
}): LfgMemberDto {
  return {
    userId: row.userId,
    username: row.username,
    displayName: row.displayName,
    avatarUrl: row.customAvatarUrl ?? row.avatar,
    expiresAt: row.expiresAt.toISOString(),
    joinedAt: row.joinedAt.toISOString(),
  };
}

/**
 * Roster of the group that converted into `target`, oldest intent first.
 *
 * Target-scoped rather than merely game-scoped: `lfg_intents` has no group id,
 * so `game_id + status = 'converted'` alone would sweep in every past group's
 * rows for that game. The FK is the only thing that identifies THIS group.
 *
 * @param db - Drizzle handle.
 * @param gameId - Game whose converted group to read.
 * @param target - The conversion target the group was converted into.
 * @returns The eligible members, ordered by when they joined.
 */
export async function listConvertedGroupMembers(
  db: LfgDb,
  gameId: number,
  target: LfgConversionTarget,
): Promise<LfgMemberDto[]> {
  const rows = await db
    .select(MEMBER_COLUMNS)
    .from(schema.lfgIntents)
    .innerJoin(schema.users, eq(schema.users.id, schema.lfgIntents.userId))
    .where(
      and(
        eq(schema.lfgIntents.gameId, gameId),
        eq(schema.lfgIntents.status, 'converted'),
        convertedToTarget(target),
        eligibleUser(),
      ),
    )
    .orderBy(asc(schema.lfgIntents.createdAt), asc(schema.lfgIntents.id));
  return rows.map(toMemberDto);
}
