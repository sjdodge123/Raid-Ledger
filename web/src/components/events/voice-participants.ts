import type { AdHocParticipantDto } from '@raid-ledger/contract';

/**
 * ROK-1821 — true when an ad-hoc participant row belongs in the voice panel.
 *
 * A row is voice when it came from Discord voice, or is in voice right now.
 * A row with no `source` is a legacy (pre-ROK-1800) voice row. A game-server
 * row (`source: 'steam'`, not in voice) — linked to a Raid Ledger user or not —
 * stays on the event roster but is never shown as voice.
 */
export function isVoiceParticipant(participant: AdHocParticipantDto): boolean {
  return participant.source !== 'steam' || participant.inVoice === true;
}

/** ROK-1821 — the voice rows of an ad-hoc roster, in their original order. */
export function voiceParticipants(participants: AdHocParticipantDto[]): AdHocParticipantDto[] {
  return participants.filter(isVoiceParticipant);
}
