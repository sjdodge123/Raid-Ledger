import { BadGatewayException } from '@nestjs/common';
import {
  expandSubInstances,
  fetchExpansionIndex,
  fetchRealmListFromApi,
  filterByVariant,
} from './blizzard-instance.helpers';

/**
 * ROK-2210: wow_forever and classic_era are catalogue-served; the journal
 * filter only matters for the journal-served variants.
 */
describe('filterByVariant — journal variants', () => {
  const dungeons = [
    { id: 1, name: 'Deadmines', expansion: 'Classic' },
    { id: 2, name: 'Hellfire Ramparts', expansion: 'Burning Crusade' },
  ];
  const raids = [
    { id: 10, name: 'Molten Core', expansion: 'Classic' },
    { id: 11, name: 'Karazhan', expansion: 'Burning Crusade' },
  ];

  it('leaves the existing variants unchanged (AC4)', () => {
    expect(filterByVariant(dungeons, raids, 'classic_era').raids).toHaveLength(
      1,
    );
    expect(
      filterByVariant(dungeons, raids, 'classic_anniversary').raids,
    ).toHaveLength(2);
    expect(filterByVariant(dungeons, raids, 'retail').raids).toHaveLength(2);
  });
});

/** ROK-2210: wing rows come from the catalogue's unlisted parents. */
describe('expandSubInstances (ROK-2210)', () => {
  const row = (id: number, name: string) => ({
    id,
    name,
    expansion: 'Classic',
  });

  it('replaces Scarlet Monastery and Maraudon with their wings', () => {
    const out = expandSubInstances([
      row(316, 'Scarlet Monastery'),
      row(232, 'Maraudon'),
    ]);
    expect(out.map((r) => r.id)).toEqual([
      31601, 31602, 31603, 31604, 23201, 23202, 23203,
    ]);
    expect(out[0]).toEqual({
      id: 31601,
      name: 'SM: Graveyard',
      shortName: 'SM:GY',
      expansion: 'Classic',
      minimumLevel: 26,
      maximumLevel: 32,
    });
  });

  it('keeps listed parents whole (LBRS gets no UBRS, Dire Maul no wings)', () => {
    const input = [row(229, 'Lower Blackrock Spire'), row(230, 'Dire Maul')];
    expect(expandSubInstances(input)).toEqual(input);
  });
});

/**
 * ROK-1636: a failed realm-index call must surface as a 502 HttpException with
 * a readable message, not a raw Error that Nest turns into a bare 500.
 */
describe('fetchRealmListFromApi — upstream failures (ROK-1636)', () => {
  const logger = { error: jest.fn(), warn: jest.fn() };
  afterEach(() => jest.restoreAllMocks());

  function mockStatus(status: number) {
    jest
      .spyOn(global, 'fetch')
      .mockImplementation(() =>
        Promise.resolve(new Response('upstream', { status })),
      );
  }

  it('maps a 403 to a 502 saying the game variant is not served', async () => {
    mockStatus(403);
    const call = fetchRealmListFromApi('us', 'classicforever', 'tok', logger);
    await expect(call).rejects.toBeInstanceOf(BadGatewayException);
    await expect(
      fetchRealmListFromApi('us', 'classicforever', 'tok', logger),
    ).rejects.toThrow(
      "Blizzard's API doesn't serve realms for this game version yet (403).",
    );
  });

  it('maps a 5xx to a 502 try-again error', async () => {
    mockStatus(503);
    const call = fetchRealmListFromApi('us', null, 'tok', logger);
    await expect(call).rejects.toBeInstanceOf(BadGatewayException);
    await expect(
      fetchRealmListFromApi('us', null, 'tok', logger),
    ).rejects.toThrow(
      'Failed to fetch realm list from Blizzard (503). Please try again later.',
    );
  });
});

/**
 * TDB:1784: the journal expansion index feeds the instance list. A failed call
 * must surface as a 502 with a readable message, like the realm path above,
 * not a raw Error that Nest turns into a bare 500.
 */
describe('fetchExpansionIndex — upstream failures', () => {
  afterEach(() => jest.restoreAllMocks());

  function mockStatus(status: number) {
    jest
      .spyOn(global, 'fetch')
      .mockImplementation(() =>
        Promise.resolve(new Response('upstream', { status })),
      );
  }

  it('maps a 403 to a 502 saying instances are not served', async () => {
    mockStatus(403);
    await expect(fetchExpansionIndex('us', 'tok')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    await expect(fetchExpansionIndex('us', 'tok')).rejects.toHaveProperty(
      'message',
      "Blizzard's API doesn't serve instances for this game version yet (403).",
    );
  });

  it('maps a 5xx to a 502 try-again error', async () => {
    mockStatus(503);
    await expect(fetchExpansionIndex('us', 'tok')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    await expect(fetchExpansionIndex('us', 'tok')).rejects.toThrow(
      'Failed to fetch expansion index from Blizzard (503). Please try again later.',
    );
  });
});
