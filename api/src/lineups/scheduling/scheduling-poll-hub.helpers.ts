/**
 * ROK-1893 P3 — the poll page's hub projection: `hub` for the header + "Join
 * hub" button, and `isHubMember` on every voter chip. A hidden / archived hub
 * (or an untagged poll) yields `hub: null` and no flags.
 */
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { ScheduleSlotWithVotesDto } from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import { liveMemberPredicate } from '../../guilds/community/community-membership.queries';
import { findVisiblePollHub } from '../standalone-poll/standalone-poll-hub.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** The poll page's `hub` block. */
export interface PollPageHub {
  id: number;
  name: string;
  memberCount: number;
  viewerIsMember: boolean;
}

/** The hub block plus the live member ids used to stamp voters. */
export interface PollHubView {
  hub: PollPageHub | null;
  memberIds: ReadonlySet<number> | null;
}

const NO_HUB: PollHubView = { hub: null, memberIds: null };

/** Load the hub view for a poll tagged to `guildId` (null = untagged). */
export async function loadPollHubView(
  db: Db,
  guildId: number | null,
  viewerId: number | null,
): Promise<PollHubView> {
  if (guildId === null) return NO_HUB;
  const hub = await findVisiblePollHub(db, guildId);
  if (!hub) return NO_HUB;
  const m = schema.hubCommunityMembers;
  const rows = await db
    .select({ userId: m.userId })
    .from(m)
    .where(and(eq(m.guildId, guildId), liveMemberPredicate()));
  const memberIds = new Set(rows.map((r) => r.userId));
  return {
    hub: {
      id: hub.id,
      name: hub.name,
      memberCount: memberIds.size,
      viewerIsMember: viewerId !== null && memberIds.has(viewerId),
    },
    memberIds,
  };
}

/** Stamp `isHubMember` on every yes/no voter; untouched when there is no hub. */
export function stampHubMembers(
  slots: ScheduleSlotWithVotesDto[],
  memberIds: ReadonlySet<number> | null,
): ScheduleSlotWithVotesDto[] {
  if (memberIds === null) return slots;
  const stamp = <V extends { userId: number }>(v: V) => ({
    ...v,
    isHubMember: memberIds.has(v.userId),
  });
  return slots.map((s) => ({
    ...s,
    votes: s.votes.map(stamp),
    noVotes: s.noVotes.map(stamp),
  }));
}
