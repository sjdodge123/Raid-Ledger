/**
 * ROK-1859 — base clusters on the Materials tab: names, the Base filter's
 * options, per-base totals, and chest display names
 * ("Wood chest 2 · Base near x 3, z 53"). The server ships `bases`,
 * `personal.byBase` and each chest's `base` + `index` as OPTIONAL fields, so
 * every helper falls back to the pre-ROK-1859 view when they are absent.
 */
import type {
    ValheimContainerSummary,
    ValheimMapBaseMap,
    ValheimMaterialsBase,
    ValheimMaterialsResponse,
} from '@raid-ledger/contract';
import type { ValheimItemCatalogue } from '../character/item-icon.helpers';
import { chestLabel, formatCoords } from './materials.helpers';

export const AWAY_FROM_BASES = 'Away from bases';

type Personal = NonNullable<ValheimMaterialsResponse['personal']>;

/** "Base near x 120, z −40" — no admin names yet (D6). */
export const baseName = (b: Pick<ValheimMaterialsBase, 'x' | 'z'>): string =>
    `Base near ${formatCoords(b.x, b.z)}`;

/** "Base near x 120, z −40 · 5 chests" — one Base `Select` option. */
export function baseOptionLabel(b: ValheimMaterialsBase): string {
    const n = b.chestCount;
    return `${baseName(b)} · ${n} ${n === 1 ? 'chest' : 'chests'}`;
}

/** The selected base, or null (All bases) for none, a stale key, or no `bases`. */
export function activeBase(
    data: Pick<ValheimMaterialsResponse, 'bases'>,
    key: string | null,
): ValheimMaterialsBase | null {
    if (key === null) return null;
    return data.bases?.find((b) => b.key === key) ?? null;
}

/** The shared totals to show: the base's own, or every shared chest's. */
export function sharedTotalsFor(
    data: ValheimMaterialsResponse,
    base: ValheimMaterialsBase | null,
): ValheimMaterialsResponse['shared']['totals'] {
    return base === null ? data.shared.totals : base.totals;
}

/** The viewer's personal chests near the base (no `byBase` → unfiltered). */
export function personalFor(
    personal: Personal,
    base: ValheimMaterialsBase | null,
): Personal {
    if (base === null || personal.byBase === undefined) return personal;
    const group = personal.byBase.find((g) => g.base === base.key);
    return {
        ...personal,
        totals: group?.totals ?? [],
        chestCount: group?.chestCount ?? 0,
    };
}

/** The chests in the base; every chest for All bases. */
export function chestsInBase<T extends Pick<ValheimContainerSummary, 'base'>>(
    chests: readonly T[],
    base: ValheimMaterialsBase | null,
): readonly T[] {
    return base === null ? chests : chests.filter((c) => c.base === base.key);
}

function basePart(
    key: string | null | undefined,
    bases: readonly ValheimMaterialsBase[],
): string | null {
    if (key === undefined) return null;
    if (key === null) return AWAY_FROM_BASES;
    const b = bases.find((x) => x.key === key);
    return b === undefined ? null : baseName(b);
}

/** "Wood chest 2 · Base near x 3, z 53"; "Cart 1 · Away from bases"; the bare label without the fields. */
export function chestDisplayName(
    chest: Pick<ValheimContainerSummary, 'prefab' | 'base' | 'index'>,
    bases: readonly ValheimMaterialsBase[],
    ctx: { items: ValheimItemCatalogue; atlas: ValheimMapBaseMap | null },
): string {
    const label = chestLabel(chest, ctx);
    const named = chest.index === undefined ? label : `${label} ${chest.index}`;
    const where = basePart(chest.base, bases);
    return where === null ? named : `${named} · ${where}`;
}
