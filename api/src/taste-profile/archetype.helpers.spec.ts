/**
 * Archetype derivation unit tests (ROK-1083 — new two-layer shape).
 *
 * The helper replaces the old 5-value enum ladder with a composed
 * {intensityTier, vectorTitles, descriptions} shape.
 *
 * Tier thresholds (inclusive on the lower bound):
 *   intensity < 35            -> Casual
 *   35 ≤ intensity < 60       -> Regular
 *   60 ≤ intensity < 85       -> Dedicated
 *   85 ≤ intensity            -> Hardcore
 *
 * Vector-title composition:
 *   - score per title uses raw axis value (single-axis) or max of
 *     component axes (multi-axis: Hero = max(rpg, fantasy);
 *     Architect = max(crafting, automation, sandbox))
 *   - top-axis floor: if the top score < 30, vectorTitles = []
 *   - close window: if second score ≥ 30 AND (first - second) ≤ 10,
 *     emit both titles; else one
 *   - cap at 2
 *   - tie-break by TASTE_PROFILE_AXIS_POOL order (earlier wins)
 */
import {
  INTENSITY_TIERS,
  TASTE_PROFILE_AXIS_POOL,
  VECTOR_TITLES,
  type ArchetypeDto,
  type IntensityMetricsDto,
  type IntensityTier,
  type TasteProfileDimensionsDto,
  type VectorTitle,
} from '@raid-ledger/contract';
import { deriveArchetype } from './archetype.helpers';

function makeDimensions(
  overrides: Partial<TasteProfileDimensionsDto> = {},
): TasteProfileDimensionsDto {
  const base = Object.fromEntries(
    TASTE_PROFILE_AXIS_POOL.map((axis) => [axis, 0]),
  ) as TasteProfileDimensionsDto;
  return { ...base, ...overrides };
}

function makeMetrics(
  overrides: Partial<IntensityMetricsDto> = {},
): IntensityMetricsDto {
  return {
    intensity: 0,
    focus: 0,
    breadth: 0,
    consistency: 0,
    ...overrides,
  };
}

describe('deriveArchetype (ROK-1083 composed shape)', () => {
  describe('AC regression — high intensity is never Casual', () => {
    it('returns Hardcore for intensity 95 / focus 77 / breadth 20 / consistency 0 (old AC-1 regression)', () => {
      const result: ArchetypeDto = deriveArchetype({
        intensityMetrics: makeMetrics({
          intensity: 95,
          focus: 77,
          breadth: 20,
          consistency: 0,
        }),
        dimensions: makeDimensions(),
      });

      expect(result.intensityTier).toBe('Hardcore');
      expect(result.intensityTier).not.toBe('Casual');
    });

    it('returns Casual for intensity 34 with all other signals zero (AC 2)', () => {
      const result = deriveArchetype({
        intensityMetrics: makeMetrics({ intensity: 34 }),
        dimensions: makeDimensions(),
      });

      expect(result.intensityTier).toBe('Casual');
    });

    it('returns Hardcore with empty vectorTitles for high-intensity / low axis player (AC 3)', () => {
      const result = deriveArchetype({
        intensityMetrics: makeMetrics({
          intensity: 90,
          focus: 10,
          breadth: 10,
          consistency: 0,
        }),
        dimensions: makeDimensions(),
      });

      expect(result.intensityTier).toBe('Hardcore');
      expect(result.vectorTitles).toEqual([]);
    });
  });

  describe('intensity tier boundaries (AC 4)', () => {
    it.each<[number, IntensityTier]>([
      [34, 'Casual'],
      [35, 'Regular'],
      [59, 'Regular'],
      [60, 'Dedicated'],
      [84, 'Dedicated'],
      [85, 'Hardcore'],
    ])('intensity=%i → %s', (intensity, expectedTier) => {
      const result = deriveArchetype({
        intensityMetrics: makeMetrics({ intensity }),
        dimensions: makeDimensions(),
      });

      expect(result.intensityTier).toBe(expectedTier);
    });
  });

  describe('top-axis floor (AC 5)', () => {
    it('emits no vectorTitles when the top score is 29', () => {
      const result = deriveArchetype({
        intensityMetrics: makeMetrics({ intensity: 50 }),
        dimensions: makeDimensions({ pvp: 29 }),
      });

      expect(result.vectorTitles).toEqual([]);
    });

    it('emits a single vectorTitle when the top score is exactly 30', () => {
      const result = deriveArchetype({
        intensityMetrics: makeMetrics({ intensity: 50 }),
        dimensions: makeDimensions({ pvp: 30 }),
      });

      expect(result.vectorTitles).toHaveLength(1);
      expect(result.vectorTitles[0]).toBe<VectorTitle>('Duelist');
    });
  });

  describe('close-window (AC 6)', () => {
    it('emits both titles when diff ≤ 10 and both ≥ 30 (higher score first)', () => {
      const result = deriveArchetype({
        intensityMetrics: makeMetrics({ intensity: 50 }),
        dimensions: makeDimensions({ pvp: 80, mmo: 72 }),
      });

      expect(result.vectorTitles).toEqual<VectorTitle[]>(['Duelist', 'Raider']);
    });

    it('emits a single title when diff > 10', () => {
      const result = deriveArchetype({
        intensityMetrics: makeMetrics({ intensity: 50 }),
        dimensions: makeDimensions({ pvp: 80, mmo: 69 }),
      });

      expect(result.vectorTitles).toEqual<VectorTitle[]>(['Duelist']);
    });
  });

  describe('cap at 2 (AC 8)', () => {
    it('never emits more than two titles even when 3+ scores are within the window', () => {
      const result = deriveArchetype({
        intensityMetrics: makeMetrics({ intensity: 50 }),
        dimensions: makeDimensions({ pvp: 80, mmo: 78, rpg: 76 }),
      });

      expect(result.vectorTitles).toHaveLength(2);
      expect(result.vectorTitles).toEqual<VectorTitle[]>(['Duelist', 'Raider']);
      expect(result.vectorTitles).not.toContain<VectorTitle>('Hero');
    });
  });

  describe('tie-break determinism (AC 7)', () => {
    it('resolves equal scores by TASTE_PROFILE_AXIS_POOL order (pvp before mmo)', () => {
      // pvp is index 1, mmo is index 3 in TASTE_PROFILE_AXIS_POOL — pvp wins slot 0
      const result = deriveArchetype({
        intensityMetrics: makeMetrics({ intensity: 50 }),
        dimensions: makeDimensions({ pvp: 70, mmo: 70 }),
      });

      expect(result.vectorTitles).toEqual<VectorTitle[]>(['Duelist', 'Raider']);
    });

    it('resolves equal scores at the cap boundary (3-way tie → pvp + mmo, rpg dropped)', () => {
      // pool order: pvp(1) < mmo(3) < rpg(9) — first two win, third dropped by cap
      const result = deriveArchetype({
        intensityMetrics: makeMetrics({ intensity: 50 }),
        dimensions: makeDimensions({ pvp: 70, mmo: 70, rpg: 70 }),
      });

      expect(result.vectorTitles).toEqual<VectorTitle[]>(['Duelist', 'Raider']);
    });
  });

  describe('multi-axis scoring (max of components)', () => {
    it('Hero uses max(rpg, fantasy) and beats lone single-axis competitors', () => {
      // Hero score = max(50, 40) = 50, beats any other axis (all 0)
      const result = deriveArchetype({
        intensityMetrics: makeMetrics({ intensity: 50 }),
        dimensions: makeDimensions({ rpg: 50, fantasy: 40 }),
      });

      expect(result.vectorTitles).toEqual<VectorTitle[]>(['Hero']);
    });

    it('Architect uses max(crafting, automation, sandbox)', () => {
      const result = deriveArchetype({
        intensityMetrics: makeMetrics({ intensity: 50 }),
        dimensions: makeDimensions({
          crafting: 45,
          automation: 30,
          sandbox: 0,
        }),
      });

      expect(result.vectorTitles).toEqual<VectorTitle[]>(['Architect']);
    });
  });

  describe('descriptions shape', () => {
    it('returns a non-empty tier description and one description per vector title', () => {
      const result = deriveArchetype({
        intensityMetrics: makeMetrics({ intensity: 90 }),
        dimensions: makeDimensions({ pvp: 80, mmo: 72 }),
      });

      expect(typeof result.descriptions.tier).toBe('string');
      expect(result.descriptions.tier.length).toBeGreaterThan(0);
      expect(result.descriptions.titles).toHaveLength(
        result.vectorTitles.length,
      );
      for (const description of result.descriptions.titles) {
        expect(typeof description).toBe('string');
        expect(description.length).toBeGreaterThan(0);
      }
    });

    it('returns empty titles description array when vectorTitles is empty', () => {
      const result = deriveArchetype({
        intensityMetrics: makeMetrics({ intensity: 90 }),
        dimensions: makeDimensions(),
      });

      expect(result.vectorTitles).toEqual([]);
      expect(result.descriptions.titles).toEqual([]);
      expect(typeof result.descriptions.tier).toBe('string');
      expect(result.descriptions.tier.length).toBeGreaterThan(0);
    });
  });

  describe('contract sanity', () => {
    it('only returns tiers enumerated in INTENSITY_TIERS', () => {
      for (const intensity of [0, 34, 35, 59, 60, 84, 85, 100]) {
        const result = deriveArchetype({
          intensityMetrics: makeMetrics({ intensity }),
          dimensions: makeDimensions(),
        });

        expect(INTENSITY_TIERS).toContain(result.intensityTier);
      }
    });

    it('only returns titles enumerated in VECTOR_TITLES', () => {
      const result = deriveArchetype({
        intensityMetrics: makeMetrics({ intensity: 50 }),
        dimensions: makeDimensions({ pvp: 80, mmo: 72 }),
      });

      for (const title of result.vectorTitles) {
        expect(VECTOR_TITLES).toContain(title);
      }
    });
  });
});
