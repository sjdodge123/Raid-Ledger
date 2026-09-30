/**
 * The one member projection every LFG roster read shares.
 *
 * `listGroupMembers` (`lfg-query.helpers.ts`, live groups) and
 * `listConvertedGroupMembers` (`lfg-provenance.helpers.ts`, converted groups)
 * select the same columns and map them onto the same wire DTO, so the two
 * rosters render the same way whichever read produced them.
 *
 * Deliberately a leaf: it imports only the schema and contract types. Both
 * readers import it, and `lfg-provenance.helpers.ts` already imports
 * `eligibleUser` from `lfg-query.helpers.ts`, so hosting the projection in
 * either reader would turn that edge into a runtime require cycle.
 */
import type { LfgMemberDto, LfgUrgency } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';

/** The seven columns a roster read selects. */
export const MEMBER_COLUMNS = {
  userId: schema.users.id,
  username: schema.users.username,
  displayName: schema.users.displayName,
  avatar: schema.users.avatar,
  customAvatarUrl: schema.users.customAvatarUrl,
  urgency: schema.lfgIntents.urgency,
  expiresAt: schema.lfgIntents.expiresAt,
  joinedAt: schema.lfgIntents.createdAt,
};

/** Project a selected row onto the wire DTO. */
export function toMemberDto(row: {
  userId: number;
  username: string;
  displayName: string | null;
  avatar: string | null;
  customAvatarUrl: string | null;
  urgency: string;
  expiresAt: Date;
  joinedAt: Date;
}): LfgMemberDto {
  return {
    userId: row.userId,
    username: row.username,
    displayName: row.displayName,
    avatarUrl: row.customAvatarUrl ?? row.avatar,
    urgency: row.urgency as LfgUrgency,
    expiresAt: row.expiresAt.toISOString(),
    joinedAt: row.joinedAt.toISOString(),
  };
}
