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
 * ROK-1821 — unlinked game-server players still on the server. They have no
 * Raid Ledger user, so no signup shows them; the voice section lists them in
 * their own "On the game server" group. Linked server players are omitted —
 * the signup roster already shows them as their Raid Ledger user.
 */
export function serverGuestParticipants(participants: AdHocParticipantDto[]): AdHocParticipantDto[] {
  return participants.filter((p) => !isVoiceParticipant(p) && p.userId === null && !p.leftAt);
}
