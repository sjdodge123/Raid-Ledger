/**
 * ROK-1930 D10/D13 — the Map tab's pin-type filter, read from and written to
 * the URL (`?pins=death`), so the "Death pins only" switch and a deep link share
 * one state. With `vc` the selected character's own Death pins show; without it
 * ("Show all", Q3 = A) every player's Death pins on the selected world.
 */
import type { ValheimDeathPin, ValheimMapPin } from '@raid-ledger/contract';
import { CHARACTER_PARAM } from './map-selection';
import { DEATH_PINS, PINS_PARAM } from './pin-filter-params';

export { DEATH_PINS, PINS_PARAM } from './pin-filter-params';

export type PinFilter =
    | { deathsOnly: false }
    | { deathsOnly: true; scope: 'character' | 'server' };

/** Unknown `pins` values read as absent. */
export function parsePinFilter(params: URLSearchParams): PinFilter {
    if (params.get(PINS_PARAM) !== DEATH_PINS) return { deathsOnly: false };
    return { deathsOnly: true, scope: params.has(CHARACTER_PARAM) ? 'character' : 'server' };
}

/**
 * The by-hand switch. ON pins the shown character (`vc`), so switching it on
 * filters what is on screen rather than jumping to the server-wide layer; OFF
 * drops `pins` and leaves the selection alone.
 */
export function writePinFilter(params: URLSearchParams, on: boolean, characterId: number): URLSearchParams {
    const next = new URLSearchParams(params);
    if (!on) {
        next.delete(PINS_PARAM);
        return next;
    }
    next.set(PINS_PARAM, DEATH_PINS);
    if (!next.has(CHARACTER_PARAM)) next.set(CHARACTER_PARAM, String(characterId));
    return next;
}

/** A server-wide death pin drawn with the existing Death style, labelled by its character. */
export function deathPinAsMapPin(pin: ValheimDeathPin): ValheimMapPin {
    return { type: pin.type, label: pin.characterName, x: pin.x, z: pin.z, checked: false, shared: false };
}

/** The pins the layer draws under `filter`; the server layer is empty until it loads. */
export function filterPins(
    own: readonly ValheimMapPin[],
    filter: PinFilter,
    server: readonly ValheimDeathPin[] | undefined,
): readonly ValheimMapPin[] {
    if (!filter.deathsOnly) return own;
    if (filter.scope === 'character') return own.filter((p) => p.type === 'Death');
    return (server ?? []).map(deathPinAsMapPin);
}
