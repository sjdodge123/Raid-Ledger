/**
 * Intensity metrics unit tests (ROK-948 AC 6).
 *
 * Written TDD-style — imports from helpers that do not exist yet.
 * Validates the exact formulas from the enriched spec:
 *   intensity  = percentile rank of totalHours vs community (0–100)
 *   focus      = longestSessionHours / totalHours * 100
 *   breadth    = uniqueGames / communityMaxUniqueGames * 100
 *   consistency = 100 - normalized std-dev of weekly hours (0–100)
 */
import {
  computeIntensityMetrics,
  type WeeklySnapshotInput,
  type CommunityStats,
} from './intensity-rollup.helpers';

describe('intensity metrics (ROK-948 AC 6)', () => {
  const defaultCommunity: CommunityStats = {
    totalHoursDistribution: [5, 10, 15, 20, 25, 30],
    maxUniqueGames: 10,
  };

  it('intensity is 0 at the bottom of the distribution', () => {
    const snap: WeeklySnapshotInput = {
      totalHours: 0,
      longestSessionHours: 0,
      uniqueGames: 0,
      weeklyHistory: [0, 0, 0, 0, 0, 0, 0, 0],
    };
    const { intensity } = computeIntensityMetrics(snap, defaultCommunity);
    expect(intensity).toBe(0);
  });

  it('intensity is 100 at the top of the distribution', () => {
    const snap: WeeklySnapshotInput = {
      totalHours: 100,
      longestSessionHours: 50,
      uniqueGames: 10,
      weeklyHistory: [90, 95, 98, 100, 100, 100, 100, 100],
    };
    const { intensity } = computeIntensityMetrics(snap, defaultCommunity);
    expect(intensity).toBe(100);
  });

  it('focus = longestSession/total * 100, clamped to [0, 100]', () => {
    const snap: WeeklySnapshotInput = {
      totalHours: 10,
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
