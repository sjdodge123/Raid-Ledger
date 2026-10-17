/**
 * Intensity metrics computation (ROK-948 AC 6, tuned in ROK-949).
 *
 * Formulas:
 *   intensity   = blended percentile rank (60% current week, 30% rolling
 *                 4-week, 10% all-time — see `BLEND_WEIGHTS`)
 *   focus       = longestSessionHours / totalHours * 100 (clamped 0–100)
 *   breadth     = uniqueGames / communityMaxUniqueGames * 100 (clamped 0–100)
 *   consistency = 100 - normalized stddev of weekly hours (clamped 0–100)
 */

export interface WeeklySnapshotInput {
  totalHours: number;
  last4wHours: number;
  allTimeHours: number;
  longestSessionHours: number;
  uniqueGames: number;
  /** Rolling 8-week history of totalHours (oldest first, most recent last). */
  weeklyHistory: number[];
}

export interface CommunityStats {
  /** Distribution of current-week totalHours across the community. */
  totalHoursDistribution: number[];
  /** Distribution of rolling 4-week hours across the community. */
  last4wHoursDistribution: number[];
  /** Distribution of all-time hours across the community. */
  allTimeHoursDistribution: number[];
  /** Max uniqueGames value across the community. */
  maxUniqueGames: number;
}

export interface IntensityMetricsResult {
  intensity: number;
  focus: number;
  breadth: number;
  consistency: number;
}

/** Blend weights for the intensity percentile (must sum to 1.0). */
export const BLEND_WEIGHTS = {
  week: 0.6,
  last4w: 0.3,
  allTime: 0.1,
} as const;

function clamp(value: number, min = 0, max = 100): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function percentileRank(value: number, distribution: number[]): number {
  if (distribution.length === 0) return 0;
  let below = 0;
  let equal = 0;
  for (const d of distribution) {
    if (d < value) below += 1;
    else if (d === value) equal += 1;
  }
  // Classic percentile-rank formula: share below + half of equal, scaled to 100.
  return ((below + equal * 0.5) / distribution.length) * 100;
}

function stddev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function consistencyScore(weeklyHistory: number[]): number {
  if (weeklyHistory.length < 2) return 100;
  const mean = weeklyHistory.reduce((a, b) => a + b, 0) / weeklyHistory.length;
  if (mean === 0) return 100;
  const coefOfVariation = stddev(weeklyHistory) / mean;
  // Map CV in [0, ~1] to consistency in [100, 0]. CV of 1 means stddev
  // equals the mean — very inconsistent; CV of 0 means dead flat.
  return clamp(100 * (1 - coefOfVariation));
}

/**
 * Blend the three percentile ranks into a single intensity score.
 * Returns a 0–100 number (not yet rounded/clamped).
 */
function blendedIntensity(
  snap: WeeklySnapshotInput,
  community: CommunityStats,
): number {
  const weekPct = percentileRank(
    snap.totalHours,
    community.totalHoursDistribution,
  );
  const last4wPct = percentileRank(
    snap.last4wHours,
    community.last4wHoursDistribution,
  );
  const allTimePct = percentileRank(
    snap.allTimeHours,
    community.allTimeHoursDistribution,
  );
  return (
    weekPct * BLEND_WEIGHTS.week +
    last4wPct * BLEND_WEIGHTS.last4w +
    allTimePct * BLEND_WEIGHTS.allTime
  );
}

export function computeIntensityMetrics(
  snap: WeeklySnapshotInput,
  community: CommunityStats,
): IntensityMetricsResult {
  const intensityRaw = blendedIntensity(snap, community);
  const focusRaw =
    snap.totalHours > 0
      ? (snap.longestSessionHours / snap.totalHours) * 100
      : 0;
  const breadthRaw =
    community.maxUniqueGames > 0
      ? (snap.uniqueGames / community.maxUniqueGames) * 100
      : 0;
  const consistencyRaw = consistencyScore(snap.weeklyHistory);

  return {
    intensity: Math.round(clamp(intensityRaw)),
    focus: Math.round(clamp(focusRaw)),
    breadth: Math.round(clamp(breadthRaw)),
    consistency: Math.round(clamp(consistencyRaw)),
  };
}
