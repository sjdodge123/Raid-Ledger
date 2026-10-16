/**
 * ROK-1801 layer D — the voice path's threshold inputs with game-server
 * presence folded in (operator rulings Q9 and Q6).
 *
 * `serverAwareGameCount` replaces `getGameFilteredCount` at the two
 * game-bound call sites: it keeps the per-member detections the tally was
 * built from, which `withServerPresence` needs. `unanimousLobbySize` is the
 * general lobby's immediate-spawn check on MERGED detection (server wins).
 */
import type { GuildMember } from 'discord.js';
import type { ServerRoster } from '../services/server-presence-roster.helpers';
import type { VoiceHandlerDeps } from './voice-handler-deps';
import { serverGameOf } from './voice-lobby-server-merge.helpers';
import {
  resolveVoiceChannel,
  type ResolvedBinding,
} from './voice-state.helpers';
import {
  withServerPresence,
  type GameMemberTally,
  type VoiceDetection,
} from './voice-threshold-server.helpers';
import { countsTowardThreshold } from './voice-threshold-count.helpers';

/** Rich-presence detection for each member, in member order. */
async function detectAll(
  deps: VoiceHandlerDeps,
  members: GuildMember[],
): Promise<VoiceDetection[]> {
  return Promise.all(
    members.map(async (m) => ({
      memberId: m.id,
      gameId: (await deps.presenceDetector.detectGameForMember(m)).gameId,
    })),
  );
}

/** The pre-1801 `getGameFilteredCount` tally over known detections. */
function tallyOf(gameId: number, voice: VoiceDetection[]): GameMemberTally {
  let counted = 0;
  let confirmedCount = 0;
  for (const v of voice) {
    if (v.gameId !== null && v.gameId !== gameId) continue;
    counted++;
    if (v.gameId !== null) confirmedCount++;
  }
  return { counted, confirmedCount, allConfirmed: counted === confirmedCount };
}

/** Server players on `gameId` who are not one of `voiceIds` (each once). */
function serverOnlyCount(
  roster: ServerRoster,
  gameId: number,
  voiceIds: Set<string>,
): number {
  return (roster.byGame.get(gameId) ?? []).filter(
    (e) => e.discordUserId === null || !voiceIds.has(e.discordUserId),
  ).length;
}

/**
 * Game-bound threshold tally: human voice members plus the bound game's
 * server players, each person once (Q9). Bots count only when allowlisted
 * under DEMO_MODE (ROK-1711 `countsTowardThreshold`).
 */
export async function serverAwareGameCount(
  deps: VoiceHandlerDeps,
  channelId: string,
  binding: ResolvedBinding,
): Promise<GameMemberTally> {
  const channel = resolveVoiceChannel(deps.clientService, channelId);
  if (!channel || binding.gameId == null)
    return { counted: 0, allConfirmed: false, confirmedCount: 0 };
  // ROK-1711: bots never count, except DEMO_MODE-allowlisted companion bots.
  const counted = [...channel.members.values()].filter((m) =>
    countsTowardThreshold(m),
  );
  const voice = await detectAll(deps, counted);
  const tally = tallyOf(binding.gameId, voice);
  if (!deps.serverRoster) return tally;
  const roster = await deps.serverRoster.snapshot();
  return withServerPresence(tally, binding.gameId, voice, roster);
}

/**
 * Q6: the lobby's all-same-game check on MERGED detection — a member on a
 * game's server is on that game whatever rich presence says. Returns the
 * unanimous group's size (voice + that game's server-only players), or 0
 * when the room is not unanimous.
 */
export async function unanimousLobbySize(
  deps: VoiceHandlerDeps,
  members: GuildMember[],
): Promise<number> {
  const voice = await detectAll(deps, members);
  const roster = deps.serverRoster ? await deps.serverRoster.snapshot() : null;
  const merged = voice.map(
    (v) => (roster ? serverGameOf(roster, v.memberId) : null) ?? v.gameId,
  );
  const first = merged[0];
  if (first === null || first === undefined) return 0;
  if (merged.some((g) => g !== first)) return 0;
  const voiceIds = new Set(voice.map((v) => v.memberId));
  const serverOnly = roster ? serverOnlyCount(roster, first, voiceIds) : 0;
  return merged.length + serverOnly;
}
