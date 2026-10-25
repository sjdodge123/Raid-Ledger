/**
 * ROK-1859 D12/D14 — scanned chests as map pins, the ROK-1946 portal pattern:
 * a chest is adapted to a `ValheimMapPin` with a reserved type (a colon never
 * comes from `Minimap.PinType.ToString()`) and drawn by the one `PinLayer`.
 * The chest list is the existing `/containers` read, so which chests a viewer
 * gets is the server's privacy rule, unchanged. Filtering: the "Chests" chip
 * and the label search (on the display name) apply; hide crossed-out and
 * "Whose pins" never do.
 */
import type { ValheimContainerSummary, ValheimMapPin } from '@raid-ledger/contract';
import type { PinFilter } from './pin-filter';
import { matchesPinFilter } from './pin-filter-pins';

/** Reserved pin type for the chest layer — never a game or modded type. */
export const CHEST_PIN_TYPE = 'rl:chest';

/** A chest as a pin the `PinLayer` draws — never a cartography pin, never crossed. */
export function chestAsMapPin(chest: Pick<ValheimContainerSummary, 'x' | 'z'>, label: string): ValheimMapPin {
    return { type: CHEST_PIN_TYPE, label, x: chest.x, z: chest.z, checked: false, shared: false };
}

/** The kept chests and their pins, index-aligned (`pins[i]` is `chests[i]`). */
export interface ChestPins {
    pins: ValheimMapPin[];
    chests: ValheimContainerSummary[];
}

/** D12: the chests the filter keeps; `nameOf` is the display name ("Wood chest 2 · Base near …"). */
export function filterChests(
    chests: readonly ValheimContainerSummary[],
    filter: PinFilter,
    nameOf: (chest: ValheimContainerSummary) => string,
): ChestPins {
    const out: ChestPins = { pins: [], chests: [] };
    if (filter.types !== null && !filter.types.has('chest')) return out;
    // The chip gate is above; the shared predicate only runs the label search.
    const search: PinFilter = { ...filter, types: null, hideCrossed: false };
    for (const chest of chests) {
        const pin = chestAsMapPin(chest, nameOf(chest));
        if (!matchesPinFilter(pin, search)) continue;
        out.pins.push(pin);
        out.chests.push(chest);
    }
    return out;
}
