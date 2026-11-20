/**
 * ROK-2272 S10 (R5) — the pure half of the poll voter ping.
 */
import {
  linkedDiscordId,
  VOTER_ONCE_TTL_SECONDS,
  VOTER_PING_COPY,
  voterOnceKey,
  voterPingLine,
  voterScopeKey,
} from './hub-forum-discord-poll-voter-pings';

describe('poll voter ping (pure)', () => {
  it('the line is "🗳 <@id> voted" — ballot glyph without VS16', () => {
    expect(VOTER_PING_COPY.emoji).toBe('\u{1F5F3}');
    expect(voterPingLine('123456789012345678')).toBe(
      '\u{1F5F3} <@123456789012345678> voted',
    );
    expect(voterPingLine('1')).not.toContain('\u{FE0F}');
  });

  it('keys a hub post and a registry post into disjoint scopes', () => {
    expect(voterScopeKey({ hubThreadId: 5 })).toBe('hub:5');
    expect(voterScopeKey({ planningPostId: 5 })).toBe('planning:5');
    expect(voterOnceKey({ hubThreadId: 5 }, 9)).toBe('hfd:voter:hub:5:9');
    expect(voterOnceKey({ planningPostId: 5 }, 9)).toBe(
      'hfd:voter:planning:5:9',
    );
    expect(voterOnceKey({ hubThreadId: 5 }, 9)).not.toBe(
      voterOnceKey({ planningPostId: 5 }, 9),
    );
  });

  it('the once-key lives 30 days', () => {
    expect(VOTER_ONCE_TTL_SECONDS).toBe(30 * 24 * 3600);
  });

  it.each([
    ['123456789', '123456789'],
    ['local:alice', null],
    ['unlinked:42', null],
    ['', null],
    [null, null],
  ])('linkedDiscordId(%p) → %p', (raw, want) => {
    expect(linkedDiscordId(raw)).toBe(want);
  });
});
