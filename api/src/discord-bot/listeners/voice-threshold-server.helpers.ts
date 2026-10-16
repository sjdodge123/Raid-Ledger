/**
 * ROK-1801 layer B — game-bound (`game-voice-monitor`) threshold with server
 * presence folded in (Lead L4, operator ruling 4 / Q9).
 *
 * Post-processes the `{counted, allConfirmed, confirmedCount}` tally that
 * `getGameFilteredCount` (or ROK-1711's `tallyGameMembers`) returns, so the
 * at-cap handlers file is never edited. Each person is counted once.
 */
import type { ServerRoster } from '../services/server-presence-roster.helpers';
import { serverGameOf } from './voice-lobby-server-merge.helpers';

/** The tally shape both the old and the ROK-1711 count return. */
export interface GameMemberTally {
  counted: number;
  allConfirmed: boolean;
  confirmedCount: number;
}

/** One voice member's rich-presence detection, as the tally saw it. */
export interface VoiceDetection {
  memberId: string;
  gameId: number | null;
}

/** [counted, confirmed] delta for one voice member under server presence. */
function voiceDelta(
  v: VoiceDetection,
  gameId: number,
  roster: ServerRoster,
): [number, number] {
  const serverGame = serverGameOf(roster, v.memberId);
  if (serverGame === null || v.gameId === serverGame) return [0, 0];
  if (serverGame === gameId)
    // Presence-null was counted unconfirmed; another game was not counted.
    return v.gameId === null ? [0, 1] : [1, 1];
  // On ANOTHER game's server: server presence wins, so they leave this tally.
  if (v.gameId === gameId) return [-1, -1];
  return v.gameId === null ? [-1, 0] : [0, 0];
}

/**
 * Apply server presence to a game-bound tally: voice members on the bound
 * game's server become confirmed (and counted when rich presence said
 * another game); voice members on another game's server leave the tally;
 * server players not in voice are added as confirmed. `voice` must be the
 * same members, with the same detections, the tally was computed from.
 */
export function withServerPresence(
  tally: GameMemberTally,
  gameId: number,
  voice: VoiceDetection[],
  roster: ServerRoster,
): GameMemberTally {
  if (roster.byGame.size === 0) return tally;
  let { counted, confirmedCount } = tally;
  for (const v of voice) {
    const [c, k] = voiceDelta(v, gameId, roster);
    counted += c;
    confirmedCount += k;
  }
  const inVoice = new Set(voice.map((v) => v.memberId));
  const serverOnly = (roster.byGame.get(gameId) ?? []).filter(
    (e) => e.discordUserId === null || !inVoice.has(e.discordUserId),
  ).length;
  counted += serverOnly;
  confirmedCount += serverOnly;
  return { counted, confirmedCount, allConfirmed: counted === confirmedCount };
}
