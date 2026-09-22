/**
 * ROK-1619 — the indicator predicate and its emoji resolution.
 *
 * The predicate tests are written against `LFG_NOW_SPAWN_THRESHOLD` rather than
 * the literal 2 on purpose: if the operator ever retunes the threshold, these
 * assertions must move with the spawn guard, not quietly start testing a
 * boundary that no longer exists.
 */
import {
  LFG_NOW_INDICATOR_EMOJI_NAME,
  LFG_NOW_INDICATOR_UNICODE,
  LFG_NOW_SPAWN_BUTTON_LABEL,
  findIndicatorEmoji,
  groupReadPressWouldSpawnNow,
  pressWouldSpawnNow,
  resolveNowIndicatorEmoji,
  type GuildEmojiLike,
} from './lfg-now-indicator.helpers';
import { LFG_NOW_SPAWN_THRESHOLD } from './lfg-now.constants';

const ONE_SHORT = LFG_NOW_SPAWN_THRESHOLD - 1;

describe('pressWouldSpawnNow — AC1, the indicator means exactly one thing', () => {
  it('is true one now-hand short of the threshold, for a viewer with no hand', () => {
    expect(
      pressWouldSpawnNow({
        state: 'open',
        nowCount: ONE_SHORT,
        viewerHoldsNowHand: false,
      }),
    ).toBe(true);
  });

  it('is false for a viewer who already holds a now-hand (their press is idempotent)', () => {
    expect(
      pressWouldSpawnNow({
        state: 'open',
        nowCount: ONE_SHORT,
        viewerHoldsNowHand: true,
      }),
    ).toBe(false);
  });

  it('is false two hands short', () => {
    expect(pressWouldSpawnNow({ state: 'open', nowCount: ONE_SHORT - 1 })).toBe(
      false,
    );
  });

  it('is false at or above the threshold — that press ATTACHES, it does not spawn', () => {
    expect(
      pressWouldSpawnNow({ state: 'open', nowCount: LFG_NOW_SPAWN_THRESHOLD }),
    ).toBe(false);
    expect(
      pressWouldSpawnNow({
        state: 'open',
        nowCount: LFG_NOW_SPAWN_THRESHOLD + 1,
      }),
    ).toBe(false);
  });

  it('is false once the group is live — AC3, a lingering sun would be a lie', () => {
    expect(pressWouldSpawnNow({ state: 'playing', nowCount: ONE_SHORT })).toBe(
      false,
    );
    expect(
      pressWouldSpawnNow({
        state: 'open',
        nowCount: ONE_SHORT,
        playingEventId: 42,
      }),
    ).toBe(false);
  });

  it.each(['scheduled', 'expired', 'closed'])(
    'is false at the terminal state %s',
    (state) => {
      expect(pressWouldSpawnNow({ state, nowCount: ONE_SHORT })).toBe(false);
    },
  );

  it('treats an absent now-count as zero rather than as unknown', () => {
    expect(pressWouldSpawnNow({ state: 'open' })).toBe(ONE_SHORT === 0);
  });

  it('a week-only or tonight-only group never lights up: neither is counted', () => {
    // `nowCount` is `count(*) FILTER (WHERE urgency = 'now')`, so a group of
    // five `tonight` hands (ROK-1616) reports zero here — the same zero the
    // spawn guard's `listLiveNowHands` would report.
    expect(pressWouldSpawnNow({ state: 'open', nowCount: 0 })).toBe(false);
  });
});

describe('resolveNowIndicatorEmoji — AC5, degrade, never break', () => {
  const custom: GuildEmojiLike = {
    id: '123456789',
    name: LFG_NOW_INDICATOR_EMOJI_NAME,
  };

  it('uses the guild custom emoji as component data when it is available', () => {
    expect(resolveNowIndicatorEmoji(custom)).toEqual({
      id: '123456789',
      name: LFG_NOW_INDICATOR_EMOJI_NAME,
    });
  });

  it.each<[string, GuildEmojiLike | null | undefined]>([
    ['missing from the guild', null],
    ['not looked up at all', undefined],
    ['unavailable at this boost tier', { ...custom, available: false }],
    ['nameless', { ...custom, name: null }],
  ])('falls back to the Unicode sun when the emoji is %s', (_label, input) => {
    expect(resolveNowIndicatorEmoji(input)).toEqual({
      name: LFG_NOW_INDICATOR_UNICODE,
    });
  });

  it('never yields a raw <:name:id> string on any path', () => {
    for (const input of [
      custom,
      null,
      undefined,
      { ...custom, available: false },
    ]) {
      const resolved = resolveNowIndicatorEmoji(input);
      expect(resolved.name).not.toMatch(/^<a?:/);
      expect(JSON.stringify(resolved)).not.toContain('<:');
    }
  });
});

describe('findIndicatorEmoji', () => {
  it('returns null without a guild emoji cache', () => {
    expect(findIndicatorEmoji(null)).toBeNull();
    expect(findIndicatorEmoji(undefined)).toBeNull();
  });

  it('finds the emoji by NAME, never by a hardcoded id', () => {
    const emojis: GuildEmojiLike[] = [
      { id: '1', name: 'rl_tank' },
      { id: '2', name: LFG_NOW_INDICATOR_EMOJI_NAME },
    ];
    expect(findIndicatorEmoji({ find: (p) => emojis.find(p) })).toEqual({
      id: '2',
      name: LFG_NOW_INDICATOR_EMOJI_NAME,
    });
  });

  it('returns null when the guild has no emoji of that name', () => {
    const emojis: GuildEmojiLike[] = [{ id: '1', name: 'rl_tank' }];
    expect(findIndicatorEmoji({ find: (p) => emojis.find(p) })).toBeNull();
  });
});

describe('AC6 — the emoji is not the only carrier of the meaning', () => {
  it('the spawn label says what the press does, in words', () => {
    expect(LFG_NOW_SPAWN_BUTTON_LABEL).toContain('starts the group');
  });

  it('stays inside Discord’s 80-character button label cap', () => {
    expect(LFG_NOW_SPAWN_BUTTON_LABEL.length).toBeLessThanOrEqual(80);
  });
});

describe('groupReadPressWouldSpawnNow — AC7, the same rule on a group READ', () => {
  const noSession = { nowCount: ONE_SHORT, playingNow: null };

  it('is true one short, with no live session, for a viewer without a now-hand', () => {
    expect(groupReadPressWouldSpawnNow(noSession, false)).toBe(true);
  });

  it('is false for a viewer who already holds a now-hand', () => {
    expect(groupReadPressWouldSpawnNow(noSession, true)).toBe(false);
  });

  it('is false two short', () => {
    const group = { nowCount: ONE_SHORT - 1, playingNow: null };
    expect(groupReadPressWouldSpawnNow(group, false)).toBe(false);
  });

  it('is false once a live session exists, even at the one-short count', () => {
    const group = { nowCount: ONE_SHORT, playingNow: { eventId: 9 } };
    expect(groupReadPressWouldSpawnNow(group, false)).toBe(false);
  });

  it('agrees with pressWouldSpawnNow on every count around the threshold', () => {
    for (let n = 0; n <= LFG_NOW_SPAWN_THRESHOLD + 1; n++) {
      expect(
        groupReadPressWouldSpawnNow({ nowCount: n, playingNow: null }, false),
      ).toBe(pressWouldSpawnNow({ state: 'open', nowCount: n }));
    }
  });
});
