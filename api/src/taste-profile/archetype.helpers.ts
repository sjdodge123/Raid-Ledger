/**
 * Archetype derivation (ROK-1083 composed shape).
 *
 * The player archetype is a two-layer object:
 *   - `intensityTier` — always present, derived from
 *     `intensityMetrics.intensity` via a threshold ladder.
 *   - `vectorTitles` — 0-2 entries, picked from the strongest pool-axis
 *     scores in `dimensions` via the composition rules below.
 *   - `descriptions` — matching server-owned copy (see
 *     `archetype-copy.ts`). `descriptions.titles[i]` pairs with
 *     `vectorTitles[i]`.
 *
 * Combo scoring rule (locked ROK-1083 decision): multi-axis titles
 * score by `max(...component axes)`. E.g. `Hero = max(rpg, fantasy)`;
 * `Architect = max(crafting, automation, sandbox)`. Single-axis titles
 * use the raw axis value. We chose `max` over `mean`/`sum` so a player
 * who is strong in exactly one facet of a combo title still earns the
 * title — the combo axes express "any of these flavors".
 *
 * Composition rules (applied after scoring):
 *   1. Top-axis floor: if the top title's score is `< 30`, emit no
 *      vector titles (intensity-only badge, e.g. "Hardcore Player").
 *   2. Close window: if the second title's score is `>= 30` and the
 *      gap `top - second <= 10`, emit both titles; else emit one.
 *   3. Cap at 2 — never emit 3+ titles.
 *   4. Tie-break: equal scores resolve by each title's primary-axis
 *      position in `TASTE_PROFILE_AXIS_POOL` (earlier index wins).
 */
import {
  TASTE_PROFILE_AXIS_POOL,
  type ArchetypeDto,
  type IntensityMetricsDto,
  type IntensityTier,
  type TasteProfileDimensionsDto,
  type VectorTitle,
} from '@raid-ledger/contract';
import {
  TIER_DESCRIPTIONS,
  VECTOR_TITLE_AXES,
  VECTOR_TITLE_DESCRIPTIONS,
} from './archetype-copy';

/** Minimum axis score required to earn any vector title. */
const TOP_AXIS_FLOOR = 30;

/** Max gap between first and second title score for both to be kept. */
const CLOSE_WINDOW = 10;

/** Maximum number of vector titles ever attached to an archetype. */
const TITLE_CAP = 2;

/** Inputs for `deriveArchetype`. */
export interface ArchetypeDerivationInputs {
  intensityMetrics: IntensityMetricsDto;
  dimensions: TasteProfileDimensionsDto;
}

interface VectorTitleScore {
  title: VectorTitle;
  score: number;
  /** Index of the title's primary axis inside TASTE_PROFILE_AXIS_POOL. */
  primaryAxisIndex: number;
}

/**
 * Map an intensity score (0-100) to its tier. Thresholds are inclusive
 * on the lower bound (35 -> Regular, 60 -> Dedicated, 85 -> Hardcore).
 */
export function deriveTier(intensity: number): IntensityTier {
  if (intensity >= 85) return 'Hardcore';
  if (intensity >= 60) return 'Dedicated';
  if (intensity >= 35) return 'Regular';
  return 'Casual';
}

/**
 * Score every vector title. Single-axis titles take the raw axis score;
 * multi-axis titles take `max(...component axes)` per the locked combo
 * scoring decision. `primaryAxisIndex` is used as a stable tie-break.
 */
export function computeVectorTitleScores(
  dimensions: TasteProfileDimensionsDto,
): VectorTitleScore[] {
  const entries = Object.entries(VECTOR_TITLE_AXES) as Array<
    [VectorTitle, (typeof VECTOR_TITLE_AXES)[VectorTitle]]
  >;
  return entries.map(([title, axes]) => {
    const score = Math.max(...axes.map((axis) => dimensions[axis]));
    const primaryAxisIndex = TASTE_PROFILE_AXIS_POOL.indexOf(axes[0]);
    return { title, score, primaryAxisIndex };
  });
}

/**
 * Apply top-axis floor, close-window, and cap-at-2 rules to produce the
 * ordered list of vector titles for an archetype. Equal-scored titles
 * are resolved by primary-axis position in `TASTE_PROFILE_AXIS_POOL`.
 */
export function pickTopTitles(scores: VectorTitleScore[]): VectorTitle[] {
  const sorted = [...scores].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.primaryAxisIndex - b.primaryAxisIndex;
  });
  const top = sorted[0];
  if (!top || top.score < TOP_AXIS_FLOOR) return [];

  const second = sorted[1];
  const keepSecond =
    !!second &&
    second.score >= TOP_AXIS_FLOOR &&
    top.score - second.score <= CLOSE_WINDOW;

  const picks = keepSecond ? [top.title, second.title] : [top.title];
  return picks.slice(0, TITLE_CAP);
}

/**
 * Look up tier + per-title descriptions from the server-owned copy
 * tables. The returned `titles` array is positionally aligned with the
 * input `titles` list.
 */
export function buildDescriptions(
  tier: IntensityTier,
  titles: VectorTitle[],
): ArchetypeDto['descriptions'] {
  return {
    tier: TIER_DESCRIPTIONS[tier],
    titles: titles.map((title) => VECTOR_TITLE_DESCRIPTIONS[title]),
  };
}

/**
 * Derive the composed archetype for a player from their intensity
 * metrics and dimensions. Composes the helpers above; see the file
 * header for the full rule set.
 */
export function deriveArchetype(
  inputs: ArchetypeDerivationInputs,
): ArchetypeDto {
  const intensityTier = deriveTier(inputs.intensityMetrics.intensity);
  const scores = computeVectorTitleScores(inputs.dimensions);
  const vectorTitles = pickTopTitles(scores);
  const descriptions = buildDescriptions(intensityTier, vectorTitles);
  return { intensityTier, vectorTitles, descriptions };
}
