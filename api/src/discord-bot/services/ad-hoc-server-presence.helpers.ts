/**
 * ROK-1800 — DB reads/writes for the game-server (Pelican) side of Quick Play.
 *
 * One Quick Play per GAME: a server join attaches to whatever live ad-hoc
 * event exists for the game (voice- or server-born). The thresholds and grace
 * come from the game's voice-monitor binding when there is one, so a server
 * and a bound voice channel share one set of Quick Play settings.
 */
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { ServerPresencePlayer } from '../../plugins/pelican/presence/server-presence.sink';

type Db = PostgresJsDatabase<typeof schema>;
const p = schema.adHocParticipants;

/** Voice path's default when a binding sets no `minPlayers`. */
export const DEFAULT_SERVER_MIN_PLAYERS = 2;

/** The spawn source key a server-born receipt is bound to (spike Q4.1). */
export function serverSourceKey(pelicanServerId: number): string {
  return `pelican:${pelicanServerId}`;
}

export interface LiveGameEvent {
  id: number;
  channelBindingId: string | null;
  adHocStatus: string | null;
}

const e = schema.events;
const liveEventCols = {
  id: e.id,
  channelBindingId: e.channelBindingId,
  adHocStatus: e.adHocStatus,
};
const liveGameWhere = (gameId: number) =>
  and(
    eq(e.isAdHoc, true),
    eq(e.gameId, gameId),
    inArray(e.adHocStatus, ['live', 'grace_period']),
    isNull(e.cancelledAt),
  );

/**
 * Codex r2: the live event this player is ENROLLED in on a server — not the
 * game's newest event, which may be a separate binding's Quick Play.
 */
export async function findServerEnrolledEvent(
  db: Db,
  gameId: number,
  steamId: string,
  pelicanServerId: number,
): Promise<LiveGameEvent | null> {
  const rows = await db
    .select(liveEventCols)
    .from(e)
    .innerJoin(p, eq(p.eventId, e.id))
    .where(
      and(
        liveGameWhere(gameId),
        eq(p.steamId, steamId),
        // Codex r3: a player who moved servers is no longer this server's.
        eq(p.pelicanServerId, pelicanServerId),
        eq(p.onServer, true),
        isNull(p.leftAt),
      ),
    )
    .orderBy(desc(e.id))
    .limit(1);
  return rows[0] ?? null;
}

/** Every live event holding an open row on THIS server (Codex r2). */
export async function listServerEnrolledEvents(
  db: Db,
  gameId: number,
  pelicanServerId: number,
): Promise<LiveGameEvent[]> {
  return db
    .selectDistinct(liveEventCols)
    .from(e)
    .innerJoin(p, eq(p.eventId, e.id))
    .where(
      and(
        liveGameWhere(gameId),
        eq(p.pelicanServerId, pelicanServerId),
        eq(p.onServer, true),
        isNull(p.leftAt),
      ),
    )
    .orderBy(asc(e.id));
}

/** The game's live (or in-grace) ad-hoc event, whatever spawned it. */
export async function findLiveGameAdHocEvent(
  db: Db,
  gameId: number,
): Promise<LiveGameEvent | null> {
  const rows = await db
    .select(liveEventCols)
    .from(e)
    .where(liveGameWhere(gameId))
    .orderBy(desc(e.id))
    .limit(1);
  return rows[0] ?? null;
}

export interface GameQuickPlayBinding {
  id: string;
  config: { minPlayers?: number; gracePeriod?: number } | null;
}

/** The game's voice-monitor (Quick Play) binding, oldest first. */
export async function findGameVoiceBinding(
  db: Db,
  gameId: number,
): Promise<GameQuickPlayBinding | null> {
  const cb = schema.channelBindings;
  const rows = await db
    .select({ id: cb.id, config: cb.config })
    .from(cb)
    .where(
      and(eq(cb.gameId, gameId), eq(cb.bindingPurpose, 'game-voice-monitor')),
    )
    .orderBy(asc(cb.createdAt))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, config: row.config as GameQuickPlayBinding['config'] };
}

export interface SteamIdentity {
  userId: number;
  discordId: string | null;
  /** The RL name a linked player shows as: `display_name`, else `username`. */
  displayName: string;
}

/** SteamID64 → the linked RL user (`users.steam_id`), if any. */
export async function resolveSteamIdentity(
  db: Db,
  steamId: string,
): Promise<SteamIdentity | null> {
  const u = schema.users;
  const rows = await db
    .select({
      userId: u.id,
      discordId: u.discordId,
      displayName: sql<string>`coalesce(${u.displayName}, ${u.username})`,
    })
    .from(u)
    .where(eq(u.steamId, steamId))
    .limit(1);
  return rows[0] ?? null;
}

/** SteamIDs of every row still on THIS server — merged voice rows included. */
export async function listOnServerSteamIds(
  db: Db,
  eventId: number,
  pelicanServerId: number,
): Promise<string[]> {
  const rows = await db
    .select({ steamId: p.steamId })
    .from(p)
    .where(
      and(
        eq(p.eventId, eventId),
        eq(p.pelicanServerId, pelicanServerId),
        eq(p.onServer, true),
        isNull(p.leftAt),
      ),
    );
  return rows.flatMap((r) => (r.steamId ? [r.steamId] : []));
}

/**
 * Whether anyone is still on the server — linked (merged) rows included —
 * so a voice leave must not start grace.
 * An indexed read (`rows[0]`) on purpose: the voice-path unit specs' drizzle
 * chain mock resolves `limit` to a non-array, which reads as "none open".
 */
export async function hasOpenServerPlayers(
  db: Db,
  eventId: number,
): Promise<boolean> {
  const rows = await db
    .select({ id: p.id })
    .from(p)
    .where(and(eq(p.eventId, eventId), eq(p.onServer, true), isNull(p.leftAt)))
    .limit(1);
  return rows[0] !== undefined;
}

/**
 * Codex r2 P1: open rows held by a game server ALONE (not also in voice) —
 * the attendance the voice tracker cannot see, so auto-extend adds it.
 */
export async function countServerOnlyPresence(
  db: Db,
  eventId: number,
): Promise<number> {
  const rows = await db
    .select({ id: p.id })
    .from(p)
    .where(
      and(
        eq(p.eventId, eventId),
        eq(p.onServer, true),
        eq(p.inVoice, false),
        isNull(p.leftAt),
      ),
    );
  return rows.length;
}

/**
 * Open rows still on THIS server — the rehydrate set for its session. Only an
 * unlinked row's name is a character name; a linked or merged row's is the
 * RL/Discord name (ROK-1821), so it rehydrates as its SteamID — nameless to
 * the tracker until the next character line names it (Codex r3).
 */
export async function listOpenServerPresence(
  db: Db,
  eventId: number,
  pelicanServerId: number,
): Promise<ServerPresencePlayer[]> {
  const rows = await db
    .select({
      steamId: p.steamId,
      displayName: p.discordUsername,
      userId: p.userId,
      discordUserId: p.discordUserId,
    })
    .from(p)
    .where(
      and(
        eq(p.eventId, eventId),
        eq(p.pelicanServerId, pelicanServerId),
        eq(p.onServer, true),
        isNull(p.leftAt),
      ),
    );
  return rows.flatMap((r) => {
    if (!r.steamId) return [];
    const named = r.userId === null && r.discordUserId === null;
    return [
      { steamId: r.steamId, displayName: named ? r.displayName : r.steamId },
    ];
  });
}

/**
 * Codex r2 P2: SteamIDs with an open on-server row in ANY live event of the
 * game, on ANY server — a player who moved servers keeps their enrolment.
 */
export async function listOpenGameServerSteamIds(
  db: Db,
  gameId: number,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ steamId: p.steamId })
    .from(p)
    .innerJoin(e, eq(p.eventId, e.id))
    .where(and(liveGameWhere(gameId), eq(p.onServer, true), isNull(p.leftAt)));
  return rows.flatMap((r) => (r.steamId ? [r.steamId] : []));
}

/**
 * A character line named a Steam-only player: refresh their shown name.
 * Unlinked rows only — a linked row shows the RL user (ROK-1821).
 */
export async function renameSteamOnlyRow(
  db: Db,
  eventId: number,
  player: ServerPresencePlayer,
): Promise<void> {
  await db
    .update(p)
    .set({ discordUsername: player.displayName })
    .where(
      and(
        eq(p.eventId, eventId),
        eq(p.steamId, player.steamId),
        isNull(p.discordUserId),
        isNull(p.userId),
      ),
    );
}
