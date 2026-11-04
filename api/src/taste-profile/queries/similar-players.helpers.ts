/**
 * Similar-players maths guards (ROK-1939).
 *
 * pgvector's cosine distance (`<=>`) is undefined when either vector has a
 * zero norm and returns NaN. `Math.max(0, 1 - NaN)` stays NaN and JSON
 * serialises it as `null`, so a player with no signal on the 7 core axes
 * (e.g. a shooter-only library once IGDB Multiplayer stopped implying pvp)
 * leaked `similarity: null` to the client. Such a player has no meaningful
 * similarity to anyone: the query excludes them, and these guards keep a
 * non-finite distance from ever reaching the response.
 */

/** True when the vector carries any signal (non-zero norm). */
export function hasVectorSignal(vector: readonly number[]): boolean {
  return vector.every(Number.isFinite) && vector.some((v) => v !== 0);
}

/** pg cosine distance → similarity in [0, 1]; 0 when the distance is undefined. */
export function similarityFromDistance(
  distance: string | number | null,
): number {
  if (distance === null) return 0;
  const d = Number(distance);
  if (!Number.isFinite(d)) return 0;
  return Math.max(0, 1 - d);
}
