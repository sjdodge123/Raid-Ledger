/**
 * ROK-1814 — roving-radio keyboard moves for the picker's gallery thumbnails
 * (WAI-ARIA radio group: arrows wrap and select, Home / End jump).
 */
const STEP: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/** The id an arrow / Home / End key moves to from `index`, or undefined for any other key. */
export function radioKeyTarget(ids: readonly number[], index: number, key: string): number | undefined {
    if (key === 'Home') return ids[0];
    if (key === 'End') return ids[ids.length - 1];
    const step = STEP[key];
    if (step === undefined || ids.length === 0) return undefined;
    return ids[(index + step + ids.length) % ids.length];
}
