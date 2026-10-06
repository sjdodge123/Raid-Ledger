/**
 * Per-viewer projection of the scheduling poll page (ROK-1629, operator ruling
 * Q4 2026-10-04): anonymous / deactivated viewers keep voter + member display
 * names but receive no Discord snowflake. `avatar` becomes a server-built
 * absolute URL (or null) and `discordId` is nulled — the contract types it
 * `string | null`, and `null` is the shape a local-only account already sends,
 * so every consumer handles it without a contract change.
 *
 * Applied at the HTTP boundary only; the service keeps the full shape.
 */
import type { SchedulePollPageResponseDto } from '@raid-ledger/contract';
import { discordAvatarUrl } from '../../common/discord-avatar-url.helpers';

type IdentityBearing = {
  avatar: string | null;
  discordId: string | null;
};

/** Strip the snowflake; keep everything else on the row as-is. */
function toPublicIdentity<T extends IdentityBearing>(row: T): T {
  return {
    ...row,
    avatar: discordAvatarUrl(row.discordId, row.avatar),
    discordId: null,
  };
}

export function projectSchedulePollForViewer(
  poll: SchedulePollPageResponseDto,
  isMember: boolean,
): SchedulePollPageResponseDto {
  if (isMember) return poll;
  return {
    ...poll,
    match: {
      ...poll.match,
      members: poll.match.members.map(toPublicIdentity),
    },
    slots: poll.slots.map((slot) => ({
      ...slot,
      votes: slot.votes.map(toPublicIdentity),
      noVotes: slot.noVotes.map(toPublicIdentity),
    })),
  };
}
