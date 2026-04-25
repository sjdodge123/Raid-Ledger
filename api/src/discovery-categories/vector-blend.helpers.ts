/**
 * Blend an LLM-proposed theme vector with the community centroid to soften
 * dead-on-theme rows with the group's actual play signal (ROK-567).
 *
 * The blend is an element-wise linear interpolation:
 *   result[i] = alpha * theme[i] + (1 - alpha) * centroid[i]
 *
 * `alpha = 1` returns the pure theme; `alpha = 0` returns the pure centroid.
 * A null centroid (no eligible player vectors yet) degenerates to the pure
 * theme so the pipeline can still seed candidates during bootstrap.
 */
export function blendVectors(
  theme: number[],
  centroid: number[] | null,
  alpha: number,
): number[] {
  if (centroid === null) return [...theme];
  if (theme.length !== centroid.length) {
    throw new Error(
      `vector-blend length mismatch: theme=${theme.length} centroid=${centroid.length}`,
    );
  }
  const clamped = Math.max(0, Math.min(1, alpha));
  const out = new Array<number>(theme.length);
  for (let i = 0; i < theme.length; i += 1) {
    out[i] = clamped * theme[i] + (1 - clamped) * centroid[i];
  }
  return out;
}
