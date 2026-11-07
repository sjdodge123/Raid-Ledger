/**
 * Unit tests for blizzard-professions.helpers (ROK-1130).
 *
 * Mirrors the structural template of blizzard-equipment.helpers (parser +
 * single fetch + null-vs-payload handling). After ROK-1130's fix
 * (`e23c2730`), the helper returns `null` whenever there is no actionable
 * data — 404, 5xx, network throw, AND 200 OK with empty primaries/secondaries.
 * Only a 200 OK with at least one profession entry yields a non-null payload.
 * The orchestrator uses the null signal to leave prior column values alone,
 * so automatic sync never clobbers manual entries with empty arrays.
 */
import { fetchCharacterProfessions } from './blizzard-professions.helpers';
import { at } from '../../common/testing/narrow';
import {
  getForeverNamespacePrefix,
  setForeverNamespacePrefix,
} from './forever-namespace.resolver';

const RETAIL_PAYLOAD = {
  _links: {},
  character: { name: 'thrall' },
  primaries: [
    {
      profession: { name: 'Tailoring', id: 197 },
      skill_points: 450,
      max_skill_points: 450,
      specializations: [
        {
          specialization_name: 'Spellfire Tailoring',
          specialization_id: 12,
          points_spent: 25,
        },
      ],
      tiers: [
        {
          tier: { name: 'Dragon Isles Tailoring', id: 2823 },
          skill_points: 100,
          max_skill_points: 100,
          known_recipes: [{ name: 'Frostweave Bag', id: 1 }],
        },
      ],
    },
  ],
  secondaries: [
    {
      profession: { name: 'Cooking', id: 185 },
      skill_points: 150,
      max_skill_points: 150,
    },
  ],
};

const fakeLogger = {
  warn: jest.fn(),
  log: jest.fn(),
  debug: jest.fn(),
};

beforeEach(() => {
  jest.restoreAllMocks();
  fakeLogger.warn.mockClear();
  fakeLogger.log.mockClear();
  fakeLogger.debug.mockClear();
});

function mockFetchOnce(status: number, body: unknown) {
  global.fetch = jest.fn().mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
}

describe('fetchCharacterProfessions — happy path', () => {
  it('parses a retail payload into the normalized shape', async () => {
    mockFetchOnce(200, RETAIL_PAYLOAD);

    const result = await fetchCharacterProfessions(
      'Thrall',
      'Area 52',
      'us',
      null,
      'token-1',
      fakeLogger,
    );

    expect(result).not.toBeNull();
    expect(result!.primary).toHaveLength(1);
    expect(result!.primary[0]?.name).toBe('Tailoring');
    expect(result!.primary[0]?.id).toBe(197);
    expect(result!.primary[0]?.slug).toBe('tailoring');
    expect(result!.primary[0]?.skillLevel).toBe(450);
    expect(result!.primary[0]?.maxSkillLevel).toBe(450);
    expect(result!.primary[0]?.tiers).toHaveLength(1);
    expect(result!.primary[0]?.tiers[0]?.name).toBe('Dragon Isles Tailoring');
    expect(result!.primary[0]?.tiers[0]?.id).toBe(2823);
    expect(result!.primary[0]?.tiers[0]?.skillLevel).toBe(100);
    expect(result!.primary[0]?.tiers[0]?.maxSkillLevel).toBe(100);
    expect(result!.secondary).toHaveLength(1);
    expect(result!.secondary[0]?.name).toBe('Cooking');
    expect(result!.secondary[0]?.slug).toBe('cooking');
    expect(result!.secondary[0]?.tiers).toEqual([]);
    expect(typeof result!.syncedAt).toBe('string');
    expect(result!.syncedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('derives slugs by lowercasing and replacing spaces with hyphens', async () => {
    mockFetchOnce(200, {
      primaries: [
        {
          profession: { name: 'Dragon Isles Mining', id: 999 },
          skill_points: 10,
          max_skill_points: 100,
          tiers: [],
        },
      ],
      secondaries: [],
    });
    const result = await fetchCharacterProfessions(
      'X',
      'Y',
      'us',
      null,
      't',
      fakeLogger,
    );
    expect(result!.primary[0]?.slug).toBe('dragon-isles-mining');
  });
});

describe('fetchCharacterProfessions — graceful handling', () => {
  it('returns null on 404 (leaves prior column / manual entry alone)', async () => {
    mockFetchOnce(404, { code: 404, detail: 'not found' });

    const result = await fetchCharacterProfessions(
      'Ghost',
      'Area 52',
      'us',
      null,
      'token-1',
      fakeLogger,
    );

    expect(result).toBeNull();
  });

  it('returns null on 500 (signals orchestrator to leave prior value alone)', async () => {
    mockFetchOnce(500, { error: 'upstream' });

    const result = await fetchCharacterProfessions(
      'X',
      'Y',
      'us',
      null,
      't',
      fakeLogger,
    );

    expect(result).toBeNull();
    expect(fakeLogger.warn).toHaveBeenCalled();
  });

  it('returns null when fetch throws (network/timeout)', async () => {
    global.fetch = jest.fn().mockRejectedValueOnce(new Error('ECONNRESET'));

    const result = await fetchCharacterProfessions(
      'X',
      'Y',
      'us',
      null,
      't',
      fakeLogger,
    );

    expect(result).toBeNull();
    expect(fakeLogger.warn).toHaveBeenCalled();
  });

  it('returns null when 200 OK but parsed primary AND secondary are empty (no real data — manual entry preserved)', async () => {
    mockFetchOnce(200, {});

    const result = await fetchCharacterProfessions(
      'X',
      'Y',
      'us',
      null,
      't',
      fakeLogger,
    );

    expect(result).toBeNull();
  });

  it('returns null when 200 OK but explicit empty primaries+secondaries arrays', async () => {
    mockFetchOnce(200, { primaries: [], secondaries: [] });

    const result = await fetchCharacterProfessions(
      'X',
      'Y',
      'us',
      null,
      't',
      fakeLogger,
    );

    expect(result).toBeNull();
  });

  it('drops top-level specializations array (only nested tiers persisted)', async () => {
    mockFetchOnce(200, RETAIL_PAYLOAD);

    const result = await fetchCharacterProfessions(
      'Thrall',
      'Area 52',
      'us',
      null,
      'token-1',
      fakeLogger,
    );

    // The output type does not expose a `specializations` key on entries.
    expect(result!.primary[0]).not.toHaveProperty('specializations');
    // And known_recipes must NOT leak through onto tiers.
    expect(at(at(result!.primary, 0).tiers, 0)).not.toHaveProperty(
      'known_recipes',
    );
  });
});

describe('fetchCharacterProfessions — Classic short-circuit', () => {
  it.each([
    ['classicann', 'Anniversary'],
    ['classic1x', 'Classic 1x'],
    ['classic', 'Classic'],
    ['classicwrath', 'Wrath Classic'],
  ])(
    'returns null without making an HTTP request for %s namespace (Blizzard %s API does not expose /professions)',
    async (prefix) => {
      const fetchSpy = jest.fn();
      global.fetch = fetchSpy;

      const result = await fetchCharacterProfessions(
        'Roknua',
        'Dreamscythe',
        'us',
        prefix,
        'token-1',
        fakeLogger,
      );

      expect(result).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it('does NOT short-circuit for retail (apiNamespacePrefix=null) — actually hits the API', async () => {
    mockFetchOnce(200, RETAIL_PAYLOAD);

    const result = await fetchCharacterProfessions(
      'Thrall',
      'Area 52',
      'us',
      null,
      'token-1',
      fakeLogger,
    );

    expect(result).not.toBeNull();
    expect(result!.primary.length).toBeGreaterThan(0);
  });
});

describe('fetchCharacterProfessions — realmless Forever (ROK-2102)', () => {
  let previousPrefix: string;

  beforeEach(() => {
    previousPrefix = getForeverNamespacePrefix();
    setForeverNamespacePrefix('forever');
  });

  afterEach(() => setForeverNamespacePrefix(previousPrefix));

  it('is attempted for the Forever alias, on the realmless path', async () => {
    mockFetchOnce(200, RETAIL_PAYLOAD);
    const result = await fetchCharacterProfessions(
      'Ana Forever',
      null,
      'us',
      'classicforever',
      'token-1',
      fakeLogger,
    );
    const fetchMock = global.fetch as jest.Mock;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://us.api.blizzard.com/profile/wow/character/ana-forever/professions?namespace=profile-forever-us&locale=en_US',
    );
    expect(result?.primary[0]?.name).toBe('Tailoring');
  });

  it('still skips Classic without a request', async () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy;
    const result = await fetchCharacterProfessions(
      'Roknua',
      'Dreamscythe',
      'us',
      'classicann',
      'token-1',
      fakeLogger,
    );
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns null on a Forever 404', async () => {
    mockFetchOnce(404, {});
    const result = await fetchCharacterProfessions(
      'Ana Forever',
      null,
      'us',
      'classicforever',
      'token-1',
      fakeLogger,
    );
    expect(result).toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

/** Fetch a payload of primaries only (tier-only shape) and return the result. */
async function fetchPrimaries(primaries: unknown[]) {
  mockFetchOnce(200, { primaries, secondaries: [] });
  return fetchCharacterProfessions('Ana', 'Y', 'us', null, 't', fakeLogger);
}

function tier(id: number, name: string, skill: number, max: number) {
  return { tier: { id, name }, skill_points: skill, max_skill_points: max };
}

describe('fetchCharacterProfessions — tier-only header (Forever 0/0 fix)', () => {
  it('takes the header from the single tier when top-level skill is absent', async () => {
    const result = await fetchPrimaries([
      {
        profession: { id: 186, name: 'Mining' },
        tiers: [tier(186, 'Mining', 95, 150)],
      },
    ]);
    const mining = at(result?.primary ?? [], 0);
    expect(mining.skillLevel).toBe(95);
    expect(mining.maxSkillLevel).toBe(150);
  });

  it('uses the tier with the highest max when there are several', async () => {
    const result = await fetchPrimaries([
      {
        profession: { id: 197, name: 'Tailoring' },
        tiers: [
          tier(2823, 'Dragon Isles Tailoring', 40, 100),
          tier(2540, 'Classic Tailoring', 300, 300),
          tier(2831, 'Khaz Algar Tailoring', 12, 100),
        ],
      },
    ]);
    const tailoring = at(result?.primary ?? [], 0);
    expect(tailoring.skillLevel).toBe(300);
    expect(tailoring.maxSkillLevel).toBe(300);
  });

  it('keeps 0/0 when there are neither top-level values nor tiers', async () => {
    const result = await fetchPrimaries([
      { profession: { id: 186, name: 'Mining' }, tiers: [] },
    ]);
    const mining = at(result?.primary ?? [], 0);
    expect(mining.skillLevel).toBe(0);
    expect(mining.maxSkillLevel).toBe(0);
  });
});
