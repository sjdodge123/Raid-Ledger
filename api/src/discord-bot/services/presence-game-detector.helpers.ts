import type { GuildMember } from 'discord.js';
import type { DetectedGameGroup } from './presence-game-detector.service';

const FALLBACK_GROUP: DetectedGameGroup = {
  gameId: null,
  gameName: 'Untitled Gaming Session',
  memberIds: [],
};

/** Group members by resolved game. */
export function groupByGame(
  gamesByMember: Map<string, { gameId: number | null; gameName: string }>,
): Map<string, DetectedGameGroup> {
  const groups = new Map<string, DetectedGameGroup>();
  for (const [memberId, game] of gamesByMember) {
    const key =
      game.gameId !== null ? `id:${game.gameId}` : `name:${game.gameName}`;
    const existing = groups.get(key);
    if (existing) {
      existing.memberIds.push(memberId);
    } else {
      groups.set(key, { ...game, memberIds: [memberId] });
    }
  }
  return groups;
}

/**
 * Split members into one group per detected game (ROK-1445).
 *
 * Previously a strict majority collapsed EVERY member into a single group
 * carrying `allIds`, so 3 CoD4 + 2 Deep Rock became one CoD4 event holding all
 * five — silently attributing the Deep Rock pair to CoD4. ROK-1445 outlaws that
 * mis-attribution: every detected game keeps its OWN members and stands or
 * falls on its own count against `minPlayers`.
 *
 * Presence-null members are likewise no longer folded into the largest game
 * group; they are returned as at most ONE null group for the caller to
 * interpret (`allowJustChatting` decides downstream whether it becomes an
 * event). Callers: `detectGames`, whose only production call site is
 * `handleGeneralLobbyGroupDetection` — so this is scoped to general-lobby and
 * cannot leak into game-specific bindings (AC12).
 */
export function applyConsensus(
  groups: Map<string, DetectedGameGroup>,
  members: GuildMember[],
): DetectedGameGroup[] {
  if (members.length === 0) return [];
  const groupArray = [...groups.values()];
  const gameGroups = groupArray.filter((g) => g.gameId !== null);
  const nullGroups = groupArray.filter((g) => g.gameId === null);
  if (gameGroups.length === 0) return [collapseNullGroups(nullGroups)];
  if (nullGroups.length === 0) return gameGroups;
  return [...gameGroups, collapseNullGroups(nullGroups)];
}

/**
 * Reduce every no-game group to a single null group. Multiple null groups only
 * arise when unresolvable activity names fall through game resolution; they are
 * all "no detected game" as far as the lobby threshold is concerned.
 */
function collapseNullGroups(
  nullGroups: DetectedGameGroup[],
): DetectedGameGroup {
  if (nullGroups.length === 1) return nullGroups[0];
  return {
    ...FALLBACK_GROUP,
    memberIds: nullGroups.flatMap((g) => g.memberIds),
  };
}
