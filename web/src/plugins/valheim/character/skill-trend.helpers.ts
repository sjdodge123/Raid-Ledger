/**
 * ROK-1882 — the Skills section's trend chip helpers: the per-skill slice of
 * `character.skillTrend` (the character's last 3 PLAY days, newest first, the
 * same dates on every row). ROK-2014 promoted the logic to the shared
 * `../trend/trend.helpers.ts`; this file binds it to skills — 0.1 rounding
 * and the noun "session" — and keeps the exported names stable.
 */
import type { ValheimSkillTrend } from '@raid-ledger/contract';
import {
    formatDelta,
    roundTo,
    trendDetail as detail,
    trendFor,
    trendLabel as label,
    trendSentence as sentence,
    type TrendDay,
    type TrendFormat,
    type TrendSummary,
    type TrendTone,
} from '../trend/trend.helpers';

export { dotSizePx, formatTrendDate, trendDots, trendTone } from '../trend/trend.helpers';

export type SkillTrendDay = TrendDay;
export type SkillTrendSummary = TrendSummary;
export type SkillTrendTone = TrendTone;

/** Skills: one decimal, "… over 3 sessions". */
export const SKILL_TREND_FORMAT: TrendFormat = { decimals: 1, noun: 'session' };

/** Round to one decimal; `+ 0` folds a `-0` into `0`. */
export function roundGain(n: number): number {
    return roundTo(n, SKILL_TREND_FORMAT.decimals);
}

/** The per-skill trend, or null with no history or a zero rounded total. */
export function skillTrendFor(
    skillId: string,
    trend: ValheimSkillTrend | undefined,
): SkillTrendSummary | null {
    return trendFor(skillId, trend, SKILL_TREND_FORMAT.decimals);
}

/** "+2.0" / "−1.2" (U+2212 minus) / "0.0". */
export function formatGain(n: number): string {
    return formatDelta(n, SKILL_TREND_FORMAT.decimals);
}

/** "+4.1 over 3 sessions" / "−1.2 over 1 session". */
export function trendLabel(t: SkillTrendSummary): string {
    return label(t, SKILL_TREND_FORMAT);
}

/** The detail line, newest first: "Oct 20 +2.0 · Oct 18 no change". */
export function trendDetail(t: SkillTrendSummary): string {
    return detail(t, SKILL_TREND_FORMAT);
}

/** The chip's accessible name: "+4.1 over 3 sessions: +2.0 on Oct 20, no change on Oct 18". */
export function trendSentence(t: SkillTrendSummary): string {
    return sentence(t, SKILL_TREND_FORMAT);
}
