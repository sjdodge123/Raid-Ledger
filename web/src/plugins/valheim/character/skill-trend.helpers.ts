/**
 * ROK-1882 — pure helpers for the Skills section's trend chip: the per-skill
 * slice of `character.skillTrend` (the character's last 3 PLAY days, newest
 * first, the same dates on every row), rounding, sign, tone, date labels, dot
 * sizes and the screen-reader sentence.
 *
 * Rounding: each day's gain is rounded to 0.1 first and the total is the sum
 * of the ROUNDED days, so the chip always equals what the detail line adds up
 * to ("+4.1" = "+2.0 · +1.6 · +0.5").
 */
import type { ValheimSkillTrend } from '@raid-ledger/contract';

/** One play day for one skill; `gain` is null when the skill did not move that day. */
export interface SkillTrendDay {
    date: string;
    gain: number | null;
}

/** A skill's trend over the character's play days (`days` newest first). */
export interface SkillTrendSummary {
    total: number;
    days: SkillTrendDay[];
}

export type SkillTrendTone = 'success' | 'danger';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOT_MIN_PX = 4;
const DOT_SPAN_PX = 4;

/** Round to one decimal; `+ 0` folds a `-0` into `0`. */
export function roundGain(n: number): number {
    return Math.round(n * 10) / 10 + 0;
}

/**
 * The per-skill trend, or null when there is no history (`skillTrend` absent
 * or `days: []`) or the skill's rounded total is 0 — the row then renders
 * exactly as it did before trends existed.
 */
export function skillTrendFor(
    skillId: string,
    trend: ValheimSkillTrend | undefined,
): SkillTrendSummary | null {
    const source = trend?.days ?? [];
    if (source.length === 0) return null;
    const days = source.map((d): SkillTrendDay => {
        const raw = d.gains[skillId];
        const gain = raw === undefined ? null : roundGain(raw);
        return { date: d.date, gain: gain === 0 ? null : gain };
    });
    const total = roundGain(days.reduce((sum, d) => sum + (d.gain ?? 0), 0));
    return total === 0 ? null : { total, days };
}

/** "+2.0" / "−1.2" (U+2212 minus) / "0.0". */
export function formatGain(n: number): string {
    const abs = Math.abs(n).toFixed(1);
    if (n > 0) return `+${abs}`;
    return n < 0 ? `−${abs}` : abs;
}

/**
 * "2026-10-20" → "Oct 20", built from the string's own parts. Never
 * `new Date('2026-10-20')`: that is UTC midnight and renders Oct 19 west of UTC.
 */
export function formatTrendDate(date: string): string {
    const [, mm, dd] = date.split('-');
    const month = MONTHS[Number(mm) - 1];
    if (month === undefined || dd === undefined) return date;
    return `${month} ${Number(dd)}`;
}

/** A net loss (death penalty) reads red; anything else green. */
export function trendTone(total: number): SkillTrendTone {
    return total < 0 ? 'danger' : 'success';
}

/** "+4.1 over 3 sessions" / "−1.2 over 1 session". */
export function trendLabel(t: SkillTrendSummary): string {
    const n = t.days.length;
    return `${formatGain(t.total)} over ${n} session${n === 1 ? '' : 's'}`;
}

/** The detail line, newest first: "Oct 20 +2.0 · Oct 18 no change". */
export function trendDetail(t: SkillTrendSummary): string {
    return t.days
        .map((d) => `${formatTrendDate(d.date)} ${d.gain === null ? 'no change' : formatGain(d.gain)}`)
        .join(' · ');
}

/** The chip's accessible name: "+4.1 over 3 sessions: +2.0 on Oct 20, no change on Oct 18". */
export function trendSentence(t: SkillTrendSummary): string {
    const parts = t.days.map(
        (d) => `${d.gain === null ? 'no change' : formatGain(d.gain)} on ${formatTrendDate(d.date)}`,
    );
    return `${trendLabel(t)}: ${parts.join(', ')}`;
}

/** Dot diameter: 4px for no gain / a loss (drawn hollow), else 4–8px by gain over the row's best day. */
export function dotSizePx(gain: number | null, maxGain: number): number {
    if (gain === null || gain <= 0 || maxGain <= 0) return DOT_MIN_PX;
    return DOT_MIN_PX + DOT_SPAN_PX * Math.min(1, gain / maxGain);
}

/** The dots, oldest → newest left to right, each with its size and whether it is filled. */
export function trendDots(t: SkillTrendSummary): { date: string; px: number; filled: boolean }[] {
    const max = Math.max(0, ...t.days.map((d) => d.gain ?? 0));
    return [...t.days].reverse().map((d) => ({
        date: d.date,
        px: dotSizePx(d.gain, max),
        filled: d.gain !== null && d.gain > 0,
    }));
}
