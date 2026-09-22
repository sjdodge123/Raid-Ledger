/**
 * ROK-1619 — the indicator predicate and its emoji resolution.
 *
 * The predicate tests are written against `LFG_NOW_SPAWN_THRESHOLD` rather than
 * the literal 2 on purpose: if the operator ever retunes the threshold, these
 * assertions must move with the spawn guard, not quietly start testing a
 * boundary that no longer exists.
 */
import {
  LFG_NOW_INDICATOR_UNICODE,
  LFG_NOW_SPAWN_BUTTON_LABEL,
  groupReadPressWouldSpawnNow,
  pressWouldSpawnNow,
  resolveNowIndicatorEmoji,
  type EmojiCacheLike,
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

/** A structural stand-in for `guild.emojis.cache`. */
function cacheOf(emojis: GuildEmojiLike[]): EmojiCacheLike {
  return { find: (predicate) => emojis.find(predicate) };
}

describe('resolveNowIndicatorEmoji — AC5 + the admin emoji setting', () => {
  const praiseSun: GuildEmojiLike = { id: '123456789', name: 'praise_sun' };
  const guild = cacheOf([{ id: '1', name: 'rl_tank' }, praiseSun]);

  // Operator ruling 2026-09-22: the default is 🎉, replacing the old ☀️. The
  // literal is pinned here on purpose so a silent default change fails.
  it('defaults to 🎉 when no emoji is configured', () => {
    expect(LFG_NOW_INDICATOR_UNICODE).toBe('🎉');
    for (const unset of [null, undefined, '', '   ']) {
      expect(resolveNowIndicatorEmoji(unset, guild)).toEqual({ name: '🎉' });
    }
  });

  it('uses a configured Unicode emoji as is, with or without a guild', () => {
    expect(resolveNowIndicatorEmoji('☀️', guild)).toEqual({ name: '☀️' });
    expect(resolveNowIndicatorEmoji('🔥', null)).toEqual({ name: '🔥' });
  });

  it.each(['praise_sun', ':praise_sun:', '<:praise_sun:123456789>'])(
    'uses an available configured custom emoji (%s) as component data',
    (configured) => {
      expect(resolveNowIndicatorEmoji(configured, guild)).toEqual({
        id: '123456789',
        name: 'praise_sun',
      });
    },
  );

  it.each<[string, string, EmojiCacheLike | null]>([
    ['missing from the guild', 'praise_sun', cacheOf([])],
    ['unknown by id', '<:praise_sun:999999999>', guild],
    ['unverifiable (no guild: DM, web)', 'praise_sun', null],
    [
      'unavailable at this boost tier',
      'praise_sun',
      cacheOf([{ ...praiseSun, available: false }]),
    ],
    ['nameless', '<:x_x:123456789>', cacheOf([{ ...praiseSun, name: null }])],
  ])(
    'falls back to 🎉 when the custom emoji is %s',
    (_label, configured, cache) => {
      expect(resolveNowIndicatorEmoji(configured, cache)).toEqual({
        name: '🎉',
      });
    },
  );

  it('never yields a raw <:name:id> string on any path', () => {
    const cases: [string | null, EmojiCacheLike | null][] = [
      ['<:praise_sun:123456789>', guild],
      ['<:praise_sun:123456789>', null],
      ['<a:praise_sun:5555555>', cacheOf([])],
      [null, null],
    ];
    for (const [configured, cache] of cases) {
      const resolved = resolveNowIndicatorEmoji(configured, cache);
      expect(resolved.name).not.toMatch(/^<a?:/);
      expect(JSON.stringify(resolved)).not.toContain('<:');
    }
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
