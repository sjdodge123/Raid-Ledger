/**
 * ROK-1821 — the voice panel's row predicate. A game-server-only row (source
 * 'steam', not in voice) is never a voice row, linked or not; a Discord row and
 * a legacy row with no source are.
 */
import { describe, it, expect } from 'vitest';
import type { AdHocParticipantDto } from '@raid-ledger/contract';
import {
  isVoiceParticipant, serverGuestParticipants, splitVoiceGroups, voiceParticipants,
} from './voice-participants';

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

  it('a merged steam row (Discord identity) that left voice stays a voice row (shown under Left)', () => {
    const merged = row({ userId: 7, discordUserId: 'discord-7', source: 'steam', inVoice: false, onServer: false, leftAt: '2026-10-16T18:30:00Z' });
    expect(isVoiceParticipant(merged)).toBe(true);
  });

  it('a steam row that is also in voice is a voice row', () => {
    expect(isVoiceParticipant(row({ source: 'steam', inVoice: true, onServer: true }))).toBe(true);
  });
});

describe('voiceParticipants (ROK-1821)', () => {
  it('keeps only voice rows, preserving order', () => {
    const rows = [
      row({ id: 'a', source: 'discord' }),
      row({ id: 'b', discordUserId: null, source: 'steam', inVoice: false, onServer: true }),
      row({ id: 'c' }),
    ];
    expect(voiceParticipants(rows).map((p) => p.id)).toEqual(['a', 'c']);
  });
});

describe('serverGuestParticipants (ROK-1822)', () => {
  const unlinked = row({ id: 'u', userId: null, discordUserId: null, source: 'steam', inVoice: false, onServer: true });
  const linkedNoDiscord = row({ id: 'l', userId: 7, discordUserId: null, source: 'steam', inVoice: false, onServer: true });

  it('lists a linked server player with no signup (no Discord id) under the server group', () => {
    const ids = serverGuestParticipants([unlinked, linkedNoDiscord], new Set([3])).map((p) => p.id);
    expect(ids).toEqual(['u', 'l']);
  });

  it('omits a linked server player who has a signup (the roster shows them)', () => {
    const ids = serverGuestParticipants([unlinked, linkedNoDiscord], new Set([7])).map((p) => p.id);
    expect(ids).toEqual(['u']);
  });

  it('omits linked server players while the signup roster is unknown', () => {
    expect(serverGuestParticipants([unlinked, linkedNoDiscord]).map((p) => p.id)).toEqual(['u']);
  });

  it('omits a server player who has left the server', () => {
    const gone = row({ id: 'g', userId: null, discordUserId: null, source: 'steam', inVoice: false, onServer: false, leftAt: '2026-10-16T18:30:00Z' });
    expect(serverGuestParticipants([gone], new Set())).toEqual([]);
  });
});

describe('splitVoiceGroups (ROK-1822)', () => {
  it('a steam row that joined voice then left (still on the server, leftAt null) moves to Left', () => {
    const voiceThenLeft = row({ id: 'v', userId: 7, discordUserId: 'discord-7', source: 'steam', inVoice: false, onServer: true, leftAt: null });
    const { active, left } = splitVoiceGroups([voiceThenLeft]);
    expect(active.map((p) => p.id)).toEqual([]);
    expect(left.map((p) => p.id)).toEqual(['v']);
  });

  it('an open discord row with inVoice false is not In Channel and is not counted active', () => {
    const inChannel = row({ id: 'a', source: 'discord', inVoice: true });
    const outOfVoice = row({ id: 'b', source: 'discord', inVoice: false, leftAt: null });
    const { active, left } = splitVoiceGroups([inChannel, outOfVoice]);
    expect(active.map((p) => p.id)).toEqual(['a']);
    expect(left.map((p) => p.id)).toEqual(['b']);
  });

  it('a legacy row with no inVoice flag and no leftAt is In Channel', () => {
    expect(splitVoiceGroups([row({ id: 'c' })]).active.map((p) => p.id)).toEqual(['c']);
  });

  it('drops game-server-only rows from both groups', () => {
    const server = row({ id: 's', userId: null, discordUserId: null, source: 'steam', inVoice: false, onServer: true });
    const { active, left } = splitVoiceGroups([server]);
    expect([...active, ...left]).toEqual([]);
  });
});
