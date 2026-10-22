/**
 * ROK-1888 — one live Quick Play per game across ALL voice channels.
 *
 * Once game X has a live (or in-grace) Quick Play anywhere, a member playing X
 * in any bound voice channel joins it, so the `minPlayers` threshold applies
 * only while no live event exists (operator ruling 3; ruling 1's threshold
 * math is unchanged). The spawn itself still runs under the per-game lock and
 * returns the live event (`createVoiceQuickPlay` -> `existing: true`).
 */
import type { VoiceHandlerDeps } from './voice-handler-deps';
import { findLiveQuickPlayGameIds } from '../services/ad-hoc-game-spawn-lock';

type LiveDeps = Pick<VoiceHandlerDeps, 'db'>;

/** The ids among `groups`' games that already have a live Quick Play. */
export async function liveGameIdsOf(
  deps: LiveDeps,
  groups: readonly { gameId: number | null }[],
): Promise<Set<number>> {
  const ids = groups.flatMap((g) => (g.gameId === null ? [] : [g.gameId]));
  if (!deps.db || ids.length === 0) return new Set();
  return findLiveQuickPlayGameIds(deps.db, ids);
}

/** Whether `gameId` already has a live Quick Play in any channel. */
export async function isGameLive(
  deps: LiveDeps,
  gameId: number | null | undefined,
): Promise<boolean> {
  if (gameId == null) return false;
  return (await liveGameIdsOf(deps, [{ gameId }])).has(gameId);
}

/**
 * Fixed-game bind bypass: at least one member CONFIRMED playing the bound game
 * and that game is live elsewhere. Presence-null members alone never bypass —
 * that would mint the ROK-1394 degraded null-game session for one person.
 */
export async function bypassesMinPlayers(
  deps: LiveDeps,
  binding: { gameId?: number | null },
  confirmedCount: number,
): Promise<boolean> {
  return confirmedCount > 0 && (await isGameLive(deps, binding.gameId));
}
