import { createHash } from 'crypto';

/**
 * Per-game signal fingerprint (ROK-1082).
 *
 * Inputs are the quantitative signals (play time / interest count) plus
 * content-hashes of the metadata arrays (tags, genres, modes, themes). The
 * aggregate pipeline uses this hash to skip recomputing a game whose signal
 * footprint hasn't changed since the last run — mirrors the ROK-948 player
 * vector pattern in `taste-profile/signal-hash.helpers.ts`.
 */
/**
 * Pool/classifier fingerprint version (ROK-1102 item 5, D7).
 *
 * BUMP THIS whenever a change to `TASTE_PROFILE_AXIS_POOL` or to the axis
 * classifier must invalidate every stored vector. The hash below is the only
 * thing standing between a pool change and a silent no-op: the aggregate
 * pipeline skips any game whose signal hash is unchanged
 * (`aggregate-game-vectors.ts`), and the raw signals do NOT change when the
 * pool does — so without a bump the new axis exists in the type system and in
 * zero stored rows. Keep in step with the player-side constant in
 * `taste-profile/signal-hash.helpers.ts`.
 *
 * 1 -> 2: ROK-1102 item 5 appended the `fps` axis to the pool.
 */
export const SIGNAL_HASH_VERSION = 2;

export interface GameSignalSummary {
  gameId: number;
  playtimeTotal: number;
  interestCount: number;
  tagsHash: string;
  genresHash: string;
  modesHash: string;
  themesHash: string;
}

export function computeGameSignalHash(summary: GameSignalSummary): string {
  const parts = [
    `v:${SIGNAL_HASH_VERSION}`,
    `game:${summary.gameId}`,
    `playtime:${summary.playtimeTotal}`,
    `interests:${summary.interestCount}`,
    `tags:${summary.tagsHash}`,
    `genres:${summary.genresHash}`,
    `modes:${summary.modesHash}`,
    `themes:${summary.themesHash}`,
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

/**
 * Stable hash of a list of scalar values (numbers or strings). Sorted before
 * hashing so insertion order doesn't change the fingerprint.
 */
export function hashList(values: Array<number | string>): string {
  const normalized = values.map((v) => String(v)).sort();
  return createHash('sha256').update(normalized.join(',')).digest('hex');
}
