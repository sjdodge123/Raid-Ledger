/**
 * ROK-1711 — which voice members count toward a game binding's `minPlayers`.
 *
 * Humans always count (presence-null ones too — ROK-697). Discord bots never
 * count, so one human plus an idle music bot no longer clears a
 * `minPlayers: 2` gate. The one exception is a DEMO_MODE-only allowlist of bot
 * user ids (`VOICE_THRESHOLD_BOT_ALLOWLIST`, comma-separated) so the companion
 * test bot can still drive the voice smoke to threshold on fleet/CI envs.
 */
import type { GuildMember } from 'discord.js';
import { isBotMember } from './voice-lobby-groups.helpers';

/** Env var holding the comma-separated Discord user ids of counted bots. */
export const VOICE_THRESHOLD_BOT_ALLOWLIST_ENV =
  'VOICE_THRESHOLD_BOT_ALLOWLIST';

/** Bot user ids that still count — empty unless DEMO_MODE is on. */
function allowlistedBotIds(): Set<string> {
  if (process.env.DEMO_MODE !== 'true') return new Set();
  const raw = process.env[VOICE_THRESHOLD_BOT_ALLOWLIST_ENV] ?? '';
  return new Set(
    raw
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0),
  );
}

/** Whether a voice member counts toward a game binding's threshold. */
export function countsTowardThreshold(member: {
  id: string;
  user?: { bot?: boolean } | null;
}): boolean {
  if (!isBotMember(member)) return true;
  return allowlistedBotIds().has(member.id);
}

/** Threshold tally for a game binding (see `getGameFilteredCount`). */
export interface GameMemberTally {
  counted: number;
  allConfirmed: boolean;
  confirmedCount: number;
}

/**
 * Tally the members that count toward `gameId`: bots skipped (unless
 * allowlisted), members positively on another game skipped, presence-null
 * humans counted but not confirmed (ROK-697 / ROK-1390).
 */
export async function tallyGameMembers(
  members: Iterable<GuildMember>,
  detect: (m: GuildMember) => Promise<{ gameId: number | null }>,
  gameId: number,
): Promise<GameMemberTally> {
  const tally = { counted: 0, allConfirmed: true, confirmedCount: 0 };
  for (const member of members) {
    if (!countsTowardThreshold(member)) continue;
    const detected = await detect(member);
    if (detected.gameId !== null && detected.gameId !== gameId) continue;
    tally.counted++;
    if (detected.gameId === null) tally.allConfirmed = false;
    else tally.confirmedCount++;
  }
  return tally;
}
