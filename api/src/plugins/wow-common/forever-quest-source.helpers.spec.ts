/**
 * ROK-2109 AC5 + ROK-2138 AC13–14: `effectiveQuests` — the Armory completed
 * list wins whenever it parses, regardless of age (Blizzard is primary); the
 * addon list only fills the gap when there is no Armory list. The in-progress
 * log is always the addon's, malformed Armory jsonb is absent, and the
 * truncation flag travels with the winner.
 */
import { effectiveQuests } from './forever-quest-source.helpers';

const T0 = new Date('2026-11-07T10:00:00.000Z');
const T1 = new Date('2026-11-07T11:00:00.000Z');
const MONTH_AGO = new Date('2026-10-07T10:00:00.000Z');
const LOG = [{ questId: 9, title: 'Log' }];

const addon = (completed: number[], at: Date, truncated = false) => ({
  data: {
    quests: {
      completed,
      ...(truncated ? { completedTruncated: true } : {}),
      inProgress: LOG,
    },
  },
  capturedAt: at,
});
const armory = (completed: number[], at: Date, truncated = false) => ({
  fetchedAt: at.toISOString(),
  completed,
  ...(truncated ? { completedTruncated: true } : {}),
});

describe('effectiveQuests (ROK-2109 AC5, ROK-2138 AC13–14)', () => {
  it('returns null when neither source has quest data (AC14)', () => {
    expect(effectiveQuests(null, null)).toBeNull();
    expect(
      effectiveQuests({ data: { gear: [] }, capturedAt: T0 }, null),
    ).toBeNull();
  });

  it('uses the addon alone when there is no Armory list (AC14)', () => {
    const eff = effectiveQuests(addon([1], T0), null);
    expect(eff).toEqual({
      quests: { completed: [1], inProgress: LOG },
      capturedAt: T0,
      source: 'addon',
      inProgressAsOf: T0,
    });
  });

  it('uses the Armory list alone with an empty log and no log date', () => {
    const eff = effectiveQuests(null, armory([1, 2], T1));
    expect(eff).toEqual({
      quests: { completed: [1, 2], inProgress: [] },
      capturedAt: T1,
      source: 'blizzard',
      inProgressAsOf: null,
    });
  });

  it('a newer Armory list wins the completed list but keeps the addon log', () => {
    const eff = effectiveQuests(addon([1], T0), armory([1, 2], T1));
    expect(eff?.source).toBe('blizzard');
    expect(eff?.quests.completed).toEqual([1, 2]);
    expect(eff?.quests.inProgress).toEqual(LOG);
    expect(eff?.inProgressAsOf).toEqual(T0);
  });

  it("a month-old Armory list beats a newer addon list; the log and its date stay the addon's (AC13)", () => {
    const eff = effectiveQuests(addon([1], T1), armory([1, 2], MONTH_AGO));
    expect(eff).toEqual({
      quests: { completed: [1, 2], inProgress: LOG },
      capturedAt: MONTH_AGO,
      source: 'blizzard',
      inProgressAsOf: T1,
    });
  });

  it('the Armory list wins a tie too (no union of the two lists)', () => {
    const eff = effectiveQuests(addon([3], T0), armory([1, 2], T0));
    expect(eff?.source).toBe('blizzard');
    expect(eff?.quests.completed).toEqual([1, 2]);
  });

  it('treats malformed Armory jsonb as absent (AC14)', () => {
    for (const bad of [
      { completed: 'x' },
      { fetchedAt: 'nope', completed: [1] },
      42,
    ]) {
      expect(effectiveQuests(addon([1], T0), bad)?.source).toBe('addon');
      expect(effectiveQuests(null, bad)).toBeNull();
    }
  });

  it('carries the truncation flag from the winner only', () => {
    const armoryWins = effectiveQuests(
      addon([1], T1, true),
      armory([1, 2], T0),
    );
    expect(armoryWins?.source).toBe('blizzard');
    expect(armoryWins?.quests.completedTruncated).toBeUndefined();
    const truncArmory = effectiveQuests(
      addon([1], T0),
      armory([1, 2], T1, true),
    );
    expect(truncArmory?.quests.completedTruncated).toBe(true);
    const addonOnly = effectiveQuests(addon([1], T1, true), null);
    expect(addonOnly?.quests.completedTruncated).toBe(true);
  });
});
