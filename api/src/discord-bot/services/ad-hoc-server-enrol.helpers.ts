/**
 * ROK-1821 (RCA F1) — enrolling a game's server players into its live Quick
 * Play. The voice threshold counts every player the Pelican TRACKER reports,
 * but enrolment used to drain only the eligible pending holds; a hold left
 * unconfirmed by a re-auth (ROK-1802) was counted yet never got a row, so a
 * voice leave made the event look empty. A live event now takes every player
 * the tracker reports for its game, plus the eligible holds, idempotently:
 * a player already open on any server of the game is skipped (no second
 * PARTICIPANT_JOINED, no duplicate row).
 */
import type { ModuleRef } from '@nestjs/core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import {
  SERVER_PRESENCE_READER,
  type ServerPresenceReader,
} from '../../plugins/pelican/presence/server-presence.reader';
import type {
  ServerPresencePlayer,
  ServerPresenceSource,
} from '../../plugins/pelican/presence/server-presence.sink';
import { getEventById } from './ad-hoc-event.helpers';
import type { PendingServerPlayers } from './ad-hoc-server-pending';
import {
  attachServerPlayer,
  type PresenceEffectsDeps,
} from './ad-hoc-server-presence.effects';
import {
  hasOpenServerPlayers,
  listOpenGameServerSteamIds,
  listOpenServerPresence,
  listServerEnrolledEvents,
  type LiveGameEvent,
} from './ad-hoc-server-presence.helpers';

/** What the enrol helpers need from `AdHocServerPresenceService`. */
export interface EnrolDeps {
  fx: PresenceEffectsDeps;
  pending: PendingServerPlayers;
  reader: ServerPresenceReader | null;
}

/**
 * The tracker, resolved at call time (review BLOCKER 1): the sink must not
 * constructor-inject it — sink -> reader -> supervisor -> sink is a DI cycle
 * that hangs Nest boot. Unbound (plugin absent) reads as no reader.
 */
export function lazyReader(
  moduleRef: ModuleRef | null,
): ServerPresenceReader | null {
  try {
    const opts = { strict: false };
    const r = moduleRef?.get<ServerPresenceReader>(
      SERVER_PRESENCE_READER,
      opts,
    );
    return r ?? null;
  } catch {
    return null;
  }
}

/** The tracker's players for `gameId`, grouped by Pelican server. */
export function trackedByServer(
  reader: ServerPresenceReader | null,
  gameId: number,
): Map<number, ServerPresencePlayer[]> {
  const out = new Map<number, ServerPresencePlayer[]>();
  for (const pl of reader?.playersForGame(gameId) ?? []) {
    const list = out.get(pl.pelicanServerId) ?? [];
    if (list.some((x) => x.steamId === pl.steamId)) continue;
    // The sink's own convention: the SteamID64 until a character line names them.
    list.push({ steamId: pl.steamId, displayName: pl.name ?? pl.steamId });
    out.set(pl.pelicanServerId, list);
  }
  return out;
}

/** True when the tracker reports anyone on a server of `gameId`. */
export function hasTrackedPlayers(
  reader: ServerPresenceReader | null,
  gameId: number,
): boolean {
  return (reader?.playersForGame(gameId).length ?? 0) > 0;
}

/** True when a held or tracker-reported player of `gameId` could enrol. */
export function hasAnyoneToEnrol(deps: EnrolDeps, gameId: number): boolean {
  if (deps.pending.hasGame(gameId)) return true;
  return hasTrackedPlayers(deps.reader, gameId);
}

/**
 * Attach every tracked player of `gameId` with no open on-server row to
 * `live`. Their holds are dropped: an enrolled player is no longer pending.
 * "Open" is GAME-wide (Codex r2 P2): any live event of the game, any server —
 * a player who moved servers before the old tracker saw the disconnect keeps
 * their row (re-attaching would overwrite its server), and a player the
 * tracker lists on two servers is attached once.
 */
export async function enrolTracked(
  deps: EnrolDeps,
  live: LiveGameEvent,
  gameId: number,
): Promise<void> {
  const open = new Set(await listOpenGameServerSteamIds(deps.fx.db, gameId));
  for (const [serverId, players] of trackedByServer(deps.reader, gameId)) {
    for (const pl of players) {
      deps.pending.remove(serverId, pl.steamId);
      if (open.has(pl.steamId)) continue;
      open.add(pl.steamId);
      await attachServerPlayer(deps.fx, live, serverId, pl);
    }
  }
}

/**
 * Attach `players` of `source` to `live`, skipping any already open on THIS
 * server in a live event of the game — e.g. enrolled by an earlier
 * `enrolGame` of the same replay — so a queued join never opens a second
 * session (Codex r3). A player open on ANOTHER server is attached: an
 * explicit join on B moves their row to B, so A's late leave is ignored
 * (Codex r4). Only the tracker path (`enrolTracked`) skips game-wide.
 */
export async function attachUnenrolled(
  fx: PresenceEffectsDeps,
  live: LiveGameEvent,
  source: ServerPresenceSource,
  players: ServerPresencePlayer[],
): Promise<void> {
  const open = new Set(
    await listOpenGameServerSteamIds(
      fx.db,
      source.gameId,
      source.pelicanServerId,
    ),
  );
  for (const pl of players)
    if (!open.has(pl.steamId))
      await attachServerPlayer(fx, live, source.pelicanServerId, pl);
}

/** Attach every server's eligible held players for `gameId` to `live`. */
export async function drainHeld(
  deps: EnrolDeps,
  gameId: number,
  live: LiveGameEvent,
  exceptServerId?: number,
): Promise<void> {
  for (const held of deps.pending.takeGame(gameId, exceptServerId))
    for (const pl of held.players)
      await attachServerPlayer(deps.fx, live, held.source.pelicanServerId, pl);
}

/** The held players, then everyone the tracker reports (RCA F1). */
export async function enrolGame(
  deps: EnrolDeps,
  gameId: number,
  live: LiveGameEvent,
  exceptServerId?: number,
): Promise<void> {
  await drainHeld(deps, gameId, live, exceptServerId);
  await enrolTracked(deps, live, gameId);
}

/** Open on-server rows for this server across its live events. */
export async function openServerRows(
  fx: PresenceEffectsDeps,
  gameId: number,
  pelicanServerId: number,
): Promise<ServerPresencePlayer[]> {
  const out: ServerPresencePlayer[] = [];
  for (const live of await listServerEnrolledEvents(
    fx.db,
    gameId,
    pelicanServerId,
  ))
    out.push(
      ...(await listOpenServerPresence(fx.db, live.id, pelicanServerId)),
    );
  return out;
}

/** `eventId` as a live (or in-grace) Quick Play of `gameId`, else null. */
export async function liveEventFor(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  gameId: number,
): Promise<LiveGameEvent | null> {
  const event = await getEventById(db, eventId);
  if (!event || event.cancelledAt || event.gameId !== gameId) return null;
  const { id, channelBindingId, adHocStatus } = event;
  if (adHocStatus !== 'live' && adHocStatus !== 'grace_period') return null;
  return { id, channelBindingId, adHocStatus };
}

/**
 * ROK-1821 voice-leave safety net: enrol the tracked players into `eventId`.
 * True only when it is still live and someone is open on a server afterwards
 * (review MAJOR 2: a player who left before this ran enrolled nobody).
 */
export async function enrolTrackerInto(
  deps: EnrolDeps,
  eventId: number,
  gameId: number,
): Promise<boolean> {
  const live = await liveEventFor(deps.fx.db, eventId, gameId);
  if (!live) return false;
  await enrolGame(deps, gameId, live);
  return hasOpenServerPlayers(deps.fx.db, live.id);
}
