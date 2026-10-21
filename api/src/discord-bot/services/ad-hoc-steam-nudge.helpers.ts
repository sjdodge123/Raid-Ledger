/**
 * ROK-1888 L4 (ruling 2) — who gets the Steam-link nudge. An open voice row
 * on a live / grace ad-hoc event that also holds ≥1 OPEN unlinked server row,
 * belonging to an active RL member with Discord linked and no Steam.
 */
import {
  and,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  sql,
  type SQL,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { UNLINKED_SERVER_ROW_SQL } from './ad-hoc-unlinked-row.sql';

type Db = PostgresJsDatabase<typeof schema>;
const p = schema.adHocParticipants;
const e = schema.events;
const u = schema.users;

/** Cooldown: at most one nudge per user per 30 days (OQ6 ruling). */
export const QUICK_PLAY_STEAM_NUDGE_TTL_SECONDS = 30 * 24 * 3600;

/** Per-user dedup key — not per event (OQ6). */
export const quickPlaySteamNudgeKey = (userId: number): string =>
  `quick-play-steam-nudge:${userId}`;

export interface SteamNudgeTarget {
  userId: number;
  gameId: number | null;
  gameName: string | null;
}

/** The nudge DM copy (spec "Exact copy"). */
export function steamNudgeMessage(gameName: string | null): string {
  return `You're in a ${gameName ?? 'game'} Quick Play and a Steam player is on the game server. Link your Steam account so Raid Ledger can tell when that player is you and count you once.`;
}

const v = alias(p, 'nudge_voice');

/** An active RL member with Discord linked and no Steam (ACTIVE_MEMBER_SQL_AND). */
const NO_STEAM_ACTIVE_MEMBER = and(
  isNotNull(u.discordId),
  isNull(u.steamId),
  isNull(u.deactivatedAt),
  isNull(u.bannedAt),
  isNull(u.kickedAt),
);

/** A live / grace, non-cancelled ad-hoc event. */
const LIVE_AD_HOC = and(
  eq(e.isAdHoc, true),
  inArray(e.adHocStatus, ['live', 'grace_period']),
  isNull(e.cancelledAt),
);

/** The event holds at least one OPEN unlinked server row. */
function hasOpenUnlinkedRow(db: Db, eventId: number): SQL {
  return exists(
    db
      .select({ one: sql`1` })
      .from(p)
      .where(
        and(eq(p.eventId, eventId), isNull(p.leftAt), UNLINKED_SERVER_ROW_SQL),
      ),
  );
}

/** Open, in-voice Discord rows of `eventId`, optionally one Discord id. */
function openVoiceRows(eventId: number, discordUserId?: string) {
  return and(
    eq(v.eventId, eventId),
    isNotNull(v.discordUserId),
    discordUserId === undefined
      ? undefined
      : eq(v.discordUserId, discordUserId),
    eq(v.inVoice, true),
    isNull(v.leftAt),
  );
}

/**
 * Eligible voice members of `eventId`, narrowed to one Discord id when the
 * trigger was that member's own voice join.
 */
export async function findSteamNudgeTargets(
  db: Db,
  eventId: number,
  discordUserId?: string,
): Promise<SteamNudgeTarget[]> {
  return db
    .selectDistinct({
      userId: u.id,
      gameId: e.gameId,
      gameName: schema.games.name,
    })
    .from(v)
    .innerJoin(e, eq(e.id, v.eventId))
    .innerJoin(u, eq(u.id, v.userId))
    .leftJoin(schema.games, eq(schema.games.id, e.gameId))
    .where(
      and(
        openVoiceRows(eventId, discordUserId),
        NO_STEAM_ACTIVE_MEMBER,
        LIVE_AD_HOC,
        hasOpenUnlinkedRow(db, eventId),
      ),
    );
}
