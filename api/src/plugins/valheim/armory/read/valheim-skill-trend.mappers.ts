/**
 * ROK-1882 — a character's skill trend: the net gain per skill on each of
 * its last play days, in EFFECTIVE levels (level + progress fraction).
 * Rounding is the web's job (1 decimal at render), not this mapper's.
 */
import type {
  ValheimSkill,
  ValheimSkillTrend,
  ValheimSkillTrendDay,
} from '@raid-ledger/contract';
import type { ValheimProfileSkillDayRow } from '../../../../drizzle/schema';

/** Play days the trend shows (operator ruling 2026-10-21: last 3 played). */
export const SKILL_TREND_DAYS = 3;
/** Gains smaller than this (either sign) are noise and dropped. */
export const SKILL_TREND_MIN_GAIN = 0.05;

export type SkillTrendDayRow = Pick<
  ValheimProfileSkillDayRow,
  'playDate' | 'startSkills' | 'endSkills'
>;

/** Accumulator needed to finish level `l` — the formula `skills-section.tsx` uses. */
function need(level: number): number {
  return Math.pow(level + 1, 1.5) * 0.5 + 0.5;
}

/** `level` plus the fraction of the next level earned; capped at 100. */
export function effectiveLevel(
  s: Pick<ValheimSkill, 'level' | 'accumulator'>,
): number {
  if (s.level >= 100) return 100;
  return s.level + Math.min(1, s.accumulator / need(Math.floor(s.level)));
}

/** skillId → end − start; a skill missing from the start began at 0. */
function dayGains(row: SkillTrendDayRow): Record<string, number> {
  const start = new Map(row.startSkills.map((s) => [s.id, effectiveLevel(s)]));
  const gains: Record<string, number> = {};
  for (const s of row.endSkills) {
    const gain = effectiveLevel(s) - (start.get(s.id) ?? 0);
    if (Math.abs(gain) >= SKILL_TREND_MIN_GAIN) gains[s.id] = gain;
  }
  return gains;
}

/**
 * Rows newest first → at most {@link SKILL_TREND_DAYS} days, newest first.
 * A played day with no qualifying gain stays (empty `gains`): it was still
 * a session. No rows → `{ days: [] }`.
 */
export function toSkillTrend(
  rows: readonly SkillTrendDayRow[],
): ValheimSkillTrend {
  const days: ValheimSkillTrendDay[] = [...rows]
    .sort((a, b) => (a.playDate < b.playDate ? 1 : -1))
    .slice(0, SKILL_TREND_DAYS)
    .map((row) => ({ date: row.playDate, gains: dayGains(row) }));
  return { days };
}
