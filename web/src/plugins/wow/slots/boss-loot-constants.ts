/**
 * Constants for boss loot panel slot mapping.
 */
import type { BossLootDto } from '@raid-ledger/contract';

/** Map loot slot names to character equipment slot names for upgrade detection */
export const LOOT_TO_EQUIP_SLOT: Record<string, string> = {
    'Head': 'HEAD', 'Neck': 'NECK', 'Shoulder': 'SHOULDER', 'Back': 'BACK',
    'Chest': 'CHEST', 'Wrist': 'WRIST', 'Hands': 'HANDS', 'Waist': 'WAIST',
    'Legs': 'LEGS', 'Feet': 'FEET', 'Finger': 'FINGER_1', 'Trinket': 'TRINKET_1',
    'Main Hand': 'MAIN_HAND', 'One-Hand': 'MAIN_HAND', 'Two-Hand': 'MAIN_HAND',
    'Off Hand': 'OFF_HAND', 'Held In Off-hand': 'OFF_HAND', 'Shield': 'OFF_HAND',
    'Ranged': 'RANGED',
};

/** Check if an item is usable by a character class */
export function isUsableByClass(item: BossLootDto, characterClass?: string | null): boolean {
    if (!characterClass || !item.classRestrictions || item.classRestrictions.length === 0) {
        return true;
    }
    return item.classRestrictions.some(
        (c) => c.toLowerCase() === characterClass.toLowerCase(),
    );
}

/** Empty loot copy for every variant except Forever (unchanged). */
/** Shown when the loot request itself failed — never the variant's empty copy (ROK-2209 review). */
export const LOOT_LOAD_ERROR_MESSAGE = "Couldn't load loot.";

export const NO_LOOT_MESSAGE = 'No loot data available';

/**
 * ROK-2209: a Forever boss with no Forever loot rows. Forever never falls back
 * to Classic loot, so an empty list means the drops are not captured yet.
 * Copy pending operator confirmation — change it here only.
 */
export const FOREVER_LOOT_NOT_CAPTURED_MESSAGE = "Forever loot for this boss isn't captured yet.";

/** Copy for an expanded boss whose loot list is empty, by content variant. */
export function lootEmptyMessage(variant: string): string {
    return variant === 'wow_forever' ? FOREVER_LOOT_NOT_CAPTURED_MESSAGE : NO_LOOT_MESSAGE;
}

/**
 * ROK-2270 (operator 2026-11-20): a Forever boss with no Forever loot rows on
 * a classic-edition instance reads its Classic rows; each still carries
 * `expansion: 'classic'`, and this note says so above the list.
 * Copy is the Lead's call (reversible) — change it here only.
 */
export const CLASSIC_FALLBACK_LOOT_NOTICE = 'Classic loot, Forever drops not captured';

/**
 * The Classic-fallback note for a loot list, or null when the rows are the variant's own.
 * Inferred from the rows: relies on every Forever catalogue instance's own loot rows being
 * tagged `expansion: 'forever'` (api `catalogue-builders.ts`), so an all-`classic` list under
 * `wow_forever` can only be the fallback. A Forever instance catalogued as `classic` loot
 * would be mislabelled here.
 */
export function lootFallbackNotice(variant: string, loot: readonly BossLootDto[] | undefined): string | null {
    if (variant !== 'wow_forever' || !loot || loot.length === 0) return null;
    return loot.every((item) => item.expansion === 'classic') ? CLASSIC_FALLBACK_LOOT_NOTICE : null;
}
