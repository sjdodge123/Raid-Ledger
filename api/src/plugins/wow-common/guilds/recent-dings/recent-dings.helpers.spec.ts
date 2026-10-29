import {
  RECENT_DINGS_LIMIT,
  RECENT_DINGS_WINDOW_DAYS,
  toDings,
  windowStart,
  type RawDingRow,
} from './recent-dings.helpers';

const AT = new Date('2026-10-28T12:00:00.000Z');

function row(id: number, extra: Partial<RawDingRow> = {}): RawDingRow {
  return {
    id,
    name: `Char${id}`,
    characterId: null,
    fromLevel: 10,
    toLevel: 11,
    occurredAt: AT,
    ...extra,
  };
}

describe('toDings (ROK-1919)', () => {
  it('maps a row to the contract shape with an ISO `at`', () => {
    const cid = '6f1c2a8e-3b4d-4e5f-8a9b-0c1d2e3f4a5b';
    expect(
      toDings([row(1, { characterId: cid, fromLevel: 38, toLevel: 41 })]),
    ).toEqual([
      {
        name: 'Char1',
        characterId: cid,
        fromLevel: 38,
        toLevel: 41,
        at: '2026-10-28T12:00:00.000Z',
      },
    ]);
  });

  it('keeps the first row per event id (a GUID joined two characters)', () => {
    const dings = toDings([
      row(1, { characterId: 'first' }),
      row(1, { characterId: 'second' }),
      row(2),
    ]);
    expect(dings.map((d) => [d.name, d.characterId])).toEqual([
      ['Char1', 'first'],
      ['Char2', null],
    ]);
  });

  it(`caps the feed at ${RECENT_DINGS_LIMIT} entries, keeping the newest`, () => {
    const rows = Array.from({ length: RECENT_DINGS_LIMIT + 5 }, (_, i) =>
      row(i + 1),
    );
    const dings = toDings(rows);
    expect(dings).toHaveLength(RECENT_DINGS_LIMIT);
    expect(dings.at(-1)?.name).toBe(`Char${RECENT_DINGS_LIMIT}`);
  });
});

describe('windowStart', () => {
  it(`is exactly ${RECENT_DINGS_WINDOW_DAYS} days before now`, () => {
    expect(windowStart(AT.getTime()).toISOString()).toBe(
      '2026-09-28T12:00:00.000Z',
    );
  });
});
