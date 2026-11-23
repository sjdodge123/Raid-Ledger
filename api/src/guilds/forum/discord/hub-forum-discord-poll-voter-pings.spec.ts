/**
 * ROK-2272 S10 (R5) — the pure half of the poll voter ping.
 * ROK-2295 lane C — the line lists the voter's slots; its stored ref.
 */
import {
  linkedDiscordId,
  parseVoterLine,
  sameSlots,
  storedVoterLines,
  VOTER_ONCE_TTL_SECONDS,
  VOTER_PING_COPY,
  voterLine,
  voterLinesKey,
  voterOnceKey,
  voterScopeKey,
} from './hub-forum-discord-poll-voter-pings';

const ID = '123456789012345678';
/** `n` hourly ISO slots from a fixed second; `<t:…:f>` for slot `i`. */
const T0 = Date.UTC(2026, 10, 23, 18, 0, 0);
const slots = (n: number) =>
  Array.from({ length: n }, (_, i) => new Date(T0 + i * 3600e3).toISOString());
const ts = (i: number) => `<t:${T0 / 1000 + i * 3600}:f>`;

describe('poll voter ping (pure)', () => {
  it('one slot: "🗳 <@id> voted: <t:…:f>" — ballot glyph without VS16', () => {
    expect(VOTER_PING_COPY.emoji).toBe('\u{1F5F3}');
    expect(voterLine(ID, slots(1))).toBe(`\u{1F5F3} <@${ID}> voted: ${ts(0)}`);
    expect(voterLine('1', slots(1))).not.toContain('\u{FE0F}');
  });

  it('three slots: all listed, comma-separated, in order', () => {
    expect(voterLine(ID, slots(3))).toBe(
      `\u{1F5F3} <@${ID}> voted: ${ts(0)}, ${ts(1)}, ${ts(2)}`,
    );
  });

  it('nine slots: the first eight, then "+1 more"', () => {
    const want = [0, 1, 2, 3, 4, 5, 6, 7].map(ts).join(', ');
    expect(voterLine(ID, slots(9))).toBe(
      `\u{1F5F3} <@${ID}> voted: ${want} +1 more`,
    );
    expect(voterLine(ID, slots(8))).not.toContain('more');
  });

  it('no slots left: "voted: no times right now"', () => {
    expect(voterLine(ID, [])).toBe(
      `\u{1F5F3} <@${ID}> voted: no times right now`,
    );
  });

  it('a stored line round-trips; a foreign or broken field is skipped', () => {
    const line = { messageId: 'm1', discordId: ID, slots: slots(2) };
    expect(voterLinesKey('d-post')).toBe('hfd:voter-lines:d-post');
    expect(parseVoterLine(JSON.stringify(line))).toEqual(line);
    expect(parseVoterLine('1')).toBeNull();
    expect(parseVoterLine('{nope')).toBeNull();
    const got = storedVoterLines({
      '11': JSON.stringify(line),
      '12': '{"messageId":"m2"}',
      abc: JSON.stringify(line),
    });
    expect([...got.entries()]).toEqual([[11, line]]);
  });

  it('sameSlots compares order and length', () => {
    expect(sameSlots(slots(2), slots(2))).toBe(true);
    expect(sameSlots(slots(2), slots(3))).toBe(false);
    expect(sameSlots(slots(2), [...slots(2)].reverse())).toBe(false);
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
