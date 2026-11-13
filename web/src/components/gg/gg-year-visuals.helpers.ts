/**
 * Pure helpers for the GG year visuals (ROK-2187) — kept out of the component
 * file so it exports components only (react-refresh/only-export-components).
 */

/** The longest run of `true` weeks (first one on a tie); length 0 when none. */
export function ggLongestRun(weeks: readonly boolean[]): { start: number; length: number } {
    let best = { start: 0, length: 0 };
    let start = 0;
    weeks.forEach((on, i) => {
        if (!on) { start = i + 1; return; }
        const length = i - start + 1;
        if (length > best.length) best = { start, length };
    });
    return best;
}

/** Index of the largest count (first on a tie). */
export function peakIndex(counts: readonly number[]): number {
    return counts.reduce((best, v, i, all) => (v > (all[best] ?? 0) ? i : best), 0);
}
