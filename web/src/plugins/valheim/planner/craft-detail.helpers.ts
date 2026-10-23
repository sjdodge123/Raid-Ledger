/**
 * ROK-1899 — the detail pane's derived values (shared by the desktop pane
 * and the phone sheet): the step it shows, its accent title and the
 * UPGRADE quality state.
 */
import { useState } from 'react';
import type { ValheimRecipeCost } from '@raid-ledger/contract';
import type { CraftMode, RankedRow } from './crafting.helpers';
import { PLANNER_AMOUNT_MAX } from './planner.helpers';

/** The step the pane shows: CRAFT's recipe, or UPGRADE's step up to `quality`. */
export function detailCost(row: RankedRow, mode: CraftMode, quality: number): ValheimRecipeCost {
    if (mode === 'craft') return row.cost;
    return row.entry.upgrades.find((u) => u.quality === quality) ?? row.cost;
}

/** "Wood arrow ×20" in CRAFT, "Bronze axe — quality 2" in UPGRADE. */
export function detailTitle(row: RankedRow, mode: CraftMode, quality: number): string {
    if (mode === 'upgrade') return `${row.entry.name} — quality ${quality}`;
    const amount = row.entry.craft?.amount ?? 1;
    return amount > 1 ? `${row.entry.name} ×${amount}` : row.entry.name;
}

/** The pane's UPGRADE quality: the first upgrade step (q2) until the select moves it. */
export function useDetailQuality(row: RankedRow, mode: CraftMode): [number, (q: number) => void] {
    const [quality, setQuality] = useState(() => (mode === 'upgrade' ? (row.entry.upgrades[0]?.quality ?? 2) : 1));
    return [quality, setQuality];
}


/** The Amount box's text as a whole number in 1..PLANNER_AMOUNT_MAX, else null. */
export function parseAmount(text: string): number | null {
    const n = Number(text);
    return Number.isInteger(n) && n >= 1 && n <= PLANNER_AMOUNT_MAX ? n : null;
}
