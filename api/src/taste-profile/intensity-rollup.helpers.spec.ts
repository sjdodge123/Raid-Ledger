/**
 * Intensity metrics unit tests (ROK-948 AC 6, refactored in ROK-949).
 *
 * Validates the formulas:
 *   intensity  = blended percentile rank (60% week / 30% last 4w / 10% all-time)
 *   focus      = longestSessionHours / totalHours * 100
 *   breadth    = uniqueGames / communityMaxUniqueGames * 100
 *   consistency = 100 - normalized std-dev of weekly hours (0–100)
 */
import {
  computeIntensityMetrics,
  type WeeklySnapshotInput,
  type CommunityStats,
} from './intensity-rollup.helpers';

describe('intensity metrics (ROK-948 / ROK-949 blend)', () => {
  const defaultCommunity: CommunityStats = {
    totalHoursDistribution: [5, 10, 15, 20, 25, 30],
    last4wHoursDistribution: [20, 40, 60, 80, 100, 120],
    allTimeHoursDistribution: [50, 100, 200, 400, 800, 1600],
    maxUniqueGames: 10,
  };

  it('intensity is 0 at the bottom of every distribution', () => {
    const snap: WeeklySnapshotInput = {
      totalHours: 0,
      last4wHours: 0,
      allTimeHours: 0,
      longestSessionHours: 0,
      uniqueGames: 0,
      weeklyHistory: [0, 0, 0, 0, 0, 0, 0, 0],
    };
    const { intensity } = computeIntensityMetrics(snap, defaultCommunity);
    expect(intensity).toBe(0);
  });

  it('intensity is 100 at the top of every distribution', () => {
    const snap: WeeklySnapshotInput = {
      totalHours: 100,
      last4wHours: 1000,
      allTimeHours: 10000,
      longestSessionHours: 50,
      uniqueGames: 10,
      weeklyHistory: [90, 95, 98, 100, 100, 100, 100, 100],
    };
    const { intensity } = computeIntensityMetrics(snap, defaultCommunity);
    expect(intensity).toBe(100);
  });

  it('blends the three tiers with 60/30/10 weights', () => {
    // Week at p50 (value 15 ties the middle of the distribution),
    // last4w at p100 (value 120 is the max), all-time at p0 (value 0).
    const snap: WeeklySnapshotInput = {
      totalHours: 15,
      last4wHours: 1000, // way above max -> 100
      allTimeHours: 0, // below min -> 0
      longestSessionHours: 5,
      uniqueGames: 3,
      weeklyHistory: [15, 15, 15],
    };
    const { intensity } = computeIntensityMetrics(snap, defaultCommunity);
    // weekPct ≈ 41.67 (below=2, equal=1), last4wPct=100, allTimePct=0
    // blended = 0.6*41.67 + 0.3*100 + 0.1*0 = 25 + 30 + 0 = 55
    expect(intensity).toBeGreaterThanOrEqual(54);
    expect(intensity).toBeLessThanOrEqual(56);
  });

  it('focus = longestSession/total * 100, clamped to [0, 100]', () => {
    const snap: WeeklySnapshotInput = {
      totalHours: 10,
      last4wHours: 40,
      allTimeHours: 200,
      longestSessionHours: 8,
      uniqueGames: 3,
      weeklyHistory: [10, 10, 10, 10, 10, 10, 10, 10],
    };
    const { focus } = computeIntensityMetrics(snap, defaultCommunity);
    expect(focus).toBe(80);
  });

  it('focus is 0 when totalHours is 0', () => {
    const snap: WeeklySnapshotInput = {
      totalHours: 0,
      last4wHours: 0,
      allTimeHours: 0,
      longestSessionHours: 0,
      uniqueGames: 0,
      weeklyHistory: [0],
    };
    const { focus } = computeIntensityMetrics(snap, defaultCommunity);
    expect(focus).toBe(0);
  });

  it('breadth = uniqueGames / communityMax * 100', () => {
    const snap: WeeklySnapshotInput = {
      totalHours: 10,
      last4wHours: 40,
      allTimeHours: 200,
      longestSessionHours: 2,
      uniqueGames: 5,
      weeklyHistory: [10, 10, 10, 10, 10, 10, 10, 10],
    };
    const { breadth } = computeIntensityMetrics(snap, defaultCommunity);
    expect(breadth).toBe(50);
  });

  it('consistency is 100 for a perfectly constant weekly history', () => {
    const snap: WeeklySnapshotInput = {
      totalHours: 10,
      last4wHours: 40,
      allTimeHours: 200,
      longestSessionHours: 3,
      uniqueGames: 3,
      weeklyHistory: [10, 10, 10, 10, 10, 10, 10, 10],
    };
    const { consistency } = computeIntensityMetrics(snap, defaultCommunity);
    expect(consistency).toBe(100);
  });

  it('consistency is low when weekly hours vary wildly', () => {
    const snap: WeeklySnapshotInput = {
      totalHours: 10,
      last4wHours: 40,
      allTimeHours: 200,
      longestSessionHours: 10,
      uniqueGames: 1,
      weeklyHistory: [0, 40, 0, 40, 0, 40, 0, 40],
    };
    const { consistency } = computeIntensityMetrics(snap, defaultCommunity);
    expect(consistency).toBeLessThan(50);
  });

  it('all four metrics are returned and clamped to [0, 100]', () => {
    const snap: WeeklySnapshotInput = {
      totalHours: 20,
      last4wHours: 80,
      allTimeHours: 500,
      longestSessionHours: 15,
      uniqueGames: 4,
      weeklyHistory: [18, 19, 20, 21, 22, 20, 18, 22],
    };
    const result = computeIntensityMetrics(snap, defaultCommunity);
    for (const value of [
      result.intensity,
      result.focus,
      result.breadth,
      result.consistency,
    ]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });
});
