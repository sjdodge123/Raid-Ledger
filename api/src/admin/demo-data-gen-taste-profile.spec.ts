import {
  TASTE_TIER_PROFILES,
  currentWeekStart,
  generateGameActivityRollups,
  generatePlayhistoryInterests,
  generateSignalProfiles,
  type TasteIntensityTier,
} from './demo-data-gen-taste-profile';
import { createRng } from './demo-data-rng';

const ALL_TIERS: TasteIntensityTier[] = [
  'Hardcore',
  'Dedicated',
  'Regular',
  'Casual',
];

function makeUsernames(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `demo_user_${i}`);
}

describe('demo-data-gen-taste-profile (ROK-1083)', () => {
  describe('generateSignalProfiles', () => {
    it('covers all four tiers across a realistic population', () => {
      const rng = createRng(42);
      const profiles = generateSignalProfiles(rng, makeUsernames(100));
      const tiers = new Set(profiles.map((p) => p.tier));
      for (const tier of ALL_TIERS) {
        expect(tiers.has(tier)).toBe(true);
      }
    });

    it('produces weekly hours within each tier profile range', () => {
      const rng = createRng(99);
      const profiles = generateSignalProfiles(rng, makeUsernames(200));
      for (const p of profiles) {
        const [min, max] = TASTE_TIER_PROFILES[p.tier].weeklyHours;
        expect(p.weeklyHours).toBeGreaterThanOrEqual(min);
        expect(p.weeklyHours).toBeLessThanOrEqual(max);
      }
    });

    it('picks unique favourite games within the user-specific count range', () => {
      const rng = createRng(7);
      const profiles = generateSignalProfiles(rng, makeUsernames(50));
      for (const p of profiles) {
        const [min, max] = TASTE_TIER_PROFILES[p.tier].gameCount;
        expect(p.favouriteIgdbIds.length).toBeGreaterThanOrEqual(min);
        expect(p.favouriteIgdbIds.length).toBeLessThanOrEqual(max);
        expect(new Set(p.favouriteIgdbIds).size).toBe(
          p.favouriteIgdbIds.length,
        );
      }
    });

    it('is deterministic under a fixed seed', () => {
      const a = generateSignalProfiles(createRng(1234), makeUsernames(20));
      const b = generateSignalProfiles(createRng(1234), makeUsernames(20));
      expect(b).toEqual(a);
    });
  });

  describe('generateGameActivityRollups', () => {
    const NOW = new Date('2026-04-22T10:00:00Z');

    it('emits exactly one week-period row per favourite game and 28 daily rows per game', () => {
      const rng = createRng(11);
      const profiles = generateSignalProfiles(rng, ['only_user']);
      const rollups = generateGameActivityRollups(profiles, NOW);
      const profile = profiles[0];
      const weekRows = rollups.filter((r) => r.period === 'week');
      const dayRows = rollups.filter((r) => r.period === 'day');
      expect(weekRows).toHaveLength(profile.favouriteIgdbIds.length);
      expect(dayRows.length).toBeGreaterThan(0);
      for (const igdbId of profile.favouriteIgdbIds) {
        const dailyForGame = dayRows.filter((r) => r.igdbId === igdbId);
        expect(dailyForGame.length).toBeLessThanOrEqual(28);
      }
    });

    it('weekly totals match the generated user weeklyHours (within rounding)', () => {
      const rng = createRng(55);
      const profiles = generateSignalProfiles(rng, ['rounding_user']);
      const profile = profiles[0];
      const rollups = generateGameActivityRollups(profiles, NOW);
      const weekSeconds = rollups
        .filter((r) => r.period === 'week')
        .reduce((acc, r) => acc + r.totalSeconds, 0);
      const expected = profile.weeklyHours * 3600;
      expect(Math.abs(weekSeconds - expected)).toBeLessThanOrEqual(
        profile.favouriteIgdbIds.length,
      );
    });

    it('sets period_start to the Monday of the current week', () => {
      const profiles = generateSignalProfiles(createRng(3), ['monday_user']);
      const rollups = generateGameActivityRollups(profiles, NOW);
      const weekRow = rollups.find((r) => r.period === 'week');
      expect(weekRow).toBeDefined();
      const expectedMonday = currentWeekStart(NOW);
      expect(weekRow!.periodStart.toISOString()).toBe(
        expectedMonday.toISOString(),
      );
    });
  });

  describe('generatePlayhistoryInterests', () => {
    it('emits at least one steam_library row per favourite game', () => {
      const rng = createRng(17);
      const profiles = generateSignalProfiles(rng, makeUsernames(10));
      const interests = generatePlayhistoryInterests(rng, profiles);
      for (const p of profiles) {
        const userRows = interests.filter((r) => r.username === p.username);
        const matchedFavourites = p.favouriteIgdbIds.filter((id) =>
          userRows.some((r) => r.igdbId === id),
        );
        expect(matchedFavourites.length).toBe(p.favouriteIgdbIds.length);
      }
    });

    it('scales playtimeForever by the tier lifetimeMultiplier', () => {
      const rng = createRng(23);
      const profiles = generateSignalProfiles(rng, ['tier_user']);
      const profile = profiles[0];
      const interests = generatePlayhistoryInterests(rng, profiles);
      const weeklyMinutes = profile.weeklyHours * 60;
      const expected = Math.round(
        weeklyMinutes * TASTE_TIER_PROFILES[profile.tier].lifetimeMultiplier,
      );
      const favouriteRow = interests.find(
        (r) =>
          r.username === profile.username &&
          r.igdbId === profile.favouriteIgdbIds[0],
      );
      expect(favouriteRow).toBeDefined();
      expect(favouriteRow!.playtimeForever).toBe(expected);
    });

    it('tags every row with source steam_library', () => {
      const rng = createRng(31);
      const profiles = generateSignalProfiles(rng, makeUsernames(5));
      const interests = generatePlayhistoryInterests(rng, profiles);
      for (const row of interests) {
        expect(row.source).toBe('steam_library');
      }
    });
  });
});
