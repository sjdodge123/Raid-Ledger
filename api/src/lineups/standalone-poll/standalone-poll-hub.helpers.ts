/**
 * ROK-1893 P3 — hub-tagged scheduling polls.
 *
 * A poll may be tagged to a community hub (`community_lineups.guild_id`). The
 * tag is only honoured while the hub is VISIBLE: a `game_community` hub that
 * is `active` and not hidden. A hidden / archived hub drops out of every read
 * (poll page, active list, hub list) without the stored id being cleared.
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { and, eq, isNull, type SQL } from 'drizzle-orm';
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

/** The "visible community hub" predicate on `guilds`. */
export function visibleCommunityHubWhere(): SQL | undefined {
  return and(
    eq(g.kind, 'game_community'),
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
 * D15: a poll may be tagged to a hub only when the hub is a visible community
 * hub for the poll's game, and the caller is a live member or staff.
 */
export async function assertCanTagPollToHub(
  db: Db,
  hubId: number,
  gameId: number,
  userId: number,
  isStaff: boolean,
): Promise<void> {
  const hub = await findVisiblePollHub(db, hubId);
  if (!hub) {
    throw new BadRequestException('That hub is not open for polls');
  }
  if (hub.gameId !== gameId) {
    throw new BadRequestException("The poll's game must match the hub's game");
  }
  if (!isStaff && !(await isLiveHubMember(db, hubId, userId))) {
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
  userId: number,
  isStaff: boolean,
): Promise<number | null> {
  if (input.linkedEventId !== undefined) {
    return findEventVisibleHubId(db, input.linkedEventId, input.gameId);
  }
  if (input.hubId === undefined) return null;
  await assertCanTagPollToHub(db, input.hubId, input.gameId, userId, isStaff);
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
