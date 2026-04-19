/**
 * Unit tests for TasteProfileContextBuilder (ROK-950).
 *
 * Written TDD-style BEFORE the builder exists — compilation will fail
 * until the dev creates the service, which counts as a valid TDD failure.
 *
 * ACs covered:
 * - AC 3: Co-play partner tastes included in AI context
 * - AC 7: Graceful degradation — missing vectors, empty user list
 * - AC 8: Unit tests exist
 */
import { Test } from '@nestjs/testing';
import type {
  CoPlayPartnerRow,
  TasteProfileResult,
} from '../../taste-profile/queries/taste-profile-queries';
import { TasteProfileService } from '../../taste-profile/taste-profile.service';
import { TasteProfileContextBuilder } from './taste-profile-context.builder';

// ─── Helpers ─────────────────────────────────────────────────────

/**
 * Build a plausible taste profile result for a user. The dev agent
 * doesn't care which values we pick — the builder should read
 * `dimensions` and `intensityMetrics` verbatim from this source.
 */
function buildProfile(overrides: {
  userId: number;
  dimensions?: Record<string, number>;
  coPlayPartners?: CoPlayPartnerRow[];
  archetype?: TasteProfileResult['archetype'];
  intensityMetrics?: TasteProfileResult['intensityMetrics'];
}): TasteProfileResult {
  // Use the full pool but we only need *some* values non-zero to test sort.
  const zeroDims = {
    co_op: 0,
    pvp: 0,
    battle_royale: 0,
    mmo: 0,
    moba: 0,
    fighting: 0,
    shooter: 0,
    racing: 0,
    sports: 0,
    rpg: 0,
    fantasy: 0,
    sci_fi: 0,
    adventure: 0,
    strategy: 0,
    survival: 0,
    crafting: 0,
    automation: 0,
    sandbox: 0,
    horror: 0,
    social: 0,
    roguelike: 0,
    puzzle: 0,
    platformer: 0,
    stealth: 0,
  };
  return {
    userId: overrides.userId,
    dimensions: {
      ...zeroDims,
      ...(overrides.dimensions ?? {}),
    } as TasteProfileResult['dimensions'],
    intensityMetrics: overrides.intensityMetrics ?? {
      intensity: 60,
      focus: 40,
      breadth: 55,
      consistency: 70,
    },
    archetype: overrides.archetype ?? 'Explorer',
    coPlayPartners: overrides.coPlayPartners ?? [],
    computedAt: new Date('2026-04-01T00:00:00Z').toISOString(),
  };
}

function buildPartner(
  overrides: Partial<CoPlayPartnerRow> & { userId: number },
): CoPlayPartnerRow {
  return {
    userId: overrides.userId,
    username: overrides.username ?? `user${overrides.userId}`,
    avatar: overrides.avatar ?? null,
    sessionCount: overrides.sessionCount ?? 5,
    totalMinutes: overrides.totalMinutes ?? 120,
    lastPlayedAt:
      overrides.lastPlayedAt ?? new Date('2026-04-01T00:00:00Z').toISOString(),
  };
}

// ─── Module setup ───────────────────────────────────────────────

describe('TasteProfileContextBuilder', () => {
  let builder: TasteProfileContextBuilder;
  let mockTasteProfileService: {
    getTasteProfile: jest.Mock<Promise<TasteProfileResult | null>, [number]>;
  };

  beforeEach(async () => {
    mockTasteProfileService = {
      getTasteProfile: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        TasteProfileContextBuilder,
        {
          provide: TasteProfileService,
          useValue: mockTasteProfileService,
        },
      ],
    }).compile();

    builder = module.get(TasteProfileContextBuilder);
  });

  // ─── Empty / degenerate inputs ─────────────────────────────

  describe('empty input', () => {
    it('returns { contexts: [], missingUserIds: [] } for an empty userIds array', async () => {
      const result = await builder.build([]);

      expect(result).toBeDefined();
      expect(result.contexts).toEqual([]);
      expect(result.missingUserIds).toEqual([]);
      expect(mockTasteProfileService.getTasteProfile).not.toHaveBeenCalled();
    });
  });

  // ─── Happy path — full vector ─────────────────────────────

  describe('full vector input', () => {
    it('returns topAxes (≤5) sorted by score DESC', async () => {
      mockTasteProfileService.getTasteProfile.mockResolvedValueOnce(
        buildProfile({
          userId: 1,
          dimensions: {
            rpg: 90,
            mmo: 80,
            co_op: 70,
            fantasy: 60,
            strategy: 50,
            pvp: 40,
            racing: 10,
          },
        }),
      );

      const result = await builder.build([1]);

      expect(result.missingUserIds).toEqual([]);
      expect(result.contexts).toHaveLength(1);
      const topAxes = result.contexts[0].topAxes;
      expect(topAxes.length).toBeLessThanOrEqual(5);
      for (let i = 1; i < topAxes.length; i++) {
        expect(topAxes[i - 1].score).toBeGreaterThanOrEqual(topAxes[i].score);
      }
      // With our seeded dimensions the top axis should be rpg (90)
      expect(topAxes[0].axis).toBe('rpg');
    });

    it('returns lowAxes (≤3) sorted by score ASC', async () => {
      mockTasteProfileService.getTasteProfile.mockResolvedValueOnce(
        buildProfile({
          userId: 1,
          dimensions: {
            rpg: 90,
            mmo: 80,
            racing: 10,
            sports: 5,
            sandbox: 2,
            horror: 1,
          },
        }),
      );

      const result = await builder.build([1]);

      const lowAxes = result.contexts[0].lowAxes;
      expect(lowAxes.length).toBeLessThanOrEqual(3);
      for (let i = 1; i < lowAxes.length; i++) {
        expect(lowAxes[i - 1].score).toBeLessThanOrEqual(lowAxes[i].score);
      }
      // Lowest axis first — horror (1)
      if (lowAxes.length > 0) {
        expect(lowAxes[0].score).toBeLessThanOrEqual(10);
      }
    });

    it('passes archetype and intensityMetrics through from source (AC 3 anchor)', async () => {
      mockTasteProfileService.getTasteProfile.mockResolvedValueOnce(
        buildProfile({
          userId: 1,
          archetype: 'Dedicated',
          intensityMetrics: {
            intensity: 85,
            focus: 70,
            breadth: 50,
            consistency: 90,
          },
        }),
      );

      const result = await builder.build([1]);
      const ctx = result.contexts[0];
      expect(ctx.archetype).toBe('Dedicated');
      expect(ctx.intensityMetrics).toEqual({
        intensity: 85,
        focus: 70,
        breadth: 50,
        consistency: 90,
      });
    });
  });

  // ─── Missing vector ─────────────────────────────

  describe('missing vector', () => {
    it('places user in missingUserIds when TasteProfileService returns null', async () => {
      mockTasteProfileService.getTasteProfile.mockResolvedValueOnce(null);

      const result = await builder.build([42]);

      expect(result.contexts).toEqual([]);
      expect(result.missingUserIds).toEqual([42]);
    });

    it('mixes present + missing users into the correct buckets', async () => {
      mockTasteProfileService.getTasteProfile.mockImplementation(
        (id: number) => {
          if (id === 1)
            return Promise.resolve(
              buildProfile({ userId: 1, dimensions: { rpg: 80 } }),
            );
          return Promise.resolve(null);
        },
      );

      const result = await builder.build([1, 2, 3]);

      expect(result.contexts).toHaveLength(1);
      expect(result.contexts[0].userId).toBe(1);
      expect(result.missingUserIds).toEqual(expect.arrayContaining([2, 3]));
      expect(result.missingUserIds).toHaveLength(2);
    });
  });

  // ─── Co-play partners (AC 3) ─────────────────────────────

  describe('co-play partners', () => {
    it('attaches up to 5 partners from the anchor profile', async () => {
      const partners = Array.from({ length: 8 }, (_, i) =>
        buildPartner({ userId: 100 + i, username: `partner${i}` }),
      );
      mockTasteProfileService.getTasteProfile.mockImplementation(
        (id: number) => {
          if (id === 1) {
            return Promise.resolve(
              buildProfile({
                userId: 1,
                dimensions: { rpg: 80 },
                coPlayPartners: partners,
              }),
            );
          }
          // All partners have a zeroed profile with a small dim
          return Promise.resolve(
            buildProfile({ userId: id, dimensions: { co_op: 50 } }),
          );
        },
      );

      const result = await builder.build([1]);
      const ctx = result.contexts[0];
      expect(ctx.coPlayPartners.length).toBeLessThanOrEqual(5);
      expect(ctx.coPlayPartners.length).toBeGreaterThan(0);
      // Partner identity/session data preserved
      for (const p of ctx.coPlayPartners) {
        expect(p.userId).toEqual(expect.any(Number));
        expect(p.username).toEqual(expect.any(String));
        expect(p.sessionCount).toEqual(expect.any(Number));
      }
    });

    it('each partner has up to 3 topAxes derived from their own profile', async () => {
      const partners = [buildPartner({ userId: 100 })];
      mockTasteProfileService.getTasteProfile.mockImplementation(
        (id: number) => {
          if (id === 1) {
            return Promise.resolve(
              buildProfile({
                userId: 1,
                dimensions: { rpg: 80 },
                coPlayPartners: partners,
              }),
            );
          }
          // partner 100 has a clear co-op bias
          return Promise.resolve(
            buildProfile({
              userId: id,
              dimensions: {
                co_op: 90,
                mmo: 70,
                social: 60,
                strategy: 40,
                puzzle: 20,
              },
            }),
          );
        },
      );

      const result = await builder.build([1]);
      const partnerCtx = result.contexts[0].coPlayPartners[0];
      expect(partnerCtx.topAxes.length).toBeLessThanOrEqual(3);
      expect(partnerCtx.topAxes.length).toBeGreaterThan(0);
      // First axis should be the partner's strongest (co_op)
      expect(partnerCtx.topAxes[0].axis).toBe('co_op');
    });

    it('partner without own vector still appears with empty topAxes (graceful)', async () => {
      const partners = [buildPartner({ userId: 100, username: 'unvec' })];
      mockTasteProfileService.getTasteProfile.mockImplementation(
        (id: number) => {
          if (id === 1) {
            return Promise.resolve(
              buildProfile({
                userId: 1,
                dimensions: { rpg: 80 },
                coPlayPartners: partners,
              }),
            );
          }
          // Partner 100: no vector → null
          return Promise.resolve(null);
        },
      );

      const result = await builder.build([1]);
      const partnerCtx = result.contexts[0].coPlayPartners[0];
      expect(partnerCtx.userId).toBe(100);
      expect(partnerCtx.username).toBe('unvec');
      expect(partnerCtx.topAxes).toEqual([]);
      expect(partnerCtx.sessionCount).toEqual(expect.any(Number));
    });
  });
});
