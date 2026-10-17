/**
 * ROK-1727: per-item Wowhead environment for addon-sourced (WoW: Forever)
 * equipment. The resolver records which Wowhead env answered for an item:
 * 16 = Forever, 4 = Classic (Forever data not yet published). The result is a
 * variant key fed to the shared `wowhead-urls.ts` helpers, so the domains stay
 * in `wow-variant-config.ts` and are never duplicated here.
 */
import type { EquipmentItemDto } from '@raid-ledger/contract';
import type { WowVariant } from './wow-era';

const VARIANT_BY_WOWHEAD_ENV: Readonly<Record<16 | 4, WowVariant>> = {
    16: 'wow_forever',
    // classic_era's row carries the Classic Wowhead domain.
    4: 'classic_era',
};

/** The variant whose Wowhead domain serves this item; the character's variant when the item has no env. */
export function itemWowheadVariant(
    item: Pick<EquipmentItemDto, 'wowheadEnv'>,
    gameVariant: string | null,
): string | null {
    return item.wowheadEnv !== undefined ? VARIANT_BY_WOWHEAD_ENV[item.wowheadEnv] : gameVariant;
}

/** True when the item's data comes from Wowhead Classic rather than Forever. */
export function isClassicFallbackItem(item: Pick<EquipmentItemDto, 'wowheadEnv'>): boolean {
    return item.wowheadEnv === 4;
}

/** ROK-1727 (Q3): shown in the item modal only, never on the slot or tooltip. */
export const CLASSIC_FALLBACK_HINT = 'Forever data not yet on Wowhead — showing Classic';
