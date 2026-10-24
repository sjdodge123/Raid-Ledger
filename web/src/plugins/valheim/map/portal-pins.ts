/**
 * ROK-1946 D10/D12/D14 — scanned portals as map pins. A portal belongs to no
 * player, so it is adapted to a `ValheimMapPin` with a reserved type (a colon
 * can never come from `Minimap.PinType.ToString()`) and drawn by the one
 * `PinLayer`. Filtering: the "Scanned portals" chip and the label search
 * apply; hide crossed-out and "Whose pins" never do.
 */
import type { ValheimMapPin, ValheimServerPortal } from '@raid-ledger/contract';
import type { PinFilter } from './pin-filter';
import { matchesPinFilter } from './pin-filter-pins';

/** Reserved pin type for the portal layer — never a game or modded type. */
export const SCANNED_PORTAL_TYPE = 'rl:scanned-portal';
/** The label of a portal with an empty (or whitespace) tag. */
export const UNNAMED_PORTAL = 'Unnamed portal';

/** D10: the portal's tag, trimmed; empty → "Unnamed portal". */
export function portalLabel(tag: string): string {
    const trimmed = tag.trim();
    return trimmed === '' ? UNNAMED_PORTAL : trimmed;
}

/** D14: a portal as a pin the `PinLayer` draws — never shared, never crossed. */
export function portalAsMapPin(portal: ValheimServerPortal): ValheimMapPin {
    return {
        type: SCANNED_PORTAL_TYPE, label: portalLabel(portal.tag),
        x: portal.x, z: portal.z, checked: false, shared: false,
    };
}

/** D12: the portals the filter keeps, as pins. */
export function filterPortals(portals: readonly ValheimServerPortal[], filter: PinFilter): ValheimMapPin[] {
    if (filter.types !== null && !filter.types.has('scanned-portal')) return [];
    // The chip gate is above; the shared predicate only runs the label search.
    const search: PinFilter = { ...filter, types: null, hideCrossed: false };
    return portals.map(portalAsMapPin).filter((pin) => matchesPinFilter(pin, search));
}
