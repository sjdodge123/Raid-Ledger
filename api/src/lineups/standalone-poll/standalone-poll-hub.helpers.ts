/**
 * ROK-1893 P3 — hub-tagged scheduling polls.
 *
 * A poll may be tagged to a hub (`community_lineups.guild_id`). The tag is
 * only honoured while the hub is VISIBLE: a `game_community` hub — or, since
 * ROK-2212 (operator ruling 2026-11-17), a `wow_guild` hub — that is `active`
 * and not hidden. A hidden / archived hub drops out of every read (poll page,
 * active list, hub list) without the stored id being cleared.
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { and, eq, inArray, isNull, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { findMembership } from '../../guilds/community/community-membership.queries';

type Db = PostgresJsDatabase<typeof schema>;

/** A visible community hub, as polls see it. */
export interface PollHub {
  id: number;
  name: string;
  gameId: number;
  /** `guilds.member_count` (live members, kept current by the hub writes). */
  memberCount: number;
}

const g = schema.guilds;

const pollHubColumns = {
  id: g.id,
  name: g.name,
  gameId: g.gameId,
  memberCount: g.memberCount,
};

/** ROK-2212: the hub kinds a poll may be tagged to. */
export const POLL_HUB_KINDS = ['game_community', 'wow_guild'] as const;

/**
 * Membership as the hub's kind defines it (`GuildAccessService.isMember`):
 * a community hub's live `hub_community_members` row, a guild hub's live
 * linked roster row. Injected so this core helper never imports a plugin.
 */
export type HubMemberCheck = (
  userId: number,
  hubId: number,
) => Promise<boolean>;

/** The "visible poll hub" predicate on `guilds`. */
export function visibleCommunityHubWhere(): SQL | undefined {
  return and(
    inArray(g.kind, [...POLL_HUB_KINDS]),
    eq(g.status, 'active'),
    isNull(g.hiddenAt),
  );
}

/** The hub when it is a visible community hub, else null. */
export async function findVisiblePollHub(
  db: Db,
  guildId: number,
): Promise<PollHub | null> {
  const [row] = await db
    .select(pollHubColumns)
    .from(g)
    .where(and(eq(g.id, guildId), visibleCommunityHubWhere()))
    .limit(1);
  return row ?? null;
}

/** True when the user is a live (not left, not banned) member of the hub. */
export async function isLiveHubMember(
  db: Db,
  guildId: number,
  userId: number,
): Promise<boolean> {
  const row = await findMembership(db, guildId, userId);
  return row !== null && row.leftAt === null && row.bannedAt === null;
}

/**
 * True when the user is a live member of the hub or staff (operator/admin) —
 * the P1 membership rule (`leftAt`/`bannedAt` null) with the staff bypass.
 */
export async function isLiveHubMemberOrStaff(
  db: Db,
  guildId: number,
  userId: number,
): Promise<boolean> {
  if (await isLiveHubMember(db, guildId, userId)) return true;
  const [user] = await db
    .select({ role: schema.users.role })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return user?.role === 'admin' || user?.role === 'operator';
}

/**
 * D15: a poll may be tagged to a hub only when the hub is a visible poll hub
 * for the poll's game, and the caller is a member (by the hub's kind) or staff.
 */
export async function assertCanTagPollToHub(
  db: Db,
  hub: { hubId: number; gameId: number },
  caller: { userId: number; isStaff: boolean },
  isMember: HubMemberCheck,
): Promise<void> {
  const { hubId, gameId } = hub;
  const { userId, isStaff } = caller;
  const found = await findVisiblePollHub(db, hubId);
  if (!found) {
    throw new BadRequestException('That hub is not open for polls');
  }
  if (found.gameId !== gameId) {
    throw new BadRequestException("The poll's game must match the hub's game");
  }
  if (!isStaff && !(await isMember(userId, hubId))) {
    throw new ForbiddenException(
      'Only members of this hub can tag a poll to it',
    );
  }
}

/** The event's hub id when it is a visible community hub (reschedule inherit). */
export async function findEventVisibleHubId(
  db: Db,
  eventId: number,
  gameId: number,
): Promise<number | null> {
  const [row] = await db
    .select({ id: g.id })
    .from(schema.events)
    .innerJoin(g, eq(g.id, schema.events.guildId))
    .where(
      and(
        eq(schema.events.id, eventId),
        eq(g.gameId, gameId),
        visibleCommunityHubWhere(),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

/**
 * The hub a new poll is stored with: a reschedule poll copies its event's
 * visible hub when that hub is for the poll's game (else none); otherwise the validated `hubId`, or null when untagged.
 */
export async function resolvePollHubId(
  db: Db,
  input: { gameId: number; hubId?: number; linkedEventId?: number },
  caller: { userId: number; isStaff: boolean },
  isMember: HubMemberCheck,
): Promise<number | null> {
  if (input.linkedEventId !== undefined) {
    return findEventVisibleHubId(db, input.linkedEventId, input.gameId);
  }
  if (input.hubId === undefined) return null;
  const hub = { hubId: input.hubId, gameId: input.gameId };
  await assertCanTagPollToHub(db, hub, caller, isMember);
  return input.hubId;
}

/**
 * D16: the visible hub of the poll behind a scheduling match, for an event
 * created from that poll's match. Null when untagged or the hub is hidden.
 */
export async function findMatchPollHub(
  db: Db,
  matchId: number,
): Promise<PollHub | null> {
  const [row] = await db
    .select(pollHubColumns)
    .from(schema.communityLineupMatches)
    .innerJoin(
      schema.communityLineups,
      eq(schema.communityLineups.id, schema.communityLineupMatches.lineupId),
    )
    .innerJoin(g, eq(g.id, schema.communityLineups.guildId))
    .where(
      and(
        eq(schema.communityLineupMatches.id, matchId),
        visibleCommunityHubWhere(),
      ),
    )
    .limit(1);
  return row ?? null;
}
