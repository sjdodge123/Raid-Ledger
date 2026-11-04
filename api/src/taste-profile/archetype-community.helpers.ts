/**
 * Community-relative vector-title pick (ROK-1939).
 *
 * The ROK-1083 rule titles a player by their own strongest axis. Because
 * dimensions are self-normalised (top axis = 100) and most of a community
 * shares one or two games, that collapses everyone onto the same noun.
 * This module titles a player by the axis that sets them apart from the
 * community instead:
 *
 *   D1 relative score: `z_a = (d_a - mean_a) / max(sd_a, SD_FLOOR)` over the
 *      community's population mean/SD per axis. Combo titles take the max
 *      of their axes' z (the same max-combo rule as the raw scores).
 *   D2 grounding floor: a title is eligible only if its RAW title score is
 *      `>= RAW_FLOOR` (30) — the noun must describe something the player
 *      actually plays. No eligible title → `[]` ("{Tier} Player").
 *   D3 second title: the next eligible title within `RELATIVE_WINDOW` z of
 *      the first is kept ("X & Y"); never more than two.
 *   D4 ties: equal z (|Δ| < Z_EPSILON) → higher raw score → lower
 *      primary-axis index in `TASTE_PROFILE_AXIS_POOL`.
 *   D5 thin community: fewer than `MIN_COMMUNITY` profiles → the caller
 *      (`deriveArchetype`) keeps today's raw `pickTopTitles` rule.
 *
 * Pure, no DB. Loading the community is the caller's job (ROK-1939 L3).
 */
import {
  TASTE_PROFILE_AXIS_POOL,
  type TasteProfileDimensionsDto,
  type TasteProfilePoolAxis,
  type VectorTitle,
} from '@raid-ledger/contract';
import { VECTOR_TITLE_AXES } from './archetype-copy';

/** D5 — below this many profiles the raw ROK-1083 rule applies. */
export const MIN_COMMUNITY = 5;

/** D1 — minimum spread (0-100 dimension scale) a z-score divides by. */
export const SD_FLOOR = 10;

/** D3 — max z gap between title 1 and title 2 for both to be kept. */
export const RELATIVE_WINDOW = 0.5;

/** D2 — minimum raw title score for a title to be eligible. */
export const RAW_FLOOR = 30;

/** D4 — z-scores closer than this are treated as equal. */
const Z_EPSILON = 1e-9;

/** Never attach more than two vector titles. */
const TITLE_CAP = 2;

type AxisRecord = Record<TasteProfilePoolAxis, number>;

/** Population mean/SD of every pool axis over a community. */
export interface CommunityAxisStats {
  size: number;
  mean: AxisRecord;
  sd: AxisRecord;
}

interface RelativeTitleScore {
  title: VectorTitle;
  raw: number;
  z: number;
  primaryAxisIndex: number;
}

function axisRecord(fn: (axis: TasteProfilePoolAxis) => number): AxisRecord {
  const record = {} as AxisRecord;
  for (const axis of TASTE_PROFILE_AXIS_POOL) record[axis] = fn(axis);
  return record;
}

/**
 * Population mean and standard deviation per axis. An empty community
 * yields zeros (and `size: 0`, so the caller falls back to the raw rule).
 */
export function computeCommunityAxisStats(
  profiles: readonly TasteProfileDimensionsDto[],
): CommunityAxisStats {
  const size = profiles.length;
  const avg = (fn: (p: TasteProfileDimensionsDto) => number): number =>
    size === 0 ? 0 : profiles.reduce((sum, p) => sum + fn(p), 0) / size;
  const mean = axisRecord((axis) => avg((p) => p[axis]));
  const sd = axisRecord((axis) =>
    Math.sqrt(avg((p) => (p[axis] - mean[axis]) ** 2)),
  );
  return { size, mean, sd };
}

/** D1 — community z-score of one axis value. */
export function axisZScore(
  value: number,
  axis: TasteProfilePoolAxis,
  stats: CommunityAxisStats,
): number {
  return (value - stats.mean[axis]) / Math.max(stats.sd[axis], SD_FLOOR);
}

function scoreTitles(
  dimensions: TasteProfileDimensionsDto,
  stats: CommunityAxisStats,
): RelativeTitleScore[] {
  const entries = Object.entries(VECTOR_TITLE_AXES) as Array<
    [VectorTitle, (typeof VECTOR_TITLE_AXES)[VectorTitle]]
  >;
  return entries.map(([title, axes]) => {
    const raw = Math.max(...axes.map((axis) => dimensions[axis]));
    const z = Math.max(
      ...axes.map((axis) => axisZScore(dimensions[axis], axis, stats)),
    );
    const [primary] = axes;
    const primaryAxisIndex =
      primary === undefined ? -1 : TASTE_PROFILE_AXIS_POOL.indexOf(primary);
    return { title, raw, z, primaryAxisIndex };
  });
}

/** D4 — z desc, then raw desc, then primary-axis pool order. */
function compareRelative(a: RelativeTitleScore, b: RelativeTitleScore): number {
  if (Math.abs(b.z - a.z) >= Z_EPSILON) return b.z - a.z;
  if (b.raw !== a.raw) return b.raw - a.raw;
  return a.primaryAxisIndex - b.primaryAxisIndex;
}

/**
 * D1-D4 — pick 0-2 vector titles by community-relative strength. Callers
 * gate on `stats.size >= MIN_COMMUNITY` (D5) before calling this.
 */
export function pickRelativeTitles(
  dimensions: TasteProfileDimensionsDto,
  stats: CommunityAxisStats,
): VectorTitle[] {
  const eligible = scoreTitles(dimensions, stats)
    .filter((score) => score.raw >= RAW_FLOOR)
    .sort(compareRelative);
  const [top, second] = eligible;
  if (!top) return [];
  const keepSecond = !!second && top.z - second.z <= RELATIVE_WINDOW;
  const picks = keepSecond ? [top.title, second.title] : [top.title];
  return picks.slice(0, TITLE_CAP);
}

/** D5 — whether a community is large enough for the relative rule. */
export function isCommunityUsable(
  stats: CommunityAxisStats | undefined,
): stats is CommunityAxisStats {
  return stats !== undefined && stats.size >= MIN_COMMUNITY;
}
