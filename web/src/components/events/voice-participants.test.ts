/**
 * ROK-1821 — the voice panel's row predicate. A game-server-only row (source
 * 'steam', not in voice) is never a voice row, linked or not; a Discord row and
 * a legacy row with no source are.
 */
import { describe, it, expect } from 'vitest';
import type { AdHocParticipantDto } from '@raid-ledger/contract';
import { isVoiceParticipant, voiceParticipants } from './voice-participants';

function row(overrides: Partial<AdHocParticipantDto> = {}): AdHocParticipantDto {
  return {
    id: 'uuid-1', eventId: 42, userId: 1, discordUserId: 'discord-1',
    discordUsername: 'Player', discordAvatarHash: null,
    joinedAt: '2026-10-16T18:00:00Z', leftAt: null,
    totalDurationSeconds: null, sessionCount: 1, ...overrides,
  };
}

describe('isVoiceParticipant (ROK-1821)', () => {
  it('a discord row is a voice row', () => {
    expect(isVoiceParticipant(row({ source: 'discord', inVoice: true }))).toBe(true);
  });

  it('a discord row that left voice is still a voice row (shown under Left)', () => {
    expect(isVoiceParticipant(row({ source: 'discord', inVoice: false, leftAt: '2026-10-16T18:30:00Z' }))).toBe(true);
  });

  it('a legacy row without source is a voice row', () => {
    expect(isVoiceParticipant(row())).toBe(true);
  });

  it('a steam-only (unlinked) server row is not a voice row', () => {
    expect(isVoiceParticipant(row({ userId: null, discordUserId: null, source: 'steam', inVoice: false, onServer: true }))).toBe(false);
  });

  it('a linked steam server row (has a Raid Ledger user) is not a voice row', () => {
    expect(isVoiceParticipant(row({ userId: 7, discordUserId: null, source: 'steam', inVoice: false, onServer: true }))).toBe(false);
  });

  it('a steam row that is also in voice is a voice row', () => {
    expect(isVoiceParticipant(row({ source: 'steam', inVoice: true, onServer: true }))).toBe(true);
  });
});

describe('voiceParticipants (ROK-1821)', () => {
  it('keeps only voice rows, preserving order', () => {
    const rows = [
      row({ id: 'a', source: 'discord' }),
      row({ id: 'b', source: 'steam', inVoice: false, onServer: true }),
      row({ id: 'c' }),
    ];
    expect(voiceParticipants(rows).map((p) => p.id)).toEqual(['a', 'c']);
  });
});
