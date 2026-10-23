/**
 * ROK-1889 — the Map tab's chest focus deep link (pure). No stable chest id
 * exists (ZDO ids change every world load), so a chest is named by prefab +
 * position at 0.1 m: `#map?x=<x>&z=<z>&focus=chest:<prefab>@<x>,<z>[&y=][&item=]`.
 * `y` tells stacked chests apart; a link without it (older shared links)
 * still resolves — the server then picks the lowest chest at that spot.
 * The hash keeps it shareable and back-navigable; the server resolves it
 * through the Materials visibility rules, so a hidden chest is just missing.
 */
import type { ValheimMapGrid } from '@raid-ledger/contract';
import { worldToScreen } from './valheim-grid';

export interface ChestFocusTarget {
    prefab: string;
    x: number;
    z: number;
    /** Height, to tell stacked chests apart; null → the lowest one. */
    y: number | null;
    /** The filtered item ("Iron ×12"), or null. */
    item: string | null;
}

const PREFAB_RE = /^[A-Za-z0-9_]{1,64}$/;
const COORD = '(-?\\d{1,6}(?:\\.\\d{1,3})?)';
const FOCUS_RE = new RegExp(`^chest:([A-Za-z0-9_]{1,64})@${COORD},${COORD}$`);
const Y_RE = new RegExp(`^${COORD}$`);

/** Positions are 0.1 m: one decimal, so a link always names the same spot. */
export function formatFocusCoord(n: number): string {
    const v = (Math.round(n * 10) / 10).toFixed(1);
    return v === '-0.0' ? '0.0' : v;
}

/** The Materials row's link to the Map tab, centred on that chest. */
export function chestFocusHash(t: ChestFocusTarget): string {
    const x = formatFocusCoord(t.x);
    const z = formatFocusCoord(t.z);
    const p = new URLSearchParams({
        x,
        z,
        focus: `chest:${t.prefab}@${x},${z}`,
    });
    if (t.y !== null) p.set('y', formatFocusCoord(t.y));
    if (t.item !== null) p.set('item', t.item);
    return `#map?${p.toString()}`;
}

/** `#map?…focus=chest:…` → the target; anything else (or malformed) → null. */
export function parseChestFocus(hash: string): ChestFocusTarget | null {
    const m = /^#?map\?(.*)$/.exec(hash);
    if (!m) return null;
    const p = new URLSearchParams(m[1] ?? '');
    const f = FOCUS_RE.exec(p.get('focus') ?? '');
    const [, prefab, xs, zs] = f ?? [];
    if (prefab === undefined || xs === undefined || zs === undefined)
        return null;
    const item = p.get('item');
    const y = Y_RE.exec(p.get('y') ?? '')?.[1];
    return {
        prefab,
        x: Number(xs),
        z: Number(zs),
        y: y === undefined ? null : Number(y),
        item: item !== null && PREFAB_RE.test(item) ? item : null,
    };
}

/** The `GET …/chest-focus` query string for a target. */
export function chestFocusQuery(t: ChestFocusTarget): string {
    const p = new URLSearchParams({
        prefab: t.prefab,
        x: formatFocusCoord(t.x),
        z: formatFocusCoord(t.z),
    });
    if (t.y !== null) p.set('y', formatFocusCoord(t.y));
    if (t.item !== null) p.set('item', t.item);
    return p.toString();
}

/** The marker's spot in texture px — the ROK-1880 pin projection. */
export function chestMarkerPoint(
    grid: ValheimMapGrid,
    x: number,
    z: number,
): { x: number; y: number } {
    const { left, top } = worldToScreen(grid, x, z);
    return { x: left, y: top };
}
