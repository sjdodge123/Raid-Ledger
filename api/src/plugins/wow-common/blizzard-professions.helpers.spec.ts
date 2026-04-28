/**
 * Unit tests for blizzard-professions.helpers (ROK-1130).
 *
 * Mirrors the structural template of blizzard-equipment.helpers (parser +
 * single fetch + 404-vs-5xx handling). Architect §3 requires the helper
 * to return a normalized payload for 404 (`{ primary: [], secondary: [], syncedAt }`)
 * and `null` for any other failure (5xx, network) — the orchestrator uses
 * the null signal to leave prior column values alone.
 */
import { fetchCharacterProfessions } from './blizzard-professions.helpers';

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
  } as Response) as unknown as typeof fetch;
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
    expect(result!.primary[0].name).toBe('Tailoring');
    expect(result!.primary[0].id).toBe(197);
    expect(result!.primary[0].slug).toBe('tailoring');
    expect(result!.primary[0].skillLevel).toBe(450);
    expect(result!.primary[0].maxSkillLevel).toBe(450);
    expect(result!.primary[0].tiers).toHaveLength(1);
    expect(result!.primary[0].tiers[0].name).toBe('Dragon Isles Tailoring');
    expect(result!.primary[0].tiers[0].id).toBe(2823);
    expect(result!.primary[0].tiers[0].skillLevel).toBe(100);
    expect(result!.primary[0].tiers[0].maxSkillLevel).toBe(100);
    expect(result!.secondary).toHaveLength(1);
    expect(result!.secondary[0].name).toBe('Cooking');
    expect(result!.secondary[0].slug).toBe('cooking');
    expect(result!.secondary[0].tiers).toEqual([]);
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
    expect(result!.primary[0].slug).toBe('dragon-isles-mining');
  });
});

describe('fetchCharacterProfessions — graceful handling', () => {
  it('returns empty arrays + syncedAt on 404 (no throw)', async () => {
    mockFetchOnce(404, { code: 404, detail: 'not found' });

    const result = await fetchCharacterProfessions(
      'Ghost',
      'Area 52',
      'us',
      null,
      'token-1',
      fakeLogger,
    );

    expect(result).not.toBeNull();
    expect(result!.primary).toEqual([]);
    expect(result!.secondary).toEqual([]);
    expect(typeof result!.syncedAt).toBe('string');
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
    global.fetch = jest
      .fn()
      .mockRejectedValueOnce(
        new Error('ECONNRESET'),
      ) as unknown as typeof fetch;

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

  it('treats missing primaries/secondaries arrays as empty', async () => {
    mockFetchOnce(200, {});

    const result = await fetchCharacterProfessions(
      'X',
      'Y',
      'us',
      null,
      't',
      fakeLogger,
    );

    expect(result).not.toBeNull();
    expect(result!.primary).toEqual([]);
    expect(result!.secondary).toEqual([]);
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
    expect(result!.primary[0].tiers[0]).not.toHaveProperty('known_recipes');
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
      global.fetch = fetchSpy as unknown as typeof fetch;

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

  it('does NOT short-circuit for retail (apiNamespacePrefix=null)', async () => {
    mockFetchOnce(200, { primaries: [], secondaries: [] });

    const result = await fetchCharacterProfessions(
      'Thrall',
      'Area 52',
      'us',
      null,
      'token-1',
      fakeLogger,
    );

    expect(result).not.toBeNull();
    expect(result!.primary).toEqual([]);
    expect(result!.secondary).toEqual([]);
  });
});
