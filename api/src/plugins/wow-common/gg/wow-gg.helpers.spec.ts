import { GgWowLevelsCardSchema } from '@raid-ledger/contract';
import { toWowLevelsCard, type WowYearDingRow } from './wow-gg.helpers';

const row = (o: Partial<WowYearDingRow>): WowYearDingRow => ({
  eventId: 1,
  characterId: 'c1',
  name: 'Thrall',
  className: 'Shaman',
  fromLevel: 9,
  toLevel: 10,
  ...o,
});

describe('toWowLevelsCard (ROK-2187 metric 12)', () => {
  it('returns null when the user dinged nothing in the year', () => {
    expect(toWowLevelsCard([])).toBeNull();
  });

  it('counts dings, the max level and the level before the first ding per character', () => {
    const card = toWowLevelsCard([
      row({ eventId: 1, fromLevel: 9, toLevel: 10 }),
      row({ eventId: 2, fromLevel: 10, toLevel: 12 }),
      row({
        eventId: 3,
        characterId: 'c2',
        name: 'Jaina',
        className: null,
        fromLevel: 59,
        toLevel: 60,
      }),
    ]);
    expect(card).toEqual({
      totalDings: 3,
      characters: [
        {
          name: 'Thrall',
          className: 'Shaman',
          fromLevel: 9,
          maxLevel: 12,
          dings: 2,
        },
        {
          name: 'Jaina',
          className: null,
          fromLevel: 59,
          maxLevel: 60,
          dings: 1,
        },
      ],
    });
    expect(GgWowLevelsCardSchema.safeParse(card).success).toBe(true);
  });

  it('counts an event repeated across rows once', () => {
    const card = toWowLevelsCard([row({ eventId: 7 }), row({ eventId: 7 })]);
    expect(card?.totalDings).toBe(1);
    expect(card?.characters).toHaveLength(1);
  });

  it('caps the list at 20 characters but keeps every ding in the total', () => {
    const rows = Array.from({ length: 22 }, (_, i) =>
      row({ eventId: i + 1, characterId: `c${i}`, name: `C${i}` }),
    );
    const card = toWowLevelsCard(rows);
    expect(card?.characters).toHaveLength(20);
    expect(card?.totalDings).toBe(22);
  });
});
