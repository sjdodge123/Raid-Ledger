import type {
  AxisDerivationDto,
  TasteProfileAxis,
  TasteProfileDimensionsDto,
  TasteProfilePoolAxis,
} from '@raid-ledger/contract';
import {
  TASTE_PROFILE_AXES,
  TASTE_PROFILE_AXIS_POOL,
} from '@raid-ledger/contract';
import { AXIS_MAPPINGS } from '../taste-profile/axis-mapping.constants';
import { axisMatchScore } from '../taste-profile/axis-match';
import { computeConfidence } from './confidence.helpers';

/**
 * Per-game metadata subset used for axis classification. Mirrors
 * `taste-profile/taste-vector.helpers.ts#GameMetadata` — the two are
 * structurally identical and interchangeable.
 */
export interface GameMetadata {
  gameId: number;
  genres: number[];
  gameModes: number[];
  themes: number[];
  tags: string[];
}

/**
 * Aggregated per-game signals from the last 4-week rolling window
 * (playtime) + all-time interests. `lastPeriodStart` is optional — used
 * for debugging / audit but not for vector math.
 */
export interface GameSignals {
  gameId: number;
  playtimeSeconds: number;
  interestCount: number;
  lastPeriodStart?: Date | null;
}

export interface CorpusStats {
  maxPlaytimeSeconds: number;
  maxInterestCount: number;
}

export interface GameVectorOutput {
  dimensions: TasteProfileDimensionsDto;
  vector: number[];
  confidence: number;
  derivation: AxisDerivationDto[];
}

/**
 * Backward-compat alias for the shared graduated `axisMatchScore`.
 * Both the game taste pipeline (this module) and the player taste
 * pipeline (ROK-948) use the SAME matcher so game and player vectors
 * classify games identically — a prerequisite for meaningful cosine
 * similarity between a player vector and a game vector.
 */
export function axisMatchFactor(
  axis: TasteProfilePoolAxis,
  game: GameMetadata,
): number {
  return axisMatchScore(axis, game);
}

/**
 * IDF rarity weights: `idf(axis) = ln((N + 1) / (coverage + 1)) + 1`.
 * Same Laplace-smoothed formula as ROK-948 player vectors; always on
 * (architect confirmed — no 50-game toggle for games).
 */
export function computeAxisIdf(
  games: Map<number, GameMetadata>,
): Record<TasteProfilePoolAxis, number> {
  const n = games.size;
  const coverage = {} as Record<TasteProfilePoolAxis, number>;
  for (const axis of TASTE_PROFILE_AXIS_POOL) coverage[axis] = 0;
  for (const game of games.values()) {
    for (const axis of TASTE_PROFILE_AXIS_POOL) {
      if (axisMatchFactor(axis, game) > 0) coverage[axis] += 1;
    }
  }
  const idf = {} as Record<TasteProfilePoolAxis, number>;
  for (const axis of TASTE_PROFILE_AXIS_POOL) {
    idf[axis] = Math.log((n + 1) / (coverage[axis] + 1)) + 1;
  }
  return idf;
}

/**
 * Per-game play signal (0..1-ish) combining rolling playtime and
 * standing interest count, each normalized against corpus max so the
 * output is comparable across the library.
 */
function playSignalScore(
  signals: GameSignals | null,
  corpus: CorpusStats,
): number {
  if (!signals) return 0;
  const playPart =
    corpus.maxPlaytimeSeconds > 0
      ? Math.min(signals.playtimeSeconds / corpus.maxPlaytimeSeconds, 1)
      : 0;
  const interestPart =
    corpus.maxInterestCount > 0
      ? Math.min(signals.interestCount / corpus.maxInterestCount, 1)
      : 0;
  return playPart + interestPart;
}

function matchedTagsFor(
  axis: TasteProfilePoolAxis,
  metadata: GameMetadata,
): string[] {
  if (metadata.tags.length === 0) return [];
  const axisTagsLower = AXIS_MAPPINGS[axis].tags.map((t) => t.toLowerCase());
  return metadata.tags.filter((t) => axisTagsLower.includes(t));
}

function matchedIdsFor(
  axisIds: number[],
  metadataIds: number[],
  tagsActive: boolean,
): number[] {
  if (tagsActive) return [];
  return axisIds.filter((id) => metadataIds.includes(id));
}

function buildRawScores(
  metadata: GameMetadata,
  playSignal: number,
  axisIdf: Record<TasteProfilePoolAxis, number>,
): Record<TasteProfilePoolAxis, number> {
  const raw = {} as Record<TasteProfilePoolAxis, number>;
  for (const axis of TASTE_PROFILE_AXIS_POOL) {
    const match = axisMatchFactor(axis, metadata);
    const base = match > 0 ? match + playSignal : 0;
    raw[axis] = base * axisIdf[axis];
  }
  return raw;
}

function buildDerivation(
  metadata: GameMetadata,
  raw: Record<TasteProfilePoolAxis, number>,
  dims: Record<TasteProfilePoolAxis, number>,
  playSignal: number,
  axisIdf: Record<TasteProfilePoolAxis, number>,
): AxisDerivationDto[] {
  const tagsActive = metadata.tags.length > 0;
  const out: AxisDerivationDto[] = [];
  for (const axis of TASTE_PROFILE_AXIS_POOL) {
    const mapping = AXIS_MAPPINGS[axis];
    out.push({
      axis,
      matchedTags: matchedTagsFor(axis, metadata),
      matchedGenreIds: matchedIdsFor(
        mapping.genres,
        metadata.genres,
        tagsActive,
      ),
      matchedModeIds: matchedIdsFor(
        mapping.gameModes,
        metadata.gameModes,
        tagsActive,
      ),
      matchedThemeIds: matchedIdsFor(
        mapping.themes,
        metadata.themes,
        tagsActive,
      ),
      playSignal,
      idfWeight: axisIdf[axis],
      rawScore: raw[axis],
      normalizedScore: dims[axis],
    });
  }
  return out;
}

/**
 * Compute the full per-game taste vector output:
 *   - `dimensions`: full 24-axis pool, 0–100 display scale
 *   - `vector`: fixed 7-element vector keyed by `TASTE_PROFILE_AXES`
 *     (for pgvector cosine queries — order MUST match the player vector)
 *   - `confidence`: scalar quality estimate (see `computeConfidence`)
 *   - `derivation`: per-axis audit trail for the admin debug endpoint
 *
 * Zero-signal edge case: games with no metadata match and no play signal
 * still produce a full-shape output so the pipeline can upsert a row;
 * vector entries are all 0 and confidence is 0.
 */
export function computeGameVector(
  metadata: GameMetadata,
  signals: GameSignals | null,
  corpusStats: CorpusStats,
  axisIdf: Record<TasteProfilePoolAxis, number>,
): GameVectorOutput {
  const playSignal = playSignalScore(signals, corpusStats);
  const raw = buildRawScores(metadata, playSignal, axisIdf);
  const rawValues = TASTE_PROFILE_AXIS_POOL.map((a) => raw[a]);
  const maxRaw = Math.max(0, ...rawValues);

  const dimensions = {} as Record<TasteProfilePoolAxis, number>;
  for (const axis of TASTE_PROFILE_AXIS_POOL) {
    dimensions[axis] = maxRaw > 0 ? Math.round((raw[axis] / maxRaw) * 100) : 0;
  }

  const vector = TASTE_PROFILE_AXES.map(
    (axis: TasteProfileAxis) => dimensions[axis] / 100,
  );

  const confidence = computeConfidence(signals, metadata);
  const derivation = buildDerivation(
    metadata,
    raw,
    dimensions,
    playSignal,
    axisIdf,
  );

  return {
    dimensions: dimensions as TasteProfileDimensionsDto,
    vector,
    confidence,
    derivation,
  };
}
