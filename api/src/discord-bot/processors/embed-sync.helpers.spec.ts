/**
 * Tests for embed-sync.helpers.ts — character class fallback (ROK-824)
 * and embed state computation.
 *
 * Verifies that resolveCharacterClass resolves character class for users
 * with null characterId but valid userId, by falling back to the
 * user's main character.
 *
 * Also verifies computeEmbedState transitions:
 * POSTED -> FILLING -> FULL -> IMMINENT -> LIVE -> COMPLETED.
 */
import * as helpers from './embed-sync.helpers';
import { EMBED_STATES } from '../discord-bot.constants';
import type { EmbedEventData } from '../services/discord-embed.factory';

describe('resolveCharacterClass', () => {
  it('returns class name when characterId is present', () => {
    const result = helpers.resolveCharacterClass({
      characterClass: 'Mage',
      userId: 1,
      mainCharacterClass: null,
    });
    expect(result).toBe('Mage');
  });

  it('falls back to main character class when characterId is null', () => {
    const result = helpers.resolveCharacterClass({
      characterClass: null,
      userId: 1,
      mainCharacterClass: 'Rogue',
    });
    expect(result).toBe('Rogue');
  });

  it('returns null when both characterId and main character are null', () => {
    const result = helpers.resolveCharacterClass({
      characterClass: null,
      userId: 1,
      mainCharacterClass: null,
    });
    expect(result).toBeNull();
  });

  it('returns null when userId is null (anonymous signup)', () => {
    const result = helpers.resolveCharacterClass({
      characterClass: null,
      userId: null,
      mainCharacterClass: null,
    });
    expect(result).toBeNull();
  });

  it('prefers direct character class over main character fallback', () => {
    const result = helpers.resolveCharacterClass({
      characterClass: 'Warrior',
      userId: 1,
      mainCharacterClass: 'Mage',
    });
    expect(result).toBe('Warrior');
  });

  it('ignores mainCharacterClass when userId is null', () => {
    // Even if mainCharacterClass is set, without a userId there is no user to look up
    const result = helpers.resolveCharacterClass({
      characterClass: null,
      userId: null,
      mainCharacterClass: 'Druid',
    });
    expect(result).toBeNull();
  });
});

// ─── computeEmbedState ───────────────────────────────────────────────────

/** Build a minimal event row with configurable timing. */
function makeEventRow(overrides: {
  startMs: number;
  endMs: number;
  extendedUntilMs?: number | null;
  maxAttendees?: number | null;
  slotConfig?: EmbedEventData['slotConfig'];
}) {
  return {
    id: 1,
    title: 'Test Event',
    description: null,
    duration: [new Date(overrides.startMs), new Date(overrides.endMs)] as [
      Date,
      Date,
    ],
    extendedUntil:
      overrides.extendedUntilMs != null
        ? new Date(overrides.extendedUntilMs)
        : null,
    maxAttendees: overrides.maxAttendees ?? null,
    slotConfig: overrides.slotConfig ?? null,
    gameId: null,
    recurrenceGroupId: null,
    notificationChannelOverride: null,
  } as Parameters<typeof helpers.computeEmbedState>[0];
}

/** Build a minimal EmbedEventData fixture. */
function makeEmbedData(
  overrides: Partial<EmbedEventData> = {},
): EmbedEventData {
  return {
    id: 1,
    title: 'Test Event',
    description: null,
    startTime: new Date(Date.now() + 86400000).toISOString(),
    endTime: new Date(Date.now() + 97200000).toISOString(),
    signupCount: 0,
    maxAttendees: null,
    slotConfig: null,
    roleCounts: {},
    signupMentions: [],
    ...overrides,
  };
}

describe('computeEmbedState — time-based transitions', () => {
  it('returns COMPLETED when event has ended', () => {
    const now = Date.now();
    const event = makeEventRow({
      startMs: now - 4 * 3600000,
      endMs: now - 1 * 3600000,
    });
    expect(helpers.computeEmbedState(event, makeEmbedData())).toBe(
      EMBED_STATES.COMPLETED,
    );
  });

  it('returns LIVE when event is in progress', () => {
    const now = Date.now();
    const event = makeEventRow({
      startMs: now - 30 * 60000,
      endMs: now + 90 * 60000,
    });
    expect(helpers.computeEmbedState(event, makeEmbedData())).toBe(
      EMBED_STATES.LIVE,
    );
  });

  it('returns IMMINENT when event starts within 2 hours', () => {
    const now = Date.now();
    const event = makeEventRow({
      startMs: now + 60 * 60000,
      endMs: now + 4 * 3600000,
    });
    expect(helpers.computeEmbedState(event, makeEmbedData())).toBe(
      EMBED_STATES.IMMINENT,
    );
  });

  it('returns LIVE (not COMPLETED) when extendedUntil has not passed', () => {
    const now = Date.now();
    const event = makeEventRow({
      startMs: now - 3 * 3600000,
      endMs: now - 10 * 60000,
      extendedUntilMs: now + 20 * 60000,
    });
    expect(helpers.computeEmbedState(event, makeEmbedData())).toBe(
      EMBED_STATES.LIVE,
    );
  });

  it('returns COMPLETED when extendedUntil has passed', () => {
    const now = Date.now();
    const event = makeEventRow({
      startMs: now - 3 * 3600000,
      endMs: now - 60 * 60000,
      extendedUntilMs: now - 5 * 60000,
    });
    expect(helpers.computeEmbedState(event, makeEmbedData())).toBe(
      EMBED_STATES.COMPLETED,
    );
  });
});

describe('computeEmbedState — capacity-based transitions', () => {
  it('returns POSTED when no signups', () => {
    const now = Date.now();
    const event = makeEventRow({
      startMs: now + 25 * 3600000,
      endMs: now + 28 * 3600000,
    });
    expect(
      helpers.computeEmbedState(event, makeEmbedData({ signupCount: 0 })),
    ).toBe(EMBED_STATES.POSTED);
  });

  it('returns FILLING when there are signups but not full', () => {
    const now = Date.now();
    const event = makeEventRow({
      startMs: now + 25 * 3600000,
      endMs: now + 28 * 3600000,
      maxAttendees: 10,
    });
    expect(
      helpers.computeEmbedState(
        event,
        makeEmbedData({ signupCount: 5, maxAttendees: 10 }),
      ),
    ).toBe(EMBED_STATES.FILLING);
  });

  it('returns FULL when signupCount reaches maxAttendees', () => {
    const now = Date.now();
    const event = makeEventRow({
      startMs: now + 25 * 3600000,
      endMs: now + 28 * 3600000,
      maxAttendees: 5,
    });
    expect(
      helpers.computeEmbedState(
        event,
        makeEmbedData({ signupCount: 5, maxAttendees: 5 }),
      ),
    ).toBe(EMBED_STATES.FULL);
  });

  it('returns FULL when signupCount reaches total MMO slots', () => {
    const now = Date.now();
    const slotConfig = { type: 'mmo' as const, tank: 1, healer: 1, dps: 3 };
    const event = makeEventRow({
      startMs: now + 25 * 3600000,
      endMs: now + 28 * 3600000,
      slotConfig,
    });
    // 5 total slots (1+1+3), 5 signups
    const data = makeEmbedData({ signupCount: 5, slotConfig });
    expect(helpers.computeEmbedState(event, data)).toBe(EMBED_STATES.FULL);
  });

  it('returns FILLING when MMO slots are partially filled', () => {
    const now = Date.now();
    const slotConfig = { type: 'mmo' as const, tank: 1, healer: 1, dps: 3 };
    const event = makeEventRow({
      startMs: now + 25 * 3600000,
      endMs: now + 28 * 3600000,
      slotConfig,
    });
    const data = makeEmbedData({ signupCount: 3, slotConfig });
    expect(helpers.computeEmbedState(event, data)).toBe(EMBED_STATES.FILLING);
  });

  it('returns FILLING when generic slotConfig is used and partially filled', () => {
    const now = Date.now();
    const slotConfig = { type: 'generic' as const, player: 10 };
    const event = makeEventRow({
      startMs: now + 25 * 3600000,
      endMs: now + 28 * 3600000,
      slotConfig,
    });
    const data = makeEmbedData({ signupCount: 6, slotConfig });
    expect(helpers.computeEmbedState(event, data)).toBe(EMBED_STATES.FILLING);
  });

  it('time transitions take priority over capacity (IMMINENT beats FULL)', () => {
    const now = Date.now();
    const event = makeEventRow({
      startMs: now + 30 * 60000,
      endMs: now + 4 * 3600000,
      maxAttendees: 5,
    });
    // Full capacity, but event is imminent
    const data = makeEmbedData({ signupCount: 5, maxAttendees: 5 });
    expect(helpers.computeEmbedState(event, data)).toBe(EMBED_STATES.IMMINENT);
  });
});
