/**
 * Community-relative vector-title pick (ROK-1939, spec §3 D1-D5, AC-1,
 * AC-2, AC-6, AC-7, AC-8).
 *
 * Every community below is fixed data; the expected z-scores are worked
 * out in each test's comment so a reader can check them by hand.
 */
import {
  TASTE_PROFILE_AXIS_POOL,
  VECTOR_TITLES,
  type IntensityMetricsDto,
  type TasteProfileDimensionsDto,
  type TasteProfilePoolAxis,
  type VectorTitle,
} from '@raid-ledger/contract';
import {
  axisZScore,
  computeCommunityAxisStats,
  pickRelativeTitles,
} from './archetype-community.helpers';
import { VECTOR_TITLE_DESCRIPTIONS } from './archetype-copy';
import { deriveArchetype } from './archetype.helpers';

function dims(
  overrides: Partial<TasteProfileDimensionsDto> = {},
): TasteProfileDimensionsDto {
  const base = Object.fromEntries(
    TASTE_PROFILE_AXIS_POOL.map((axis) => [axis, 0]),
  ) as TasteProfileDimensionsDto;
  return { ...base, ...overrides };
}

const METRICS: IntensityMetricsDto = {
  intensity: 50,
  focus: 0,
  breadth: 0,
  consistency: 0,
};

/** Titles for `player` inside a community of `player` + `others`. */
function pick(
  player: TasteProfileDimensionsDto,
  others: TasteProfileDimensionsDto[],
): VectorTitle[] {
  return pickRelativeTitles(
    player,
    computeCommunityAxisStats([player, ...others]),
  );
}

function times(
  n: number,
  overrides: Partial<TasteProfileDimensionsDto>,
): TasteProfileDimensionsDto[] {
  return Array.from({ length: n }, () => dims(overrides));
}

describe('computeCommunityAxisStats (D1 stats math)', () => {
  // Mutation: divide by (n - 1) (sample SD) → sd 14.14, this goes red.
  it('returns the population mean and SD per axis', () => {
    const stats = computeCommunityAxisStats([
      dims({ horror: 10 }),
      dims({ horror: 30 }),
    ]);

    expect(stats.size).toBe(2);
    expect(stats.mean.horror).toBe(20);
    expect(stats.sd.horror).toBe(10);
    expect(stats.mean.pvp).toBe(0);
    expect(stats.sd.pvp).toBe(0);
  });

  it('returns size 0 and zero stats for an empty community', () => {
    const stats = computeCommunityAxisStats([]);

    expect(stats.size).toBe(0);
    expect(stats.mean.fps).toBe(0);
    expect(stats.sd.fps).toBe(0);
  });

  // Mutation: drop Math.max(sd, SD_FLOOR) → 20 / 0 = Infinity, red.
  it('divides by SD_FLOOR (10) when the spread is smaller', () => {
    const stats = computeCommunityAxisStats(times(3, {}));

    expect(axisZScore(20, 'horror', stats)).toBe(2);
  });
});

describe('pickRelativeTitles — D1 relative score', () => {
  // AC-1. 12 profiles. pvp: 100, 10×95, 90 → mean 95, sd 2.04 → floored
  // to 10 → z 0.5. horror: 60, 11×0 → mean 5, sd 16.58 → z 3.32.
  // Mutation: swap pickRelativeTitles for pickTopTitles → ['Duelist'].
  it('titles a pvp-100 player Nightcrawler when horror is what sets them apart', () => {
    const player = dims({ pvp: 100, horror: 60 });
    const others = [...times(10, { pvp: 95 }), dims({ pvp: 90 })];

    expect(pick(player, others)).toEqual(['Nightcrawler']);
  });

  // 6 profiles, all pvp 100 (z 0). survival 40 vs 5×39 → sd 0.37 → floored
  // → z 0.08. horror 60, 30, 4×0 → sd 22.9 → z 1.96.
  // Mutation: SD_FLOOR 10 → 0.1 → survival z 2.24 → ['Survivor', …], red.
  it('the SD floor stops a near-constant axis from winning on a tiny spread', () => {
    const player = dims({ pvp: 100, survival: 40, horror: 60 });
    const others = [
      dims({ pvp: 100, survival: 39, horror: 30 }),
      ...times(4, { pvp: 100, survival: 39 }),
    ];

    expect(pick(player, others)).toEqual(['Nightcrawler']);
  });
});

describe('pickRelativeTitles — D2 grounding floor', () => {
  // horror 12 vs 5×0 → z (12-2)/10 = 1.0; pvp shared → z 0.
  // Mutation: drop the raw >= RAW_FLOOR filter → ['Nightcrawler'], red.
  it('never titles a player by an axis they barely play (raw < 30)', () => {
    const player = dims({ pvp: 100, horror: 12 });

    expect(pick(player, times(5, { pvp: 100 }))).toEqual(['Duelist']);
  });

  // Mutation: drop the filter → horror/pvp 29 earn a title, red.
  it('returns no titles when no title reaches a raw score of 30', () => {
    const player = dims({ pvp: 29, horror: 29 });

    expect(pick(player, times(5, {}))).toEqual([]);
  });
});

describe('pickRelativeTitles — D3 second title window', () => {
  // horror 60 vs 5×0 → z 2.236. puzzle 60, 30, 4×0 → z 1.964. Gap 0.27.
  // Mutation: RELATIVE_WINDOW 0.5 → 0.2 → second title dropped, red.
  it('keeps the second title when it is within 0.5 z of the first', () => {
    const player = dims({ pvp: 100, horror: 60, puzzle: 60 });
    const others = [dims({ pvp: 100, puzzle: 30 }), ...times(4, { pvp: 100 })];

    expect(pick(player, others)).toEqual(['Nightcrawler', 'Puzzler']);
  });

  // puzzle 60, 40, 40, 3×0 → z 1.511. Gap 0.725.
  // Mutation: RELATIVE_WINDOW 0.5 → 1.0 → 'Puzzler' kept, red.
  it('drops the second title when it trails by more than 0.5 z', () => {
    const player = dims({ pvp: 100, horror: 60, puzzle: 60 });
    const others = [
      ...times(2, { pvp: 100, puzzle: 40 }),
      ...times(3, { pvp: 100 }),
    ];

    expect(pick(player, others)).toEqual(['Nightcrawler']);
  });
});

describe('pickRelativeTitles — D4 ties', () => {
  // horror 60 and racing 40, each a lone outlier of 6 → both z = √5.
  // Mutation: drop the raw-score tie-break → pool order → ['Racer', …].
  it('resolves equal z by the higher raw score first', () => {
    const player = dims({ pvp: 100, horror: 60, racing: 40 });

    expect(pick(player, times(5, { pvp: 100 }))).toEqual([
      'Nightcrawler',
      'Racer',
    ]);
  });

  // racing / horror / puzzle all 60 and lone outliers → equal z AND raw.
  // Pool order: racing (7) < horror (18) < puzzle (21); cap keeps two.
  // Mutation: reverse the pool-index comparator → ['Puzzler', …], red.
  it('then by pool order, and never returns more than two titles', () => {
    const player = dims({ pvp: 100, horror: 60, racing: 60, puzzle: 60 });

    expect(pick(player, times(5, { pvp: 100 }))).toEqual([
      'Racer',
      'Nightcrawler',
    ]);
  });
});

describe('deriveArchetype — D5 thin-community fallback (AC-2)', () => {
  const player = dims({ pvp: 100, horror: 60 });
  const community = (others: number) =>
    computeCommunityAxisStats([player, ...times(others, { pvp: 100 })]);
  const titlesWith = (stats: ReturnType<typeof community> | undefined) =>
    deriveArchetype({
      hasPresenceData: true,
      intensityMetrics: METRICS,
      dimensions: player,
      community: stats,
    }).vectorTitles;

  // 5 profiles: horror 60 vs 4×0 → z 2 → relative rule.
  // Mutation: `size >= MIN_COMMUNITY` → `>` (or MIN 5 → 6) → Duelist, red.
  it('uses the relative rule from exactly 5 profiles', () => {
    expect(titlesWith(community(4))).toEqual(['Nightcrawler']);
  });

  // Mutation: MIN_COMMUNITY 5 → 4 → 4 profiles go relative, red.
  it('falls back to the raw ROK-1083 rule below 5 profiles', () => {
    expect(titlesWith(community(3))).toEqual(['Duelist']);
  });

  it('is byte-identical to the no-stats result when the community is thin', () => {
    const base = { hasPresenceData: true, intensityMetrics: METRICS };
    const thin = deriveArchetype({
      ...base,
      dimensions: player,
      community: community(3),
    });

    expect(thin).toEqual(deriveArchetype({ ...base, dimensions: player }));
    expect(titlesWith(undefined)).toEqual(['Duelist']);
  });

  it('pairs descriptions with the relative titles', () => {
    const result = deriveArchetype({
      hasPresenceData: true,
      intensityMetrics: METRICS,
      dimensions: player,
      community: community(4),
    });

    expect(result.descriptions.titles).toEqual([
      VECTOR_TITLE_DESCRIPTIONS.Nightcrawler,
    ]);
  });
});

/** Every pool axis → the title its distinctive player must earn. */
const AXIS_TITLE: Record<TasteProfilePoolAxis, VectorTitle> = {
  co_op: 'Companion',
  pvp: 'Duelist',
  battle_royale: 'Last One Standing',
  mmo: 'Raider',
  moba: 'Tactician',
  fighting: 'Brawler',
  shooter: 'Marksman',
  racing: 'Racer',
  sports: 'Athlete',
  rpg: 'Hero',
  fantasy: 'Hero',
  sci_fi: 'Spacefarer',
  adventure: 'Wayfarer',
  strategy: 'Strategist',
  survival: 'Survivor',
  crafting: 'Architect',
  automation: 'Architect',
  sandbox: 'Architect',
  horror: 'Nightcrawler',
  social: 'Socialite',
  roguelike: 'Risk Taker',
  puzzle: 'Puzzler',
  platformer: 'Acrobat',
  stealth: 'Operative',
  fps: 'Gunslinger',
};

describe('AC-7 — every pool axis can win', () => {
  it('covers all 25 pool axes', () => {
    expect(Object.keys(AXIS_TITLE).sort()).toEqual(
      [...TASTE_PROFILE_AXIS_POOL].sort(),
    );
  });

  // Six profiles share a base axis at 100 (z 0); the player also has the
  // target at 70 vs 5×0 → z √5. The raw rule would give the base noun.
  // Mutation: delete `Gunslinger: ['fps']` from VECTOR_TITLE_AXES → the
  // fps row gets 'Duelist', red.
  it.each(
    TASTE_PROFILE_AXIS_POOL.map((axis) => [axis, AXIS_TITLE[axis]] as const),
  )('a player distinctive on %s is titled %s', (axis, title) => {
    const shared: TasteProfilePoolAxis = axis === 'pvp' ? 'co_op' : 'pvp';
    const player = dims({ [shared]: 100, [axis]: 70 });

    expect(pick(player, times(5, { [shared]: 100 }))).toEqual([title]);
  });
});

describe('AC-6 — distribution over a prod-shaped community of 20', () => {
  // Everyone plays the shared pvp/shooter game (pvp 100 → z 0). 4 "core"
  // players lean harder on it (shooter 90 vs mean 78, sd 6 → floored → z
  // 1.2 → Marksman). 16 players add one side genre at 60, two per genre
  // (mean 6, sd 18 → z 3). Expected title-1s: Marksman 4, eight others 2
  // each — 9 distinct, max 20%.
  // Mutation: swap pickRelativeTitles for pickTopTitles → 20 × Duelist.
  const SIDE_AXES: TasteProfilePoolAxis[] = [
    'horror',
    'rpg',
    'survival',
    'strategy',
    'racing',
    'puzzle',
    'mmo',
    'crafting',
  ];
  const community: TasteProfileDimensionsDto[] = [
    ...times(4, { pvp: 100, shooter: 90 }),
    ...SIDE_AXES.flatMap((axis) =>
      times(2, { pvp: 100, shooter: 75, [axis]: 60 }),
    ),
  ];

  it('no title-1 exceeds 25% and at least 8 distinct title-1s appear', () => {
    const stats = computeCommunityAxisStats(community);
    const counts = new Map<VectorTitle, number>();
    for (const profile of community) {
      const [first] = pickRelativeTitles(profile, stats);
      if (first) counts.set(first, (counts.get(first) ?? 0) + 1);
    }

    expect(Math.max(...counts.values())).toBeLessThanOrEqual(5);
    expect(counts.size).toBeGreaterThanOrEqual(8);
    expect(counts.get('Marksman')).toBe(4);
    expect(counts.get('Duelist')).toBeUndefined();
  });
});

describe('AC-8 — fps noun in the contract', () => {
  it('VECTOR_TITLES ends with Gunslinger and it has copy', () => {
    expect(VECTOR_TITLES[VECTOR_TITLES.length - 1]).toBe('Gunslinger');
    expect(VECTOR_TITLE_DESCRIPTIONS.Gunslinger.length).toBeGreaterThan(0);
  });
});
