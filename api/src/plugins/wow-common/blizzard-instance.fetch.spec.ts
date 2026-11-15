import { BadGatewayException, NotFoundException } from '@nestjs/common';
import {
  catalogueInstanceDetail,
  catalogueInstanceList,
  fetchAllInstancesFromApi,
  fetchInstanceDetailFromApi,
} from './blizzard-instance.fetch';
import { FOREVER_SEED_ID_BASE } from './instance-catalogue/instance-catalogue';

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
const ids = (rows: Array<{ id: number }>) => rows.map((r) => r.id);

/** ROK-2210: classic_era / wow_forever lists are the catalogue's, offline. */
describe('catalogueInstanceList (ROK-2210)', () => {
  it('lists Forever-only rows for wow_forever: 37 dungeons, 9 raids', () => {
    const list = catalogueInstanceList('wow_forever');
    if (!list) throw new Error('wow_forever must be catalogue-served');
    expect([list.dungeons.length, list.raids.length]).toEqual([37, 9]);
    expect(new Set(list.dungeons.map((d) => d.expansion))).toEqual(
      new Set(['Forever']),
    );
    expect(ids(list.dungeons)).toEqual(
      expect.arrayContaining([22901, 90_000_001]),
    );
    expect(ids(list.dungeons)).not.toContain(311);
    expect(ids(list.raids)).toEqual(expect.arrayContaining([760, 76, 754]));
    expect(ids(list.raids)).not.toContain(1301);
  });

  it('lists 28 dungeons / 7 raids labelled Classic for classic_era', () => {
    const list = catalogueInstanceList('classic_era');
    if (!list) throw new Error('classic_era must be catalogue-served');
    expect([list.dungeons.length, list.raids.length]).toEqual([28, 7]);
    expect(list.dungeons.filter(isSeed)).toEqual([]);
    expect(new Set(list.raids.map((r) => r.expansion))).toEqual(
      new Set(['Classic']),
    );
  });

  it('carries levelSource and wowheadZoneId on every row', () => {
    const list = catalogueInstanceList('wow_forever');
    expect(list?.dungeons.find((d) => d.id === 226)).toMatchObject({
      levelSource: 'classic_era',
      wowheadZoneId: 2437,
    });
    expect(list?.dungeons.find((d) => d.id === 90_000_001)).toMatchObject({
      levelSource: 'community',
    });
  });

  it.each(['retail', 'classic', 'classic_anniversary'] as const)(
    'returns null for the journal-served %s',
    (variant) => expect(catalogueInstanceList(variant)).toBeNull(),
  );
});

/** ROK-2210 D6: catalogue ids resolve locally; journal ids stay the journal's. */
describe('catalogueInstanceDetail (ROK-2210)', () => {
  it.each(['wow_forever', 'classic_era', 'retail'] as const)(
    'resolves UBRS 22901 for %s (not the SM: Graveyard id%%100 match)',
    (variant) => {
      expect(catalogueInstanceDetail(22901, variant)).toMatchObject({
        name: 'Upper Blackrock Spire',
        category: 'dungeon',
        maxPlayers: 10,
        minimumLevel: 55,
        maximumLevel: 60,
      });
    },
  );

  it.each(['wow_forever', 'classic_era', 'classic', 'retail'] as const)(
    'resolves Forever-new 90000001 for %s',
    (variant) => {
      expect(catalogueInstanceDetail(90_000_001, variant)).toMatchObject({
        name: 'The Hall of Thanes',
        expansion: 'Forever',
      });
    },
  );

  it('resolves 90000011 to the 20-player Forever Hyjal Summit', () => {
    expect(catalogueInstanceDetail(90_000_011, 'wow_forever')).toMatchObject({
      name: 'Hyjal Summit',
      category: 'raid',
      maxPlayers: 20,
      minimumLevel: 60,
      maximumLevel: 60,
    });
  });

  it('labels a Classic id by the viewer variant', () => {
    expect(catalogueInstanceDetail(226, 'wow_forever')?.expansion).toBe(
      'Forever',
    );
    expect(catalogueInstanceDetail(226, 'classic_era')?.expansion).toBe(
      'Classic',
    );
    expect(catalogueInstanceDetail(31601, 'classic')?.expansion).toBe(
      'Classic',
    );
  });

  it('leaves non-catalogue and real journal ids to the journal', () => {
    expect(catalogueInstanceDetail(311, 'wow_forever')).toBeNull();
    expect(catalogueInstanceDetail(1301, 'classic_era')).toBeNull();
    expect(catalogueInstanceDetail(226, 'retail')).toBeNull();
    expect(catalogueInstanceDetail(230, 'classic')).toBeNull();
  });
});

/** Journal-served variants keep the journal (ROK-1719 seed merge removed). */
describe('fetchAllInstancesFromApi — journal variants', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each(['classic', 'classic_anniversary', 'retail'] as const)(
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

  it('expands Scarlet Monastery into the catalogue wings for classic', async () => {
    mockJournal([], {
      'journal-expansion/68': {
        name: 'Classic',
        dungeons: [
          { id: 316, name: 'Scarlet Monastery' },
          { id: 229, name: 'Lower Blackrock Spire' },
        ],
        raids: [],
      },
    });
    const { dungeons } = await fetchAllInstancesFromApi('us', 'classic', 't');
    expect(dungeons.map((d) => [d.id, d.shortName, d.minimumLevel])).toEqual([
      [31601, 'SM:GY', 26],
      [31602, 'SM:Lib', 29],
      [31603, 'SM:Arm', 32],
      [31604, 'SM:Cath', 34],
      [229, 'LBRS', 55],
      [248, 'Ramps', 60],
    ]);
  });

  it('keeps the TBC Hyjal Summit at 70 for classic (journal overlay)', async () => {
    mockJournal();
    const { raids } = await fetchAllInstancesFromApi('us', 'classic', 't');
    expect(raids.find((r) => r.id === 750)).toMatchObject({
      minimumLevel: 70,
      maximumLevel: 70,
    });
  });
});
