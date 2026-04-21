/**
 * Per-game confidence scoring (ROK-1082).
 *
 * Quantifies how much signal the pipeline had for this game. Consumed by
 * the similarity query as a filter (default `minConfidence = 0.1`) so
 * zero-signal stub vectors don't pollute results.
 *
 * Formula (plan-ROK-1082 §Risks line 330):
 *   confidence =
 *     0.4 * min(tagCount / 5, 1)                      // richness of tag set
 *     + 0.3 * min(playSignalHours / 10, 1)            // recency / quantity of play
 *     + 0.2 * min(interestCount / 5, 1)               // user intent signal
 *     + 0.1 * metadataCompleteness                    // fraction of {genres, gameModes, themes} non-empty
 *
 * The weights are tunable — operator may revisit once the column starts
 * flowing through the similarity endpoint.
 */

export interface GameSignals {
  gameId: number;
  playtimeSeconds: number;
  interestCount: number;
}

export interface GameMetadata {
  gameId: number;
  genres: number[];
  gameModes: number[];
  themes: number[];
  tags: string[];
}

const TAG_SATURATION = 5;
const PLAY_HOURS_SATURATION = 10;
const INTEREST_SATURATION = 5;

const WEIGHT_TAGS = 0.4;
const WEIGHT_PLAY = 0.3;
const WEIGHT_INTERESTS = 0.2;
const WEIGHT_METADATA = 0.1;

function metadataCompleteness(metadata: GameMetadata): number {
  const parts = [
    metadata.genres.length > 0 ? 1 : 0,
    metadata.gameModes.length > 0 ? 1 : 0,
    metadata.themes.length > 0 ? 1 : 0,
  ];
  return parts.reduce((s, v) => s + v, 0) / parts.length;
}

export function computeConfidence(
  signals: GameSignals | null,
  metadata: GameMetadata,
): number {
  const playtimeSeconds = signals?.playtimeSeconds ?? 0;
  const interestCount = signals?.interestCount ?? 0;
  const tagCount = metadata.tags.length;

  const tagFactor = Math.min(tagCount / TAG_SATURATION, 1);
  const playHours = playtimeSeconds / 3600;
  const playFactor = Math.min(playHours / PLAY_HOURS_SATURATION, 1);
  const interestFactor = Math.min(interestCount / INTEREST_SATURATION, 1);
  const metadataFactor = metadataCompleteness(metadata);

  const score =
    WEIGHT_TAGS * tagFactor +
    WEIGHT_PLAY * playFactor +
    WEIGHT_INTERESTS * interestFactor +
    WEIGHT_METADATA * metadataFactor;

  const clamped = Math.max(0, Math.min(1, score));
  // Collapse floating-point drift at saturation (e.g. 0.4+0.3+0.2+0.1).
  return Math.abs(clamped - 1) < 1e-9 ? 1 : clamped;
}
