/**
 * Static sample data for the /dev/design-system map viewport demo (ROK-1837,
 * design-system §4.25). Nothing here touches the API: a 256² PNG (four flat
 * quadrants + a centre cross, the seed fixture's shape at 1/8 scale) inlined
 * as a data URL, a personal + shared fog bitset built from two circles, and
 * two pins (one personal, one cartography-table).
 */
import type { ValheimMapGrid, ValheimMapPin } from '@raid-ledger/contract';

export const DEMO_GRID: ValheimMapGrid = {
    textureSize: 256,
    pixelSizeMetres: 64,
};

export const DEMO_BASE_MAP_URL =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAIAAADTED8xAAADKklEQVR42u3ToQ2AMBRF0c6ERiNgAwy6Bo3BMB1rYDoHoklX+E16krvBeyet56yoyvfWrrwopOSFAAAgAAAQAAAIAAAEAAACAAABAIAAAEAAACAAABAAAAgAAAQAAAIAAAEAgAAAQAAAIAAAEAAACAAABAAAAgAAAQCAAABAAAAAAAAAAAAAAAAIAAAEAAACAAABAIAAAEAAACAAABAAAAgAAAQAAAIAAAEAgAAAQAAAIAAAEAAACAAABAAAAgAAAQCAAABAAAAgAAAQAAAA4IgAACAAABAAAAgAAAQAAAIAAAEAgAAAQAAAIAAAEAAACAAABAAAAgAAAQCAAABAAAAgAAAQAAAIAAAEAAACAAABAIAAAEAAAAAAAAAA4IgAACAAABAAAAgAAAQAAAIAAAEAgAAAQAAAIAAAEAAACAAABAAAAgAAAQCAAABAAAAgAAAQAAAIAAAEAAACAAABAIAAAEAAAACAAABAAAAgAAAQAAAIAAAEAAACAAABAIAAAEAAACAAABAAAAgAAAQAAAIAAAEAgAAAQAAAIAAAEAAACAAABEBvANoG0oABIACkYQFM+6Oo2gzHvSkkAAAAQAAAIAAAEAAACAAABAAAAgAAAQCAAABAAAAgAAAQAAAIAAAEAAACAAABAIAAAEAAACAAABAAAAgAAAQAAAIAAAEAgAAAAAAAAAAAAAAA8EUAABAAAAgAAAQAAAIAAAEAgAAAQAAAIAAAEAAACAAABAAAAgAAAQCAAABAAAAgAAAQAAAIAAAEAAACAAABAIAAAEAAAACAIwIAgAAAQAAAIAAAEAAACAAABAAAAgAAAQCAAABAAAAgAAAQAAAIAAAEAAACAAABAIAAAEAAACAAABAAAAgAAAQAAAIAAAEAAAAAAAAAAAAAIAAAEAAACAAABAAAAgAAAQCAAABAAAAgAAAQAAAIAAAEAAACAAABAIAAAEAAACAAABAAAAgAAAQAAAIAAAEAgAAAQAAAAIAAAEAAACAAABAAAAgAAAQAAAIAAAEAgAAAQAAAIAAAEAAACAAABAAAAgAAAQCAAABAAAAgAAAQAAAIgC77Acq1zBgw+4DbAAAAAElFTkSuQmCC';

/** LSB-first bitset with every pixel within `radius` of the centre set. */
function circleBits(size: number, radius: number): Uint8Array {
    const bits = new Uint8Array(Math.ceil((size * size) / 8));
    const c = size / 2;
    for (let py = 0; py < size; py++) {
        for (let px = 0; px < size; px++) {
            if ((px - c) ** 2 + (py - c) ** 2 > radius ** 2) continue;
            const i = py * size + px;
            bits[i >> 3] = (bits[i >> 3] ?? 0) | (1 << (i & 7));
        }
    }
    return bits;
}

export const DEMO_PERSONAL_FOG = circleBits(256, 70);
export const DEMO_SHARED_FOG = circleBits(256, 105);

export const DEMO_PINS: ValheimMapPin[] = [
    {
        type: 'Bed',
        label: 'Home',
        x: -1280,
        z: 960,
        checked: false,
        shared: false,
    },
    {
        type: 'Icon3',
        label: 'Copper',
        x: 4480,
        z: -3200,
        checked: false,
        shared: true,
    },
];
