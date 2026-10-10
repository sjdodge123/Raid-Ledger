import {
  armoryIsNewer,
  snapshotItemIds,
} from './forever-display-equipment.service';

const CAPTURED = new Date('2026-09-15T12:00:00.000Z');
const armory = (syncedAt: string) => ({
  equippedItemLevel: null,
  items: [],
  syncedAt,
});

describe('armoryIsNewer (newest wins, Q4)', () => {
  it('is false with no stored equipment', () => {
    expect(armoryIsNewer(null, CAPTURED)).toBe(false);
  });
  it('is false when the Armory sync predates the capture', () => {
    expect(armoryIsNewer(armory('2026-09-01T00:00:00Z'), CAPTURED)).toBe(false);
  });
  it('is true when the Armory sync is at or after the capture', () => {
    expect(armoryIsNewer(armory(CAPTURED.toISOString()), CAPTURED)).toBe(true);
    expect(armoryIsNewer(armory('2026-09-20T00:00:00Z'), CAPTURED)).toBe(true);
  });
  it('is false for an unparseable syncedAt', () => {
    expect(armoryIsNewer(armory('not a date'), CAPTURED)).toBe(false);
  });
});

describe('snapshotItemIds', () => {
  it('dedupes ids and skips entries without one', () => {
    const data = {
      gear: [
        { slot: 1, itemId: 16921, bonusIds: [] },
        { slot: 4, bonusIds: [] },
        { slot: 11, itemId: 5, bonusIds: [] },
        { slot: 12, itemId: 5, bonusIds: [] },
      ],
      talents: { nodes: [] },
      lockouts: [],
    };
    expect(snapshotItemIds({ data, capturedAt: CAPTURED })).toEqual([16921, 5]);
  });
});
