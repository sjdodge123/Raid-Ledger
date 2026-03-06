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

/** Apply consensus logic to game groups. */
export function applyConsensus(
  groups: Map<string, DetectedGameGroup>,
  members: GuildMember[],
): DetectedGameGroup[] {
  const allIds = members.map((m) => m.id);
  const groupArray = [...groups.values()];

  const majority = groupArray.find(
    (g) => g.memberIds.length > members.length / 2 && g.gameId !== null,
  );
  if (majority) {
    return [
      {
        gameId: majority.gameId,
        gameName: majority.gameName,
        memberIds: allIds,
      },
    ];
  }

  if (groupArray.every((g) => g.gameId === null)) {
    return [{ ...FALLBACK_GROUP, memberIds: allIds }];
  }

  return mergeNoGameIntoLargest(groupArray, allIds);
}

/** Merge no-game members into the largest game group. */
function mergeNoGameIntoLargest(
  groupArray: DetectedGameGroup[],
  allIds: string[],
): DetectedGameGroup[] {
  const gameGroups = groupArray.filter((g) => g.gameId !== null);
  if (gameGroups.length === 0) {
    return [{ ...FALLBACK_GROUP, memberIds: allIds }];
  }
  const noGameMembers = groupArray
    .filter((g) => g.gameId === null)
    .flatMap((g) => g.memberIds);
  if (noGameMembers.length > 0) {
    const largest = gameGroups.reduce((a, b) =>
      a.memberIds.length >= b.memberIds.length ? a : b,
    );
    largest.memberIds.push(...noGameMembers);
  }
  return gameGroups;
}
