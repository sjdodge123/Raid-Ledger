import type { TasteProfilePoolAxis } from '@raid-ledger/contract';
import { AXIS_MAPPINGS } from './axis-mapping.constants';

/**
 * Shared axis classification used by BOTH the player taste pipeline
 * (ROK-948) and the game taste pipeline (ROK-1082).
 *
 * History: before the A/B/C rework the matcher returned a binary 0 or 1.
 * Now it returns a graduated score in [0, 1]:
 *   - Direct tag matches are counted and saturated at `SATURATION_COUNT`
 *     tags, so a game tagged "Co-op, Online Co-Op, Local Co-Op" scores
 *     higher on the co_op axis than a game tagged only "Co-op".
 *   - Co-occurrence rules (CO_OCCURRENCE_RULES) layer partial weights
 *     for soft signals like "Multiplayer + no Co-op tag → pvp".
 *   - IGDB fallback (when the tags array is empty) stays binary 0/1 —
 *     the IGDB taxonomy is too coarse to graduate.
 *
 * Consistency guarantee: there is exactly one matcher, so player vectors
 * and game vectors classify games identically.
 */

/** A direct-match score saturates at this many matching tags. */
export const SATURATION_COUNT = 3;

/**
 * Co-occurrence rule — lets common-but-ambiguous tags contribute a
 * partial signal to an axis based on the surrounding tag context.
 * Example: "Multiplayer" alone usually implies PvP when no co-op tag
 * is present; with a co-op tag it implies co-op instead.
 */
export interface CoOccurrenceRule {
  axis: TasteProfilePoolAxis;
  /** Trigger tag (lowercased on evaluation). */
  tag: string;
  /** Contributed weight to the axis when the rule fires. */
  weight: number;
  /** If any of these tags (lowercased) appear, skip the rule. */
  excludes?: string[];
  /** Require ALL of these tags (lowercased) to be present. */
  requires?: string[];
}

export const CO_OCCURRENCE_RULES: CoOccurrenceRule[] = [
  // Multiplayer without co-op variants → PvP (fixes the CoD case)
  {
    axis: 'pvp',
    tag: 'Multiplayer',
    weight: 0.5,
    excludes: ['Co-op', 'Online Co-Op', 'Local Co-Op'],
  },
  // Multiplayer → social (always a little — people play together)
  { axis: 'social', tag: 'Multiplayer', weight: 0.3 },
  // Bare "Action" tag → adventure lean
  { axis: 'adventure', tag: 'Action', weight: 0.2 },
];

function lowerSet(tags: string[]): Set<string> {
  return new Set(tags.map((t) => t.toLowerCase()));
}

function directMatchCount(
  axis: TasteProfilePoolAxis,
  tagSet: Set<string>,
): number {
  const mapping = AXIS_MAPPINGS[axis];
  let count = 0;
  for (const tag of mapping.tags) {
    if (tagSet.has(tag.toLowerCase())) count += 1;
  }
  return count;
}

function conditionalScore(
  axis: TasteProfilePoolAxis,
  tagSet: Set<string>,
): number {
  let total = 0;
  for (const rule of CO_OCCURRENCE_RULES) {
    if (rule.axis !== axis) continue;
    if (!tagSet.has(rule.tag.toLowerCase())) continue;
    if (rule.excludes?.some((t) => tagSet.has(t.toLowerCase()))) continue;
    if (rule.requires?.some((t) => !tagSet.has(t.toLowerCase()))) continue;
    total += rule.weight;
  }
  return total;
}

function igdbFallback(
  axis: TasteProfilePoolAxis,
  game: {
    genres: number[];
    gameModes: number[];
    themes: number[];
  },
): number {
  const mapping = AXIS_MAPPINGS[axis];
  const hits =
    mapping.gameModes.some((m) => game.gameModes.includes(m)) ||
    mapping.genres.some((g) => game.genres.includes(g)) ||
    mapping.themes.some((t) => game.themes.includes(t));
  return hits ? 1 : 0;
}

/**
 * Graduated axis-match score in [0, 1].
 *
 * With tags present: `saturate(directMatches) + conditional` capped at 1.
 * Without tags: binary IGDB fallback (0 or 1).
 */
export function axisMatchScore(
  axis: TasteProfilePoolAxis,
  game: {
    tags: string[];
    genres: number[];
    gameModes: number[];
    themes: number[];
  },
): number {
  if (game.tags.length === 0) {
    return igdbFallback(axis, game);
  }
  const tagSet = lowerSet(game.tags);
  const direct =
    Math.min(directMatchCount(axis, tagSet), SATURATION_COUNT) /
    SATURATION_COUNT;
  const bonus = conditionalScore(axis, tagSet);
  return Math.min(direct + bonus, 1);
}
