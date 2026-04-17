import type {
  TasteProfileAxis,
  TasteProfileDimensionsDto,
} from '@raid-ledger/contract';
import { TASTE_PROFILE_AXES } from '@raid-ledger/contract';
import {
  AXIS_MAPPINGS,
  MMO_PLAYTIME_BONUS_MIN,
} from './axis-mapping.constants';

/**
 * Per-(user, game) signal rollup. Each source contributes up to one entry
 * per game and the weights sum (capped at 1.0 per source by construction).
 */
export interface UserGameSignal {
  gameId: number;
  steamOwnership?: { playtimeForever: number; playtime2weeks: number };
  steamWishlist?: boolean;
  presenceWeeklyHours?: number;
  manualHeart?: boolean;
  eventSignup?: boolean;
  voiceAttendance?: boolean;
  pollSource?: boolean;
}

/**
 * Metadata subset used by the mapper.
 */
export interface GameMetadata {
  gameId: number;
  genres: number[];
  gameModes: number[];
  themes: number[];
}

export function signalWeight(signal: UserGameSignal): number {
  let weight = 0;

  if (signal.steamOwnership) {
    const { playtimeForever, playtime2weeks } = signal.steamOwnership;
    if (playtimeForever > MMO_PLAYTIME_BONUS_MIN) {
      weight += 1.0;
    } else if (playtime2weeks > 0) {
      weight += 0.5 + Math.min(playtime2weeks / 600, 0.5);
    } else {
      weight += 0.1;
    }
  }
  if (signal.steamWishlist) weight += 0.2;
  if (signal.presenceWeeklyHours !== undefined) {
    weight += Math.min(signal.presenceWeeklyHours / 10, 1.0);
  }
  if (signal.manualHeart) weight += 0.5;
  if (signal.eventSignup) weight += 0.7;
  if (signal.voiceAttendance) weight += 1.0;
  if (signal.pollSource) weight += 0.4;

  return weight;
}

export function axisMatchFactor(
  axis: TasteProfileAxis,
  game: GameMetadata,
  signal: UserGameSignal,
): number {
  const mapping = AXIS_MAPPINGS[axis];
  const hits =
    mapping.gameModes.some((m) => game.gameModes.includes(m)) ||
    mapping.genres.some((g) => game.genres.includes(g)) ||
    mapping.themes.some((t) => game.themes.includes(t));

  if (hits) return 1.0;

  // MMO playtime bonus: a high-playtime game also drives the MMO axis.
  if (
    axis === 'mmo' &&
    signal.steamOwnership &&
    signal.steamOwnership.playtimeForever > MMO_PLAYTIME_BONUS_MIN
  ) {
    return 1.0;
  }

  return 0;
}

/**
 * Compute the 7-axis dimensions jsonb (display scale 0–100) + the
 * normalized unit vector (length 7, for pgvector cosine queries).
 *
 * Self-normalized per-user: the user's strongest axis maps to 100, so
 * new users and heavy users both produce comparable radar shapes. Community
 * normalization (percentile rank) is layered on top by the intensity
 * metrics, not the dimensions vector.
 */
export function computeTasteVector(
  signals: UserGameSignal[],
  games: Map<number, GameMetadata>,
): { dimensions: TasteProfileDimensionsDto; vector: number[] } {
  const raw: Record<TasteProfileAxis, number> = {
    co_op: 0,
    pvp: 0,
    rpg: 0,
    survival: 0,
    strategy: 0,
    social: 0,
    mmo: 0,
  };

  for (const signal of signals) {
    const game = games.get(signal.gameId);
    if (!game) continue;
    const w = signalWeight(signal);
    if (w === 0) continue;
    for (const axis of TASTE_PROFILE_AXES) {
      raw[axis] += w * axisMatchFactor(axis, game, signal);
    }
  }

  const values = TASTE_PROFILE_AXES.map((a) => raw[a]);
  const max = Math.max(0, ...values);
  const dimensions = {} as Record<TasteProfileAxis, number>;
  for (const axis of TASTE_PROFILE_AXES) {
    dimensions[axis] = max > 0 ? Math.round((raw[axis] / max) * 100) : 0;
  }

  // Vector is the raw dimensions in [0, 1] for cosine distance.
  const vector = TASTE_PROFILE_AXES.map((axis) => dimensions[axis] / 100);

  return {
    dimensions: dimensions as TasteProfileDimensionsDto,
    vector,
  };
}
