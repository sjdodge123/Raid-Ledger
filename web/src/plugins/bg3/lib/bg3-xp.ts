/**
 * ROK-1958 (operator ruling Q3) — XP-to-next-level progress for a party member.
 *
 * Source: bg3.wiki "Experience" → Character Experience table
 * (https://bg3.wiki/wiki/Experience), read 2026-10-28; eip.gg's experience
 * table (https://eip.gg/bg3/db/experience-table/) lists identical cumulative
 * totals. Cross-check: the contract fixture `act2-party-4p-summon` has level-8
 * members at xpTotal 35,630 with xpLevel 5,630 — a 30,000 floor, as below.
 * The operator accepts the table may be off at some levels; the cap is 12.
 */

/** Cumulative XP needed to REACH each level; index = level − 1. */
export const BG3_XP_THRESHOLDS: readonly number[] = Object.freeze([
    0, 300, 900, 2_700, 6_500, 13_000, 21_000, 30_000, 42_000, 56_000, 76_000, 100_000,
]);

export const BG3_MAX_LEVEL = 12;

export interface Bg3XpProgress {
    /** 0..1 share of the way from this level's floor to the next level. */
    readonly fraction: number;
    /** True at (or past) the level cap — the bar shows full, no "to next". */
    readonly atMax: boolean;
    /** XP still needed for the next level; null at max level. */
    readonly toNext: number | null;
}

function clamp01(n: number): number {
    if (!Number.isFinite(n)) return 0;
    return Math.min(1, Math.max(0, n));
}

/** Progress toward the next level from `xpTotal`; clamps at level 12 (full bar). */
export function xpProgress(level: number, xpTotal: number): Bg3XpProgress {
    if (level >= BG3_MAX_LEVEL) return { fraction: 1, atMax: true, toNext: null };
    const lvl = Math.max(1, Math.floor(level));
    const floor = BG3_XP_THRESHOLDS[lvl - 1] ?? 0;
    const next = BG3_XP_THRESHOLDS[lvl] ?? floor;
    if (next <= floor) return { fraction: 1, atMax: true, toNext: null };
    return {
        fraction: clamp01((xpTotal - floor) / (next - floor)),
        atMax: false,
        toNext: Math.max(0, next - xpTotal),
    };
}
