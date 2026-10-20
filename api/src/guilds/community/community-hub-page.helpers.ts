import type {
  GuildMemberRow,
  GuildPage,
  GuildPageCommunity,
  GuildSummary,
  HubStatus,
  LadderRole,
} from '@raid-ledger/contract';
import { publicAvatarUrl } from '../../common/public-avatar-url.helpers';
import { viewerAccess } from '../guild-access.service';
import type { CommunityRole } from './community-membership.queries';

/** ROK-1870 L2a — the pure `game_community` hub page builder. */

/** One `hub_community_members` row with its user, as loaded for the page. */
export interface CommunityMemberRecord {
  memberId: number;
  userId: number;
  role: CommunityRole;
  joinedAt: Date;
  leftAt: Date | null;
  bannedAt: Date | null;
  username: string;
  displayName: string | null;
  avatar: string | null;
  deactivatedAt: Date | null;
}

/** Inputs of `buildCommunityHubPage`. */
export interface CommunityHubPageInput {
  guild: GuildSummary;
  status: HubStatus;
  blurb: string | null;
  role: LadderRole;
  viewerId: number;
  /** Staff, or the viewer passes the A2 Discord-guild check. */
  viewerMayJoin: boolean;
  members: CommunityMemberRecord[];
}

const ROLE_ORDER = { leader: 0, officer: 1, member: 2 } as const;

/** Live = not left, not banned, active account. */
export function isLiveRecord(r: CommunityMemberRecord): boolean {
  return r.leftAt === null && r.bannedAt === null && r.deactivatedAt === null;
}

/** `memberId` = the membership row id; `community.userId` = `users.id`. */
function toRow(r: CommunityMemberRecord): GuildMemberRow {
  return {
    memberId: r.memberId,
    name: r.displayName ?? r.username,
    class: null,
    level: null,
    rankIndex: null,
    rankName: null,
    effectiveRole: null,
    characterId: null,
    isMain: false,
    community: {
      userId: r.userId,
      role: r.role,
      joinedAt: r.joinedAt.toISOString(),
    },
  };
}

/** Leader, officers, members; then name. */
export function orderCommunityRows(rows: GuildMemberRow[]): GuildMemberRow[] {
  const rank = (r: GuildMemberRow): number =>
    ROLE_ORDER[r.community?.role ?? 'member'];
  return [...rows].sort(
    (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name),
  );
}

function joinBlock(
  input: CommunityHubPageInput,
  joined: boolean,
  banned: boolean,
): Pick<GuildPageCommunity, 'canJoin' | 'joinBlockedReason'> {
  if (joined) return { canJoin: false, joinBlockedReason: null };
  if (input.status !== 'active')
    return { canJoin: false, joinBlockedReason: 'archived' };
  if (banned) return { canJoin: false, joinBlockedReason: 'banned' };
  if (!input.viewerMayJoin)
    return { canJoin: false, joinBlockedReason: 'not-in-discord' };
  return { canJoin: true, joinBlockedReason: null };
}

/** The `community` block of the page payload for this viewer. */
export function communityBlock(
  input: CommunityHubPageInput,
  live: CommunityMemberRecord[],
): GuildPageCommunity {
  const mine = input.members.find((r) => r.userId === input.viewerId);
  const joined = mine !== undefined && isLiveRecord(mine);
  const banned = mine?.bannedAt !== null && mine?.bannedAt !== undefined;
  const leader = live.find((r) => r.role === 'leader');
  return {
    status: input.status,
    blurb: input.blurb,
    viewerJoined: joined,
    viewerBanned: banned,
    ...joinBlock(input, joined, banned),
    leader: leader
      ? {
          userId: leader.userId,
          username: leader.displayName ?? leader.username,
          avatarUrl: publicAvatarUrl(leader.avatar),
        }
      : null,
  };
}

/**
 * The `game_community` hub page — one unranked group of live members. A
 * visitor gets the hero, the community block and the member COUNT, but no
 * member rows (members-first privacy, as the server hub).
 */
export function buildCommunityHubPage(input: CommunityHubPageInput): GuildPage {
  const live = input.members.filter(isLiveRecord);
  const rows = live.map(toRow);
  return {
    guild: {
      ...input.guild,
      status: input.status,
      blurb: input.blurb,
      memberCount: live.length,
    },
    importedBy: null,
    viewer: viewerAccess(input.role),
    ranks: [
      {
        rankIndex: null,
        rankName: null,
        members: input.role === 'visitor' ? [] : orderCommunityRows(rows),
      },
    ],
    roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
    community: communityBlock(input, live),
  };
}
