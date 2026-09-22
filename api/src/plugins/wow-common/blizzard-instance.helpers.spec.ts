import { BadGatewayException } from '@nestjs/common';
import {
  fetchRealmListFromApi,
  filterByVariant,
} from './blizzard-instance.helpers';

/**
 * ROK-1563: WoW: Forever is a Classic-expansion-only variant. These cases lock
 * that in so a future edit can't quietly fall through to the retail (unfiltered)
 * branch.
 */
describe('filterByVariant — wow_forever (ROK-1563)', () => {
  const dungeons = [
    { id: 1, name: 'Deadmines', expansion: 'Classic' },
    { id: 2, name: 'Hellfire Ramparts', expansion: 'Burning Crusade' },
  ];
  const raids = [
    { id: 10, name: 'Molten Core', expansion: 'Classic' },
    { id: 11, name: 'Karazhan', expansion: 'Burning Crusade' },
  ];

  it('keeps Classic instances only', () => {
    const result = filterByVariant(dungeons, raids, 'wow_forever');
    expect(result.dungeons.map((d) => d.name)).toEqual(['Deadmines']);
    expect(result.raids.map((r) => r.name)).toEqual(['Molten Core']);
  });

  it('does not fall through to the unfiltered retail branch', () => {
    const result = filterByVariant(dungeons, raids, 'wow_forever');
    expect(result.dungeons).toHaveLength(1);
    expect(result.raids).toHaveLength(1);
  });

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
