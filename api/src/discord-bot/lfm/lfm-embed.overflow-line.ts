/**
 * ROK-2352 Q11 — the `''` post's line for keyed groups past the open-post
 * cap. A leaf module (no imports) so `lfm-embed.helpers.ts` can render it
 * without an import cycle through the keyed-pass modules.
 */
/** One keyed group the cap kept off the board: its instance and head-count. */
export interface LfmOverflowGroup {
  label: string;
  count: number;
}

/**
 * The `''` post's overflow line, or null when nothing overflowed.
 *
 * @param groups - The over-cap keyed groups, in board order.
 * @returns `"Also looking: Deadmines (2), Stockade (3)"`, or null.
 */
export function overflowLine(
  groups: readonly LfmOverflowGroup[] | undefined,
): string | null {
  if (!groups || groups.length === 0) return null;
  const parts = groups.map((g) => `${g.label} (${String(g.count)})`);
  return `Also looking: ${parts.join(', ')}`;
}
