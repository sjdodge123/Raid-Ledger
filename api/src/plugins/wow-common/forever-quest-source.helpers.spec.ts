/**
 * ROK-2109 AC5: `effectiveQuests` — newest completed list wins (tie keeps the
 * addon), the in-progress log is always the addon's, malformed Armory jsonb
 * is absent, and the truncation flag travels with the winner.
 */
import { effectiveQuests } from './forever-quest-source.helpers';

const T0 = new Date('2026-11-07T10:00:00.000Z');
const T1 = new Date('2026-11-07T11:00:00.000Z');
const NOW = new Date('2026-11-07T12:00:00.000Z');
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

describe('effectiveQuests (ROK-2109 AC5)', () => {
  it('returns null when neither source has quest data', () => {
    expect(effectiveQuests(null, null, NOW)).toBeNull();
    expect(
      effectiveQuests({ data: { gear: [] }, capturedAt: T0 }, null, NOW),
    ).toBeNull();
  });

  it('uses the addon alone when there is no Armory list', () => {
    const eff = effectiveQuests(addon([1], T0), null, NOW);
    expect(eff).toEqual({
      quests: { completed: [1], inProgress: LOG },
      capturedAt: T0,
      source: 'addon',
      inProgressAsOf: T0,
    });
  });

  it('uses the Armory list alone with an empty log and no log date', () => {
    const eff = effectiveQuests(null, armory([1, 2], T1), NOW);
    expect(eff).toEqual({
      quests: { completed: [1, 2], inProgress: [] },
      capturedAt: T1,
      source: 'blizzard',
      inProgressAsOf: null,
    });
  });

  it('takes the newer completed list but keeps the addon log', () => {
    const newerArmory = effectiveQuests(
      addon([1], T0),
      armory([1, 2], T1),
      NOW,
    );
    expect(newerArmory?.source).toBe('blizzard');
    expect(newerArmory?.quests.completed).toEqual([1, 2]);
    expect(newerArmory?.quests.inProgress).toEqual(LOG);
    expect(newerArmory?.inProgressAsOf).toEqual(T0);
    const newerAddon = effectiveQuests(addon([1], T1), armory([1, 2], T0), NOW);
    expect(newerAddon?.source).toBe('addon');
    expect(newerAddon?.quests.completed).toEqual([1]);
    expect(newerAddon?.capturedAt).toEqual(T1);
  });

  it('keeps the addon on a tie', () => {
    const eff = effectiveQuests(addon([1], T0), armory([1, 2], T0), NOW);
    expect(eff?.source).toBe('addon');
    expect(eff?.quests.completed).toEqual([1]);
  });

  it('treats malformed Armory jsonb as absent', () => {
    for (const bad of [
      { completed: 'x' },
      { fetchedAt: 'nope', completed: [1] },
      42,
    ]) {
      expect(effectiveQuests(addon([1], T0), bad, NOW)?.source).toBe('addon');
      expect(effectiveQuests(null, bad, NOW)).toBeNull();
    }
  });

  it('carries the truncation flag from the winner only', () => {
    const armoryWins = effectiveQuests(
      addon([1], T0, true),
      armory([1, 2], T1),
      NOW,
    );
    expect(armoryWins?.quests.completedTruncated).toBeUndefined();
    const truncArmory = effectiveQuests(
      addon([1], T0),
      armory([1, 2], T1, true),
      NOW,
    );
    expect(truncArmory?.quests.completedTruncated).toBe(true);
    const addonWins = effectiveQuests(
      addon([1], T1, true),
      armory([1, 2], T0),
      NOW,
    );
    expect(addonWins?.quests.completedTruncated).toBe(true);
  });
});
