/**
 * The group's live spawned session — ROK-1494 D9.
 *
 * Lives in `lfg/` rather than `discord-bot/lfg-now/` for two reasons: the
 * dependency direction is `discord-bot → lfg` (the spawn helpers already import
 * `lfg.constants` / `lfg-write.helpers`, never the reverse), and
 * `lfg-query.helpers.ts` is at 249/300 counted lines.
 *
 * {@link openLfgNowEventWhere} is the ONE definition of "the game's open
 * LFG-born event": the read side here and the spawn's one-event guard
 * (`lfg-now-spawn.helpers.ts::findOpenLfgNowEvent`) both use it, so a group
 * page can never disagree with the guard about whether a session is open.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { LfgPlayingNowDto } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import type { LfgDb } from './lfg-query.helpers';

/**
 * SQL predicate: the game's OPEN, LFG-born ad-hoc event.
 *
 * Provenance is a JOIN, not a column — an event qualifies only when some
 * `lfg_intents` row points at it, which is exactly the link the spawn writes.
 * Requires `events` AND `lfg_intents` to be joined into the query.
 *
 * @param gameId - Game whose session to resolve.
 */
export function openLfgNowEventWhere(gameId: number) {
  return and(
    eq(schema.events.gameId, gameId),
    eq(schema.events.isAdHoc, true),
    isNull(schema.events.cancelledAt),
    sql`${schema.events.adHocStatus} IN ('live', 'grace_period')`,
  );
}

/**
 * Build the voice deep link (A8). Null unless BOTH ids are known — the temp
 * channel is created after the spawn transaction commits, and an LFG group may
 * have no Discord post at all, so either half can legitimately be missing.
 *
 * @param guildId - Guild the group's LFM post lives in, or null.
 * @param channelId - Ephemeral voice channel id, or null.
 */
export function buildVoiceInviteUrl(
  guildId: string | null,
  channelId: string | null,
): string | null {
  if (!guildId || !channelId) return null;
  return `https://discord.com/channels/${guildId}/${channelId}`;
}

/** Live head-count: ad-hoc participants who have not left (A3's roster). */
function participantCountSql() {
  return sql<number>`(
    SELECT COUNT(*)::int FROM ad_hoc_participants p
    WHERE p.event_id = ${schema.events.id} AND p.left_at IS NULL
  )`;
}

/** The guild the game's LFM post lives in — the only guild id LFG can reach,
 * since an LFG-born event has `channel_binding_id IS NULL` by construction. */
function guildIdSql() {
  return sql<string | null>`(
    SELECT m.guild_id FROM lfg_group_messages m
    WHERE m.game_id = ${schema.events.gameId}
    ORDER BY m.posted_at DESC LIMIT 1
  )`;
}

/** The single round trip behind {@link readPlayingNow}. */
function selectOpenSession(db: LfgDb, gameId: number) {
  return db
    .select({
      eventId: schema.events.id,
      duration: schema.events.duration,
      voiceChannelId: schema.events.ephemeralVoiceChannelId,
      participantCount: participantCountSql(),
      guildId: guildIdSql(),
    })
    .from(schema.events)
    .innerJoin(
      schema.lfgIntents,
      eq(schema.lfgIntents.convertedToEventId, schema.events.id),
    )
    .where(openLfgNowEventWhere(gameId))
    .limit(1);
}

/**
 * `GET /lfg/:gameId` — the group's open session, or null.
 *
 * @param db - Drizzle handle.
 * @param gameId - Game whose group is being read.
 * @returns The playing-now projection, or null for weekly / unspawned groups.
 */
export async function readPlayingNow(
  db: LfgDb,
  gameId: number,
): Promise<LfgPlayingNowDto | null> {
  const [row] = await selectOpenSession(db, gameId);
  if (!row) return null;
  return {
    eventId: row.eventId,
    startsAt: row.duration[0].toISOString(),
    voiceChannelId: row.voiceChannelId ?? null,
    voiceInviteUrl: buildVoiceInviteUrl(
      row.guildId ?? null,
      row.voiceChannelId ?? null,
    ),
    participantCount: Number(row.participantCount ?? 0),
  };
}
