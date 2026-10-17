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
