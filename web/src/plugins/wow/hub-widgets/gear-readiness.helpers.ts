/**
 * ROK-1915 (W7 + W8) — pure copy helpers for the "Gear readiness" card:
 * histogram axis labels for the API's item-level buckets (`<45`, `45–49` …
 * `65+`), counts and the slot list of a missing-enchant row.
 */
import { foreverGearSlotName, type WowRosterGearDto } from '@raid-ledger/contract';

type Bucket = WowRosterGearDto['ilvl']['buckets'][number];

/** Rows shown per disclosure before "+N more" (the API caps lists at 10 / 25). */
export const GEAR_ROWS = 10;

/**
 * Which end of the axis a bucket is. The API always sends `<45` (from 0) first
 * and the open-ended `65+` (to 999) last, so the ends are index-based.
 */
function bucketEdge(b: Bucket, isLast: boolean): 'low' | 'high' | 'mid' {
    if (b.from === 0 && b.to > 0) return 'low';
    if (isLast) return 'high';
    return 'mid';
}

/** Short axis label: "<45", "50–54", "65+". */
export function gearAxis(b: Bucket, isLast: boolean): string {
    const edge = bucketEdge(b, isLast);
    if (edge === 'low') return `<${b.to + 1}`;
    if (edge === 'high') return `${b.from}+`;
    return b.from === b.to ? `${b.from}` : `${b.from}–${b.to}`;
}

/** The whole fact for a column's accessible name: "Item level 50–54: 4 mains". */
export function gearBucketLabel(b: Bucket, isLast: boolean): string {
    const edge = bucketEdge(b, isLast);
    const range = edge === 'low' ? `below ${b.to + 1}` : edge === 'high' ? `${b.from} and above` : gearAxis(b, isLast);
    return `Item level ${range}: ${mainCount(b.count)}`;
}

/** "1 main" / "2 mains". */
export function mainCount(n: number): string {
    return `${n} ${n === 1 ? 'main' : 'mains'}`;
}

/** "Median 56 · floor 55 · 3 levelling mains not counted". */
export function gearMeta(ilvl: WowRosterGearDto['ilvl']): string {
    const parts = [`Median ${ilvl.median ?? '—'}`, `floor ${ilvl.floor}`];
    if (ilvl.levelling > 0) {
        parts.push(`${ilvl.levelling} levelling ${ilvl.levelling === 1 ? 'main' : 'mains'} not counted`);
    }
    return parts.join(' · ');
}

/** "Wrist, Feet" — slot ids in the order the API sends them. */
export function slotList(slots: readonly number[]): string {
    return slots.map(foreverGearSlotName).join(', ');
}

/** AC6: nothing reported yet — no item levels, no enchant checks, no old exports. */
export function isGearEmpty(gear: WowRosterGearDto): boolean {
    return gear.ilvl.reporters === 0 && gear.enchants.checked === 0 && gear.enchants.unknown === 0;
}
