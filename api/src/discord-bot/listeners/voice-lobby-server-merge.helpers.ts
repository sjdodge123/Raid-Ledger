/**
 * ROK-1801 layer B — fold game-server presence into lobby game groups.
 *
 * One pure merge used by BOTH the presence card and the spawn gate, so the
 * card's READY/NEEDS math and the threshold can never disagree (Lead L3).
 * Operator rulings implemented here:
 * - a voice member on game G's server plays G — server presence beats a
 *   conflicting rich-presence game and lifts them out of "no game detected";
 * - a server player not in this voice channel is listed in G's group and
 *   counted toward its threshold; a group may consist of server players only
 *   (Q1); an unnamed unlinked player is counted anonymously (Q4);
 * - each person is counted once (ruling 4).
 */
import type { LobbyGameGroup } from './voice-lobby-groups.helpers';
import type {
  ServerRoster,
  ServerRosterEntry,
} from '../services/server-presence-roster.helpers';

/** Members a group would enrol: voice members plus server-only players. */
export function groupSize(group: LobbyGameGroup): number {
  return group.memberIds.length + (group.serverOnly?.length ?? 0);
}

/** Server-only players split for rendering: names, then `+N on server`. */
export function serverOnlySummary(group: LobbyGameGroup): {
  named: string[];
  anonymousCount: number;
} {
  const players = group.serverOnly ?? [];
  const named = players.flatMap((p) => (p.name === null ? [] : [p.name]));
  return { named, anonymousCount: players.length - named.length };
}

/** The game whose server a voice member is on; lowest game id if several. */
export function serverGameOf(
  roster: ServerRoster,
  discordUserId: string,
): number | null {
  const gameIds = [...roster.byGame.keys()].sort((a, b) => a - b);
  const hit = gameIds.find((id) =>
    roster.byGame.get(id)?.some((e) => e.discordUserId === discordUserId),
  );
  return hit ?? null;
}

function cloneGroup(group: LobbyGameGroup): LobbyGameGroup {
  return {
    ...group,
    memberIds: [...group.memberIds],
    ...(group.onServerIds ? { onServerIds: [...group.onServerIds] } : {}),
    ...(group.serverOnly ? { serverOnly: [...group.serverOnly] } : {}),
  };
}

function groupFor(
  groups: LobbyGameGroup[],
  gameId: number,
  roster: ServerRoster,
): LobbyGameGroup {
  const found = groups.find((g) => g.gameId === gameId);
  if (found) return found;
  const gameName = roster.gameNames.get(gameId) ?? 'Unknown game';
  const created: LobbyGameGroup = { gameId, gameName, memberIds: [] };
  groups.push(created);
  return created;
}

/** Ruling 2: move each voice member on a server into that game's group. */
function moveVoiceMembers(
  groups: LobbyGameGroup[],
  voiceIds: string[],
  roster: ServerRoster,
): void {
  for (const id of voiceIds) {
    const gameId = serverGameOf(roster, id);
    if (gameId === null) continue;
    for (const g of groups)
      if (g.gameId !== gameId)
        g.memberIds = g.memberIds.filter((m) => m !== id);
    const target = groupFor(groups, gameId, roster);
    if (!target.memberIds.includes(id)) target.memberIds.push(id);
    target.onServerIds = [...(target.onServerIds ?? []), id];
  }
}

function notInVoice(entry: ServerRosterEntry, voice: Set<string>): boolean {
  return entry.discordUserId === null || !voice.has(entry.discordUserId);
}

/** Ruling 3 + Q1: server players not in this channel join G's group. */
function addServerOnly(
  groups: LobbyGameGroup[],
  voiceIds: string[],
  roster: ServerRoster,
): void {
  const voice = new Set(voiceIds);
  const gameIds = [...roster.byGame.keys()].sort((a, b) => a - b);
  for (const gameId of gameIds) {
    const off = (roster.byGame.get(gameId) ?? []).filter((e) =>
      notInVoice(e, voice),
    );
    if (off.length === 0) continue;
    const group = groupFor(groups, gameId, roster);
    group.serverOnly = [...(group.serverOnly ?? []), ...off];
  }
}

/**
 * Merge the server roster into detected lobby groups. `voiceIds` are the
 * human members in the channel. Groups emptied by the move (typically the
 * null "no game detected" group) are dropped. Empty roster → `detected`
 * returned as-is, so a lobby without the Pelican plugin is unchanged (AC9).
 */
export function mergeServerPresence(
  detected: LobbyGameGroup[],
  voiceIds: string[],
  roster: ServerRoster,
): LobbyGameGroup[] {
  if (roster.byGame.size === 0) return detected;
  const groups = detected.map(cloneGroup);
  moveVoiceMembers(groups, voiceIds, roster);
  addServerOnly(groups, voiceIds, roster);
  return groups.filter((g) => groupSize(g) > 0);
}
