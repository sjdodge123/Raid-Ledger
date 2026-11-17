/**
 * ROK-1893 P3 — the poll page's hub projection: `hub` for the header + "Join
 * hub" button, and `isHubMember` on every voter chip. A hidden / archived hub
 * (or an untagged poll) yields `hub: null` and no flags. ROK-2212: membership
 * is the hub kind's — a community hub reads `hub_community_members` in one
 * query; any other kind (a `wow_guild` hub's live linked roster) asks the
 * kind's member set once (`HubMembersAmong`), the same source as the poll
 * tag's `isMember`.
 */
import { and, eq, inArray, or } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  GuildKind,
  ScheduleSlotWithVotesDto,
} from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import { liveMemberPredicate } from '../../guilds/community/community-membership.queries';
import {
  findVisiblePollHub,
  type PollHub,
} from '../standalone-poll/standalone-poll-hub.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * ROK-2212: which of `userIds` are members of hub `hubId`, by its kind — one
 * batched read (`GuildAccessService.areMembers`), never a query per voter.
 */
export type HubMembersAmong = (
  userIds: readonly number[],
  hubId: number,
) => Promise<ReadonlySet<number>>;

/** The poll page's `hub` block. */
export interface PollPageHub {
  id: number;
  name: string;
  memberCount: number;
  viewerIsMember: boolean;
  /** ROK-2212: only a `game_community` hub offers "Join hub". */
  kind: GuildKind;
}

/** The hub block plus the live member ids (voters + viewer only) used to stamp voters. */
export interface PollHubView {
  hub: PollPageHub | null;
  memberIds: ReadonlySet<number> | null;
}

const NO_HUB: PollHubView = { hub: null, memberIds: null };

/** The distinct voters on `slotIds` (a subquery). */
function votersOn(db: Db, slotIds: readonly number[]) {
  const v = schema.communityLineupScheduleVotes;
  return db
    .selectDistinct({ userId: v.userId })
    .from(v)
    .where(inArray(v.slotId, [...slotIds]));
}

/**
 * The live community-hub members among this poll's voters (on `slotIds`)
 * and the viewer — never the hub's whole roster.
 */
async function loadCommunityVoterMemberIds(
  db: Db,
  guildId: number,
  slotIds: readonly number[],
  viewerId: number | null,
): Promise<Set<number>> {
  if (slotIds.length === 0 && viewerId === null) return new Set();
  const m = schema.hubCommunityMembers;
  const rows = await db
    .select({ userId: m.userId })
    .from(m)
    .where(
      and(
        eq(m.guildId, guildId),
        liveMemberPredicate(),
        or(
          slotIds.length > 0
            ? inArray(m.userId, votersOn(db, slotIds))
            : undefined,
          viewerId === null ? undefined : eq(m.userId, viewerId),
        ),
      ),
    );
  return new Set(rows.map((r) => r.userId));
}

/** ROK-2212: the voters + viewer the hub kind's member set contains. */
async function loadCheckedVoterMemberIds(
  db: Db,
  guildId: number,
  slotIds: readonly number[],
  viewerId: number | null,
  membersAmong: HubMembersAmong,
): Promise<ReadonlySet<number>> {
  const voters = slotIds.length > 0 ? await votersOn(db, slotIds) : [];
  const ids = new Set(voters.map((r) => r.userId));
  if (viewerId !== null) ids.add(viewerId);
  if (ids.size === 0) return new Set();
  return membersAmong([...ids], guildId);
}

/** The hub's members among the voters + viewer, by the hub's kind. */
function loadVoterMemberIds(
  db: Db,
  hub: PollHub,
  slotIds: readonly number[],
  viewerId: number | null,
  membersAmong: HubMembersAmong,
): Promise<ReadonlySet<number>> {
  if (hub.kind === 'game_community') {
    return loadCommunityVoterMemberIds(db, hub.id, slotIds, viewerId);
  }
  return loadCheckedVoterMemberIds(db, hub.id, slotIds, viewerId, membersAmong);
}

/** Load the hub view for a poll tagged to `guildId` (null = untagged). */
export async function loadPollHubView(
  db: Db,
  guildId: number | null,
  viewerId: number | null,
  slotIds: readonly number[],
  membersAmong: HubMembersAmong,
): Promise<PollHubView> {
  if (guildId === null) return NO_HUB;
  const hub = await findVisiblePollHub(db, guildId);
  if (!hub) return NO_HUB;
  const memberIds = await loadVoterMemberIds(
    db,
    hub,
    slotIds,
    viewerId,
    membersAmong,
  );
  return {
    hub: {
      id: hub.id,
      name: hub.name,
      memberCount: hub.memberCount,
      viewerIsMember: viewerId !== null && memberIds.has(viewerId),
      kind: hub.kind,
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
