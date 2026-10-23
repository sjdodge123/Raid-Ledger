import { toContentInstanceCards } from './event-content-cards.helpers';

describe('toContentInstanceCards (ROK-1911)', () => {
  it('maps {id, name} entries and drops the levels/extra keys', () => {
    expect(
      toContentInstanceCards([
        { id: 63, name: 'Wailing Caverns', levels: 'x' },
      ]),
    ).toEqual([{ id: 63, name: 'Wailing Caverns' }]);
  });

  it('accepts a numeric-string id and the legacy instanceId key', () => {
    expect(
      toContentInstanceCards([
        { id: '36', name: 'Deadmines' },
        { instanceId: 48, name: 'Blackfathom' },
      ]),
    ).toEqual([
      { id: 36, name: 'Deadmines' },
      { id: 48, name: 'Blackfathom' },
    ]);
  });

  it('skips junk entries and non-array input', () => {
    expect(
      toContentInstanceCards([null, 5, { id: 'x', name: 'A' }, { id: 1 }]),
    ).toEqual([]);
    expect(toContentInstanceCards(null)).toEqual([]);
    expect(toContentInstanceCards({ id: 1, name: 'A' })).toEqual([]);
  });

  it('caps at 20 entries and 200-char names (contract bounds)', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      id: i + 1,
      name: 'n'.repeat(250),
    }));
    const cards = toContentInstanceCards(many);
    expect(cards).toHaveLength(20);
    expect(cards[0]?.name).toHaveLength(200);
  });
});
