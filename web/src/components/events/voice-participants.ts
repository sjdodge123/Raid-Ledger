import type { AdHocParticipantDto } from '@raid-ledger/contract';

/**
 * ROK-1821 — true when an ad-hoc participant row belongs in the voice panel.
 *
 * A row is voice when it came from Discord voice, is in voice right now, or
 * carries a Discord identity — a server row that later joined voice is merged
 * (`attachDiscordToUserRow`) but keeps `source: 'steam'`, and must still show
 * under Left once it leaves voice (Codex r3). A row with no `source` is a
 * legacy (pre-ROK-1800) voice row. A game-server row with no Discord identity,
 * not in voice — linked to a Raid Ledger user or not — stays on the event
 * roster but is never shown as voice.
 */
export function isVoiceParticipant(participant: AdHocParticipantDto): boolean {
  return (
    participant.source !== 'steam' ||
    participant.inVoice === true ||
    participant.discordUserId !== null
  );
}

/** ROK-1821 — the voice rows of an ad-hoc roster, in their original order. */
export function voiceParticipants(participants: AdHocParticipantDto[]): AdHocParticipantDto[] {
  return participants.filter(isVoiceParticipant);
}

/**
 * ROK-1821/1822 — game-server players still on the server who no signup shows,
 * listed in their own "On the game server" group: unlinked players (no Raid
 * Ledger user), and linked players without a signup (a user with no Discord id
 * gets none — the signup is keyed on it). A linked player WITH a signup is
 * omitted — the roster already shows them as their user. While the signup
 * roster is unknown (`signedUpUserIds` absent) linked players stay hidden, so a
 * loading roster never flashes a duplicate.
 */
export function serverGuestParticipants(
  participants: AdHocParticipantDto[],
  signedUpUserIds?: ReadonlySet<number>,
): AdHocParticipantDto[] {
  return participants.filter((p) => {
    if (isVoiceParticipant(p) || p.leftAt) return false;
    if (p.userId === null) return true;
    return signedUpUserIds !== undefined && !signedUpUserIds.has(p.userId);
  });
}

/** The voice panel's two groups (ROK-1822). */
export interface VoiceGroups {
  /** In the voice channel now: an open row whose `inVoice` is not false. */
  active: AdHocParticipantDto[];
  /** Was in voice at some point but is not now: closed, or open with `inVoice: false`. */
  left: AdHocParticipantDto[];
}

/**
 * ROK-1822 — splits the voice rows of an ad-hoc roster into In Channel and
 * Left. A voice row is one that was in voice at some point
 * ({@link isVoiceParticipant}); it is active only while in voice now, so a
 * server row that joined voice then left (still on the server, `leftAt` null)
 * and an open Discord row with `inVoice: false` both land under Left. A legacy
 * row with no `inVoice` flag falls back to `leftAt`.
 */
export function splitVoiceGroups(participants: AdHocParticipantDto[]): VoiceGroups {
  const groups: VoiceGroups = { active: [], left: [] };
  for (const p of voiceParticipants(participants)) {
    const inVoiceNow = !p.leftAt && p.inVoice !== false;
    (inVoiceNow ? groups.active : groups.left).push(p);
  }
  return groups;
}
