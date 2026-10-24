/**
 * ROK-1943 D6/D9/D14 — which pins the map draws under a `PinFilter`. Types AND
 * players AND label search AND crossed-out; predicates run on the pin's own
 * fields, so the players-scope character suffix is never searched (D14).
 */
import type { ValheimMapPin, ValheimServerPin } from '@raid-ledger/contract';
import type { PinFilter } from './pin-filter';
import { groupOf } from './pin-type-groups';
import { pinDisplayLabel } from './pin-types';

/** The fields every pin source shares — enough to filter on. */
export type FilterablePin = Pick<ValheimMapPin, 'type' | 'label' | 'checked'>;

/**
 * True when `pin` passes the type, search and crossed-out filters. Search is a
 * case-insensitive substring of the display label (an unnamed Portal is
 * "Portal"). Exported for the ROK-1946 seam: a new source filters with it.
 */
export function matchesPinFilter(pin: FilterablePin, filter: PinFilter): boolean {
    if (filter.types !== null && !filter.types.has(groupOf(pin.type))) return false;
    if (filter.hideCrossed && pin.checked) return false;
    if (filter.query === '') return true;
    return pinDisplayLabel(pin.label, pin.type).toLowerCase().includes(filter.query.toLowerCase());
}

/** D14 / Q3: a players-scope pin is labelled `"<display label> · <character>"`. */
export function serverPinAsMapPin(pin: ValheimServerPin): ValheimMapPin {
    return {
        type: pin.type,
        label: `${pinDisplayLabel(pin.label, pin.type)} · ${pin.characterName}`,
        x: pin.x,
        z: pin.z,
        checked: pin.checked,
        shared: false,
    };
}

/**
 * The pins the layer draws: this-character scope filters the map's own pins
 * (cartography copies included — the Layers switch still gates those); any
 * players scope filters the server layer, which is empty until it loads.
 */
export function filterPins(
    own: readonly ValheimMapPin[],
    filter: PinFilter,
    server: readonly ValheimServerPin[] | undefined,
): readonly ValheimMapPin[] {
    if (filter.players === 'character') return own.filter((p) => matchesPinFilter(p, filter));
    return (server ?? []).filter((p) => matchesPinFilter(p, filter)).map(serverPinAsMapPin);
}
