/**
 * ROK-1446 D12 — the DEMO_MODE seam's stand-in for the Discord read.
 *
 * Split out of `channel-presence-room.helpers.ts` purely for the 300-line cap;
 * this is the ONLY part of `resolveRoom` an override replaces. Everything the
 * caller does with the result — threshold partition, linked-event lookup,
 * roster union, render, post/edit, persistence, close — still runs for real.
 *
 * Bots are unreachable from here by construction: a snapshot member has no
 * `user.bot` flag to smuggle, so the seam cannot weaken the AC3 filter that
 * `humanMembers` applies on the live path.
 */
import { inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { LobbyGameGroup } from '../listeners/voice-lobby-groups.helpers';

/** Name a group falls back to when no game resolved (presence-detector parity). */
export const UNRESOLVED_GAME_NAME = 'Untitled Gaming Session';

/**
 * One human occupant of a bound lobby channel, as the DEMO_MODE seam supplies
 * it (D12). This is deliberately the POST-detection shape: `gameId` is what
 * presence detection would have resolved, so an override can stand in for the
 * Discord read without carrying a `user.bot` flag — which is why the override
 * can never sneak a bot onto the embed (AC3).
 */
export interface RoomMemberSnapshot {
  discordUserId: string;
  /** Rendered name — rosters are bold plain text, never `<@id>` mentions. */
  displayName: string;
  /** `null` = presence produced no game ("in channel · no game detected"). */
  gameId: number | null;
  /** Links this member's game group to an existing ad-hoc event (D12). */
  eventId?: number;
}

/**
 * A stand-in for the Discord read + detection step of `resolveRoom` (D12).
 *
 * `members: []` means an empty room (the recap path); passing `null` to
 * `setRoomOverride` clears the override entirely.
 */
export interface RoomSnapshot {
  members: RoomMemberSnapshot[];
}

/** The output of the step the DEMO_MODE override replaces. */
export interface RoomSource {
  /** Human occupants — bots excluded (AC3). */
  memberCount: number;
  /** discordUserId → rendered display name. */
  names: Map<string, string>;
  detected: LobbyGameGroup[];
  /** D12 seam only: discordUserId → the event id that member declared. */
  eventHints: Map<string, number>;
}

/** Turn a seam snapshot into the same shape live detection produces. */
export async function snapshotSource(
  db: PostgresJsDatabase<typeof schema>,
  snapshot: RoomSnapshot,
): Promise<RoomSource> {
  const names = new Map(
    snapshot.members.map((m) => [m.discordUserId, m.displayName]),
  );
  const eventHints = new Map<string, number>();
  for (const m of snapshot.members) {
    if (m.eventId !== undefined) eventHints.set(m.discordUserId, m.eventId);
  }
  const gameNames = await fetchGameNames(db, snapshot.members);
  return {
    memberCount: snapshot.members.length,
    names,
    detected: groupSnapshotMembers(snapshot.members, gameNames),
    eventHints,
  };
}

/** Resolve display names for the games a snapshot names, by id. */
async function fetchGameNames(
  db: PostgresJsDatabase<typeof schema>,
  members: RoomMemberSnapshot[],
): Promise<Map<number, string>> {
  const ids = [
    ...new Set(
      members.map((m) => m.gameId).filter((id): id is number => id !== null),
    ),
  ];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: schema.games.id, name: schema.games.name })
    .from(schema.games)
    .where(inArray(schema.games.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/**
 * Group snapshot members by game, mirroring `applyConsensus`: one group per
 * game in first-seen order, at most one null group, and it goes last.
 */
function groupSnapshotMembers(
  members: RoomMemberSnapshot[],
  gameNames: Map<number, string>,
): LobbyGameGroup[] {
  const byGame = new Map<number, LobbyGameGroup>();
  const nullIds: string[] = [];
  for (const m of members) {
    if (m.gameId === null) {
      nullIds.push(m.discordUserId);
      continue;
    }
    const existing = byGame.get(m.gameId);
    if (existing) existing.memberIds.push(m.discordUserId);
    else
      byGame.set(m.gameId, {
        gameId: m.gameId,
        gameName: gameNames.get(m.gameId) ?? UNRESOLVED_GAME_NAME,
        memberIds: [m.discordUserId],
      });
  }
  const groups = [...byGame.values()];
  if (nullIds.length === 0) return groups;
  return [
    ...groups,
    { gameId: null, gameName: UNRESOLVED_GAME_NAME, memberIds: nullIds },
  ];
}
