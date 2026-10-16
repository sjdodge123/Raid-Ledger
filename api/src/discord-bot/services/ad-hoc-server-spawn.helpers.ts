/**
 * ROK-1800 — the game-server path's spawn, atomic and game-serialised.
 *
 * Find-live-or-create runs under the game's spawn lock (shared with the voice
 * path), and the event row plus every enrolled player commit in ONE
 * transaction: an enrol failure can no longer leave a live Quick Play with
 * zero participants.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import type { ServerPresencePlayer } from '../../plugins/pelican/presence/server-presence.sink';
import { createAdHocEventRow, findAdminFallback } from './ad-hoc-event.helpers';
import { withGameSpawnLock } from './ad-hoc-game-spawn-lock';
import {
  findLiveGameAdHocEvent,
  resolveSteamIdentity,
  type LiveGameEvent,
  type SteamIdentity,
} from './ad-hoc-server-presence.helpers';
import { upsertSteamParticipant } from './ad-hoc-steam-participant.helpers';
import { signupLinkedServerPlayer } from './ad-hoc-server-signup.helpers';

type Db = PostgresJsDatabase<typeof schema>;

export interface ServerSpawnInput {
  gameId: number;
  pelicanServerId: number;
  bindingId: string | null;
  creatorId: number;
  players: ServerPresencePlayer[];
  ids: (SteamIdentity | null)[];
}

/**
 * Identities and creator for a server-born spawn: the first linked player
 * owns it, else the admin fallback; `null` when nobody can.
 */
export async function buildServerSpawnInput(
  db: Db,
  source: { gameId: number; pelicanServerId: number },
  bindingId: string | null,
  players: ServerPresencePlayer[],
): Promise<ServerSpawnInput | null> {
  const ids = await Promise.all(
    players.map((pl) => resolveSteamIdentity(db, pl.steamId)),
  );
  const creatorId =
    ids.find((i) => i !== null)?.userId ?? (await findAdminFallback(db));
  if (!creatorId) return null;
  const { gameId, pelicanServerId } = source;
  return { gameId, pelicanServerId, bindingId, creatorId, players, ids };
}

export type ServerSpawnResult =
  | { kind: 'existing'; live: LiveGameEvent }
  /** `joined`: user ids of the genuinely new participations. */
  | { kind: 'created'; eventId: number; joined: (number | null)[] };

/** Join the game's live Quick Play if one exists, else create + enrol. */
export async function spawnOrFindServerQuickPlay(
  db: Db,
  input: ServerSpawnInput,
): Promise<ServerSpawnResult> {
  return withGameSpawnLock(db, input.gameId, async (tx) => {
    const live = await findLiveGameAdHocEvent(tx, input.gameId);
    if (live) return { kind: 'existing', live };
    const eventId = await createAdHocEventRow(
      tx,
      input.bindingId,
      { gameId: input.gameId },
      input.creatorId,
    );
    const joined = await enrolOn(tx, eventId, input);
    return { kind: 'created', eventId, joined };
  });
}

/** Enrol on the spawn's own tx: the new event is invisible to anyone else. */
async function enrolOn(
  tx: Db,
  eventId: number,
  input: ServerSpawnInput,
): Promise<(number | null)[]> {
  const joined: (number | null)[] = [];
  for (const [i, pl] of input.players.entries()) {
    const userId = input.ids[i]?.userId ?? null;
    const outcome = await upsertSteamParticipant(tx, eventId, {
      steamId: pl.steamId,
      displayName: pl.displayName,
      userId,
      pelicanServerId: input.pelicanServerId,
    });
    if (outcome === 'inserted') joined.push(userId);
    // ROK-1802: a linked player is signed up in the same transaction.
    await signupLinkedServerPlayer(tx, eventId, userId);
  }
  return joined;
}

/**
 * The spawn card's roster: EVERY enrolled player, linked or not. A linked
 * player shows by their Raid Ledger name; an unlinked one by character name
 * (spike ruling) with no Discord id.
 */
export function spawnRoster(
  players: ServerPresencePlayer[],
  ids: (SteamIdentity | null)[],
): { discordUserId: string | null; discordUsername: string }[] {
  return players.map((pl, i) => ({
    discordUserId: ids[i]?.discordId ?? null,
    discordUsername: ids[i]?.displayName ?? pl.displayName,
  }));
}
