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
