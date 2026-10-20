/**
 * ROK-1794 — the pure halves of the guild-snapshot guard. The DB-backed rules
 * (live-member importer, held wholesale removal, audit row) are proven in
 * `addon-import-guild-trust.integration.spec.ts`.
 */
import {
  MASS_REMOVAL_MIN,
  ROSTER_HELD_MESSAGE,
  RosterHeldError,
  isMassRemoval,
  receivedSnapshotAt,
  windowVerdict,
} from './addon-import-guild.guard';

const NOW_MS = 1_790_000_000_000;

describe('receivedSnapshotAt (AC3)', () => {
  it('keeps a past snapshot time as sent', () => {
    expect(receivedSnapshotAt(1_789_999_000, NOW_MS).getTime()).toBe(
      1_789_999_000_000,
    );
  });

  it('clamps a post-dated snapshot to the server clock', () => {
    const plus23h = NOW_MS / 1000 + 23 * 3600;
    expect(receivedSnapshotAt(plus23h, NOW_MS).getTime()).toBe(NOW_MS);
  });
});

describe('isMassRemoval (AC4)', () => {
  it.each([
    ['one member leaves a big guild', 200, 1, false],
    ['a small guild loses half, under the floor', 4, 2, false],
    ['the floor, but only 2.5%', 200, MASS_REMOVAL_MIN, false],
    ['a one-member forgery against 40', 40, 39, true],
    ['just over a quarter', 40, 11, true],
    ['exactly a quarter', 40, 10, false],
  ])('%s', (_label, live, removed, want) => {
    expect(isMassRemoval(live, removed)).toBe(want);
  });
});

describe('windowVerdict (AC4, review r2)', () => {
  const none = { removed: 0, added: 0 };
  it.each([
    [
      'pad 10, then strip 11 of the original 40',
      50,
      { removed: 0, added: 10 },
      { removed: 11, added: 0 },
      40,
      true,
    ],
    ['pad 1960 fakes at once', 40, none, { removed: 0, added: 1960 }, 40, true],
    [
      '4 + 4 earlier, 4 now: 12 of 40',
      32,
      { removed: 8, added: 0 },
      { removed: 4, added: 0 },
      40,
      true,
    ],
    ['one leaves, two join', 40, none, { removed: 1, added: 2 }, 40, false],
  ])('%s', (_label, live, prior, now, base, held) => {
    expect(windowVerdict(live, prior, now)).toMatchObject({ base, held });
  });
});

describe('RosterHeldError (AC4 + AC7)', () => {
  it('sends the plain INVALID_PAYLOAD body — no new wire fields', () => {
    const err = new RosterHeldError(7, 39, 40, false);
    expect(err.getStatus()).toBe(422);
    expect(err.getResponse()).toEqual({
      code: 'INVALID_PAYLOAD',
      message: ROSTER_HELD_MESSAGE,
    });
    expect(err).toMatchObject({ guildId: 7, removed: 39, live: 40 });
  });
});
