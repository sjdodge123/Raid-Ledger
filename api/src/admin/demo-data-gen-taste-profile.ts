/**
 * Demo-mode taste-profile signal generator (ROK-1083).
 *
 * Produces per-user weekly + daily game activity rollups and
 * steam-library-flavoured game interests so the aggregator pipeline
 * derives varied intensity tiers (Hardcore / Dedicated / Regular / Casual)
 * and vector titles across the demo population. Without this step the
 * demo users have zero playtime signal and everyone resolves to Casual.
 */
import type { Rng } from './demo-data-rng';
import { pickN, randInt, weightedPick } from './demo-data-rng';
import { IGDB_GAME_WEIGHTS } from './demo-data-generator-templates';

/** Taste-profile intensity tier label (matches contract `IntensityTier`). */
export type TasteIntensityTier =
  | 'Hardcore'
  | 'Dedicated'
  | 'Regular'
  | 'Casual';

export interface TasteTierProfile {
  /** Weekly hours range (inclusive) this tier plays across all games. */
  weeklyHours: [number, number];
  /** How many "favourite" games the user plays in a given week. */
  gameCount: [number, number];
  /** Unique-ownership multiplier used for playtime_forever (all-time minutes). */
  lifetimeMultiplier: number;
}

/**
 * Per-tier playtime shape. Tuned so the aggregator's intensity-rollup
 * bucketing lands in the matching tier: Hardcore ≥ 85, Dedicated 60-84,
 * Regular 35-59, Casual < 35 after the community-relative percentile rank.
 */
export const TASTE_TIER_PROFILES: Record<TasteIntensityTier, TasteTierProfile> =
  {
    Hardcore: {
      weeklyHours: [28, 45],
      gameCount: [3, 5],
      lifetimeMultiplier: 80,
    },
    Dedicated: {
      weeklyHours: [14, 26],
      gameCount: [2, 4],
      lifetimeMultiplier: 40,
    },
    Regular: {
      weeklyHours: [6, 12],
      gameCount: [2, 3],
      lifetimeMultiplier: 15,
    },
    Casual: {
      weeklyHours: [1, 4],
      gameCount: [1, 2],
      lifetimeMultiplier: 4,
    },
  };

/** Weighted tier distribution — hits all four tiers on ~100 demo users. */
const TIER_WEIGHTS: Array<{ tier: TasteIntensityTier; weight: number }> = [
  { tier: 'Hardcore', weight: 3 },
  { tier: 'Dedicated', weight: 6 },
  { tier: 'Regular', weight: 7 },
  { tier: 'Casual', weight: 4 },
];

export interface SignalProfileEntry {
  username: string;
  tier: TasteIntensityTier;
  /** IGDB IDs the user actively plays this week. */
  favouriteIgdbIds: number[];
  /** Hours to spread across the favourite games this week. */
  weeklyHours: number;
}

export interface GeneratedGameActivityRollup {
  username: string;
  igdbId: number;
  period: 'day' | 'week';
  periodStart: Date;
  totalSeconds: number;
}

export interface GeneratedPlayhistoryInterest {
  username: string;
  igdbId: number;
  source: 'steam_library';
  playtimeForever: number;
  playtime2weeks: number;
}

/** Pick a tier using the community-wide distribution. */
function pickTier(rng: Rng): TasteIntensityTier {
  const weights = TIER_WEIGHTS.map((t) => t.weight);
  return weightedPick(rng, TIER_WEIGHTS, weights).tier;
}

/**
 * Assemble a per-user signal profile: tier, chosen games, weekly hours.
 * The choice of games uses the same weighted pool as other demo flows
 * so popular MMOs get more volume and genre spread remains believable.
 */
export function generateSignalProfiles(
  rng: Rng,
  usernames: string[],
): SignalProfileEntry[] {
  const gameWeights = IGDB_GAME_WEIGHTS.map((g) => g.weight);
  const gamePool = IGDB_GAME_WEIGHTS.map((g) => Number(g.igdbId));
  return usernames.map((username) => {
    const tier = pickTier(rng);
    const profile = TASTE_TIER_PROFILES[tier];
    const gameCount = randInt(rng, profile.gameCount[0], profile.gameCount[1]);
    const weeklyHours = randInt(
      rng,
      profile.weeklyHours[0],
      profile.weeklyHours[1],
    );
    const favouriteIgdbIds = pickWeightedUnique(
      rng,
      gamePool,
      gameWeights,
      gameCount,
    );
    return { username, tier, favouriteIgdbIds, weeklyHours };
  });
}

/** Weighted sample without replacement — returns `count` unique IGDB IDs. */
function pickWeightedUnique(
  rng: Rng,
  pool: number[],
  weights: number[],
  count: number,
): number[] {
  const picked: number[] = [];
  const remaining = pool.map((id, i) => ({ id, weight: weights[i] }));
  while (picked.length < count && remaining.length > 0) {
    const totalWeight = remaining.reduce((acc, r) => acc + r.weight, 0);
    let roll = rng() * totalWeight;
    let chosenIdx = 0;
    for (let i = 0; i < remaining.length; i++) {
      roll -= remaining[i].weight;
      if (roll <= 0) {
        chosenIdx = i;
        break;
      }
    }
    picked.push(remaining[chosenIdx].id);
    remaining.splice(chosenIdx, 1);
  }
  return picked;
}

/** Monday-floor date for `game_activity_rollups.period_start` week rows. */
export function currentWeekStart(now: Date): Date {
  const d = new Date(now);
  const day = d.getDay();
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Daily floor (midnight local). */
function floorDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

/**
 * Produce the current-week rollup plus 28 prior days of daily rollups so
 * the intensity rollup's `last4wHours` signal is non-zero. Total weekly
 * hours are spread proportionally across the user's favourite games.
 */
export function generateGameActivityRollups(
  profiles: SignalProfileEntry[],
  now: Date,
): GeneratedGameActivityRollup[] {
  const rows: GeneratedGameActivityRollup[] = [];
  const weekStart = currentWeekStart(now);
  for (const p of profiles) {
    if (p.favouriteIgdbIds.length === 0) continue;
    const perGameSeconds = splitSecondsAcrossGames(
      p.weeklyHours * 3600,
      p.favouriteIgdbIds.length,
    );
    p.favouriteIgdbIds.forEach((igdbId, idx) => {
      const weeklySeconds = perGameSeconds[idx];
      if (weeklySeconds <= 0) return;
      rows.push({
        username: p.username,
        igdbId,
        period: 'week',
        periodStart: weekStart,
        totalSeconds: weeklySeconds,
      });
      rows.push(
        ...emitDailyRollups(p.username, igdbId, weeklySeconds, weekStart, now),
      );
    });
  }
  return rows;
}

/** Split `totalSeconds` across `count` games with a mild front-bias. */
function splitSecondsAcrossGames(
  totalSeconds: number,
  count: number,
): number[] {
  if (count === 1) return [totalSeconds];
  const weights = Array.from({ length: count }, (_, i) => count - i);
  const weightTotal = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => Math.round((totalSeconds * w) / weightTotal));
}

/** Emit 4 prior weeks of daily-period rollups averaging the weekly total. */
function emitDailyRollups(
  username: string,
  igdbId: number,
  weeklySeconds: number,
  weekStart: Date,
  now: Date,
): GeneratedGameActivityRollup[] {
  const rows: GeneratedGameActivityRollup[] = [];
  const dailySeconds = Math.max(0, Math.round(weeklySeconds / 7));
  if (dailySeconds === 0) return rows;
  for (let dayOffset = 1; dayOffset <= 28; dayOffset++) {
    const day = new Date(weekStart);
    day.setDate(day.getDate() - dayOffset);
    if (day >= now) continue;
    rows.push({
      username,
      igdbId,
      period: 'day',
      periodStart: floorDay(day),
      totalSeconds: dailySeconds,
    });
  }
  return rows;
}

/**
 * Enrich game interests with steam-library playtime fields so the
 * aggregator's `steamOwnership` signal path produces non-zero axis values.
 * Adds 1–3 extra "owned but barely played" games per user to make the
 * profile feel more like a real library.
 */
export function generatePlayhistoryInterests(
  rng: Rng,
  profiles: SignalProfileEntry[],
): GeneratedPlayhistoryInterest[] {
  const rows: GeneratedPlayhistoryInterest[] = [];
  const gamePool = IGDB_GAME_WEIGHTS.map((g) => Number(g.igdbId));
  for (const p of profiles) {
    const tierProfile = TASTE_TIER_PROFILES[p.tier];
    const weeklyMinutes = p.weeklyHours * 60;
    for (const igdbId of p.favouriteIgdbIds) {
      rows.push({
        username: p.username,
        igdbId,
        source: 'steam_library',
        playtimeForever: Math.round(
          weeklyMinutes * tierProfile.lifetimeMultiplier,
        ),
        playtime2weeks: weeklyMinutes * 2,
      });
    }
    const owned = pickN(rng, gamePool, randInt(rng, 1, 3));
    for (const igdbId of owned) {
      if (p.favouriteIgdbIds.includes(igdbId)) continue;
      rows.push({
        username: p.username,
        igdbId,
        source: 'steam_library',
        playtimeForever: randInt(rng, 30, 600),
        playtime2weeks: 0,
      });
    }
  }
  return rows;
}
