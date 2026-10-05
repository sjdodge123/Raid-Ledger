import { BadGatewayException, NotFoundException } from '@nestjs/common';
import {
  fetchAllInstancesFromApi,
  fetchInstanceDetailFromApi,
} from './blizzard-instance.fetch';
import { FOREVER_SEED_ID_BASE } from './forever-instance-data';

/**
 * TDB:1784: a failed journal-instance call must surface as a 502 with a
 * readable message, not a raw Error that Nest turns into a bare 500.
 * Instance id 63 is below 10000, so it takes the real API path rather than
 * the synthetic sub-instance lookup.
 */
describe('fetchInstanceDetailFromApi — upstream failures', () => {
  afterEach(() => jest.restoreAllMocks());

  function mockStatus(status: number) {
    return jest
      .spyOn(global, 'fetch')
      .mockImplementation(() =>
        Promise.resolve(new Response('upstream', { status })),
      );
  }

  it('maps a 5xx to a 502 try-again error', async () => {
    const fetchSpy = mockStatus(503);
    const call = () => fetchInstanceDetailFromApi(63, 'us', 'retail', 'tok');
    await expect(call()).rejects.toBeInstanceOf(BadGatewayException);
    await expect(call()).rejects.toThrow(
      'Failed to fetch instance detail from Blizzard (503). Please try again later.',
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/data/wow/journal-instance/63?'),
      expect.anything(),
    );
  });

  it('maps a 404 (unknown journal-instance id) to a 404, not a retry 502', async () => {
    mockStatus(404);
    const call = () => fetchInstanceDetailFromApi(63, 'us', 'retail', 'tok');
    await expect(call()).rejects.toBeInstanceOf(NotFoundException);
    await expect(call()).rejects.toHaveProperty(
      'message',
      'Instance 63 not found',
    );
  });

  it('maps a 403 to a 502 saying instances are not served', async () => {
    mockStatus(403);
    const call = () =>
      fetchInstanceDetailFromApi(63, 'us', 'classic_era', 'tok');
    await expect(call()).rejects.toBeInstanceOf(BadGatewayException);
    await expect(call()).rejects.toHaveProperty(
      'message',
      "Blizzard's API doesn't serve instances for this game version yet (403).",
    );
  });
});

/** Journal fixture: one Classic and one TBC tier (TBC carries "Hyjal Summit"). */
const JOURNAL: Record<string, unknown> = {
  'journal-expansion/index': {
    tiers: [
      { id: 68, name: 'Classic' },
      { id: 70, name: 'Burning Crusade' },
    ],
  },
  'journal-expansion/68': {
    name: 'Classic',
    dungeons: [{ id: 63, name: 'Deadmines' }],
    raids: [{ id: 741, name: 'Molten Core' }],
  },
  'journal-expansion/70': {
    name: 'Burning Crusade',
    dungeons: [{ id: 248, name: 'Hellfire Ramparts' }],
    raids: [{ id: 750, name: 'Hyjal Summit' }],
  },
};

/** `failing` journal keys answer 503 (a partial journal outage). */
function mockJournal(
  failing: string[] = [],
  extra: Record<string, unknown> = {},
) {
  const journal = { ...JOURNAL, ...extra };
  return jest.spyOn(global, 'fetch').mockImplementation((input) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const key = Object.keys(journal).find((k) => url.includes(`/${k}?`));
    if (key && failing.includes(key))
      return Promise.resolve(new Response('down', { status: 503 }));
    const body = key ? JSON.stringify(journal[key]) : 'missing';
    return Promise.resolve(new Response(body, { status: key ? 200 : 404 }));
  });
}

const isSeed = (i: { id: number }) => i.id > FOREVER_SEED_ID_BASE;

/** ROK-1719: WoW: Forever lists vanilla + the hand-seeded Forever instances. */
describe('fetchAllInstancesFromApi — Forever seed (ROK-1719)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('adds the 9 seeded dungeons after the vanilla ones for wow_forever', async () => {
    mockJournal();
    const { dungeons } = await fetchAllInstancesFromApi(
      'us',
      'wow_forever',
      't',
    );
    expect(dungeons[0]).toMatchObject({ name: 'Deadmines' });
    expect(dungeons.filter(isSeed)).toHaveLength(9);
    expect(dungeons.find((d) => d.id === 90_000_001)).toEqual({
      id: 90_000_001,
      name: 'Hall of Thanes',
      shortName: 'HoT',
      expansion: 'Forever',
      minimumLevel: 13,
      maximumLevel: 18,
    });
    expect(dungeons.map((d) => d.name)).not.toContain('Hellfire Ramparts');
  });

  it('lists Forever Hyjal Summit at 60-60, never the TBC raid at 70', async () => {
    mockJournal();
    const { raids } = await fetchAllInstancesFromApi('us', 'wow_forever', 't');
    expect(raids.map((r) => [r.name, r.minimumLevel, r.maximumLevel])).toEqual([
      ['Molten Core', 60, 60],
      ['Barrow Deeps', 60, 60],
      ['Hyjal Summit', 60, 60],
    ]);
  });

  it.each(['classic_era', 'classic', 'classic_anniversary', 'retail'] as const)(
    'adds no seed rows for %s',
    async (variant) => {
      mockJournal();
      const { dungeons, raids } = await fetchAllInstancesFromApi(
        'us',
        variant,
        't',
      );
      expect([...dungeons, ...raids].filter(isSeed)).toEqual([]);
    },
  );
});

/** ROK-1719 Codex P2s: journal Forever rows keep seed levels; no partial cache. */
describe('fetchAllInstancesFromApi — Forever journal edge cases (ROK-1719)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('keeps Forever levels on a journal Forever Hyjal Summit (not TBC 70)', async () => {
    mockJournal([], {
      'journal-expansion/index': {
        tiers: [
          { id: 68, name: 'Classic' },
          { id: 70, name: 'Burning Crusade' },
          { id: 99, name: 'Forever' },
        ],
      },
      'journal-expansion/99': {
        name: 'Forever',
        raids: [{ id: 5001, name: 'Hyjal Summit' }],
      },
    });
    const { raids } = await fetchAllInstancesFromApi('us', 'wow_forever', 't');
    expect(raids.find((r) => r.name === 'Hyjal Summit')).toEqual({
      id: 5001,
      name: 'Hyjal Summit',
      shortName: 'HS',
      expansion: 'Forever',
      minimumLevel: 60,
      maximumLevel: 60,
    });
  });

  it('throws (so nothing is cached) when the Classic tier detail fails', async () => {
    mockJournal(['journal-expansion/68']);
    await expect(
      fetchAllInstancesFromApi('us', 'wow_forever', 't'),
    ).rejects.toThrow(
      'WoW: Forever instance list is missing the Classic journal tier',
    );
  });
});

describe('fetchInstanceDetailFromApi — Forever seed ids (ROK-1719)', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each(['wow_forever', 'classic_era'] as const)(
    'resolves 90000001 to Hall of Thanes without calling Blizzard (%s)',
    async (variant) => {
      const fetchSpy = mockJournal();
      const detail = await fetchInstanceDetailFromApi(
        90_000_001,
        'us',
        variant,
        't',
      );
      expect(detail.name).toBe('Hall of Thanes');
      expect(detail).toMatchObject({ category: 'dungeon', maxPlayers: 5 });
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it('resolves 90000011 to the 20-player Forever Hyjal Summit', async () => {
    mockJournal();
    const detail = await fetchInstanceDetailFromApi(
      90_000_011,
      'us',
      'wow_forever',
      't',
    );
    expect(detail).toMatchObject({
      name: 'Hyjal Summit',
      category: 'raid',
      maxPlayers: 20,
      minimumLevel: 60,
    });
  });
});
