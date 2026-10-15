/**
 * ROK-1800 — DB reads/writes for the game-server (Pelican) side of Quick Play.
 *
 * One Quick Play per GAME: a server join attaches to whatever live ad-hoc
 * event exists for the game (voice- or server-born). The thresholds and grace
 * come from the game's voice-monitor binding when there is one, so a server
 * and a bound voice channel share one set of Quick Play settings.
 */
import { and, asc, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
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

/** The game's live (or in-grace) ad-hoc event, whatever spawned it. */
export async function findLiveGameAdHocEvent(
  db: Db,
  gameId: number,
): Promise<LiveGameEvent | null> {
  const e = schema.events;
  const rows = await db
    .select({
      id: e.id,
      channelBindingId: e.channelBindingId,
      adHocStatus: e.adHocStatus,
    })
    .from(e)
    .where(
      and(
        eq(e.isAdHoc, true),
        eq(e.gameId, gameId),
        inArray(e.adHocStatus, ['live', 'grace_period']),
        isNull(e.cancelledAt),
      ),
    )
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
}

/** SteamID64 → the linked RL user (`users.steam_id`), if any. */
export async function resolveSteamIdentity(
  db: Db,
  steamId: string,
): Promise<SteamIdentity | null> {
  const u = schema.users;
  const rows = await db
    .select({ userId: u.id, discordId: u.discordId })
    .from(u)
    .where(eq(u.steamId, steamId))
    .limit(1);
  return rows[0] ?? null;
}

/** Steam-only rows still open on the event (the server's present players). */
export async function listOpenSteamOnlyIds(
  db: Db,
  eventId: number,
): Promise<string[]> {
  const rows = await db
    .select({ steamId: p.steamId })
    .from(p)
    .where(
      and(
        eq(p.eventId, eventId),
        isNotNull(p.steamId),
        isNull(p.discordUserId),
        isNull(p.leftAt),
      ),
    );
  return rows.flatMap((r) => (r.steamId ? [r.steamId] : []));
}

/**
 * Whether any Steam-only row is still open — voice leave must not start grace.
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
    .where(
      and(
        eq(p.eventId, eventId),
        isNotNull(p.steamId),
        isNull(p.discordUserId),
        isNull(p.leftAt),
      ),
    )
    .limit(1);
  return rows[0] !== undefined;
}

/** Open rows carrying a SteamID — the rehydrate set for the supervisor. */
export async function listOpenServerPresence(
  db: Db,
  eventId: number,
): Promise<ServerPresencePlayer[]> {
  const rows = await db
    .select({ steamId: p.steamId, displayName: p.discordUsername })
    .from(p)
    .where(and(eq(p.eventId, eventId), isNotNull(p.steamId), isNull(p.leftAt)));
  return rows.flatMap((r) =>
    r.steamId ? [{ steamId: r.steamId, displayName: r.displayName }] : [],
  );
}

/** A character line named a Steam-only player: refresh their shown name. */
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
      ),
    );
}
