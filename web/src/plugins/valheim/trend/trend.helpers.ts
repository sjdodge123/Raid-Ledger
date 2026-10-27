/**
 * ROK-2014 — the shared Valheim trend chip's pure helpers, promoted from
 * ROK-1882's skill trend (`character/skill-trend.helpers.ts` now wraps these).
 * A trend is up to 3 play days, newest first, each a `gains` map keyed by id
 * (a skill id, an item prefab). The slice rounds each day first and the total
 * is the sum of the ROUNDED days, so the chip always equals what the detail
 * line adds up to. `TrendFormat` carries what differs per consumer: decimals
 * (skills 0.1, materials whole items) and the noun ("session" / "day").
 */

/** One play day for one id; `gain` is null when it did not move that day. */
export interface TrendDay {
    date: string;
    gain: number | null;
}

/** One id's trend over the play days (`days` newest first). */
export interface TrendSummary {
    total: number;
    days: TrendDay[];
}

export type TrendTone = 'success' | 'danger';

/** Rounding + copy for one consumer of the chip. */
export interface TrendFormat {
    decimals: number;
    /** Singular — pluralised with an "s" ("session", "day"). */
    noun: string;
}

/** The structural shape both `ValheimSkillTrend` and `ValheimMaterialsTrend` share. */
export interface TrendSource {
    days: { date: string; gains: Record<string, number> }[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOT_MIN_PX = 4;
const DOT_SPAN_PX = 4;

/** Round to `decimals` places; `+ 0` folds a `-0` into `0`. */
export function roundTo(n: number, decimals: number): number {
    const f = 10 ** decimals;
    return Math.round(n * f) / f + 0;
}

/**
 * One id's trend, or null when there is no history (`trend` absent or
 * `days: []`) or the rounded total is 0 — the row then renders exactly as it
 * did before trends existed.
 */
export function trendFor(
    id: string,
    trend: TrendSource | undefined,
    decimals: number,
): TrendSummary | null {
    const source = trend?.days ?? [];
    if (source.length === 0) return null;
    const days = source.map((d): TrendDay => {
        const raw = d.gains[id];
        const gain = raw === undefined ? null : roundTo(raw, decimals);
        return { date: d.date, gain: gain === 0 ? null : gain };
    });
    const total = roundTo(days.reduce((sum, d) => sum + (d.gain ?? 0), 0), decimals);
    return total === 0 ? null : { total, days };
}

/** "+2.0" / "−1.2" (U+2212 minus) / "0.0"; thousands separators ("+1,240"). */
export function formatDelta(n: number, decimals: number): string {
    const abs = Math.abs(n).toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    });
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

/** A net loss reads red; anything else green. */
export function trendTone(total: number): TrendTone {
    return total < 0 ? 'danger' : 'success';
}

/** "+4.1 over 3 sessions" / "−10 over 1 day". */
export function trendLabel(t: TrendSummary, f: TrendFormat): string {
    const n = t.days.length;
    return `${formatDelta(t.total, f.decimals)} over ${n} ${f.noun}${n === 1 ? '' : 's'}`;
}

function dayDelta(d: TrendDay, f: TrendFormat): string {
    return d.gain === null ? 'no change' : formatDelta(d.gain, f.decimals);
}

/** The detail line, newest first: "Oct 20 +2.0 · Oct 18 no change". */
export function trendDetail(t: TrendSummary, f: TrendFormat): string {
    return t.days.map((d) => `${formatTrendDate(d.date)} ${dayDelta(d, f)}`).join(' · ');
}

/** The chip's accessible name: "+4.1 over 3 sessions: +2.0 on Oct 20, no change on Oct 18". */
export function trendSentence(t: TrendSummary, f: TrendFormat): string {
    const parts = t.days.map((d) => `${dayDelta(d, f)} on ${formatTrendDate(d.date)}`);
    return `${trendLabel(t, f)}: ${parts.join(', ')}`;
}

/** Dot diameter: 4px for no gain / a loss (drawn hollow), else 4–8px by gain over the row's best day. */
export function dotSizePx(gain: number | null, maxGain: number): number {
    if (gain === null || gain <= 0 || maxGain <= 0) return DOT_MIN_PX;
    return DOT_MIN_PX + DOT_SPAN_PX * Math.min(1, gain / maxGain);
}

/** The dots, oldest → newest left to right, each with its size and whether it is filled. */
export function trendDots(t: TrendSummary): { date: string; px: number; filled: boolean }[] {
    const max = Math.max(0, ...t.days.map((d) => d.gain ?? 0));
    return [...t.days].reverse().map((d) => ({
        date: d.date,
        px: dotSizePx(d.gain, max),
        filled: d.gain !== null && d.gain > 0,
    }));
}
