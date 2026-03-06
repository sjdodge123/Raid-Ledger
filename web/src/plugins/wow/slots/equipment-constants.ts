/**
 * Equipment slot constants and helpers shared by equipment grid
 * and character detail sections.
 */
import type { CharacterEquipmentDto, EquipmentItemDto } from '@raid-ledger/contract';

/** Quality color mapping for WoW item quality */
export const QUALITY_COLORS: Record<string, string> = {
    POOR: 'text-gray-500', COMMON: 'text-gray-300', UNCOMMON: 'text-green-400',
    RARE: 'text-blue-400', EPIC: 'text-purple-400', LEGENDARY: 'text-orange-400',
};

/** Quality border mapping for WoW item quality */
export const QUALITY_BORDERS: Record<string, string> = {
    POOR: 'border-gray-600', COMMON: 'border-gray-500', UNCOMMON: 'border-green-600',
    RARE: 'border-blue-600', EPIC: 'border-purple-600', LEGENDARY: 'border-orange-600',
};

export const LEFT_SLOTS = ['HEAD', 'NECK', 'SHOULDER', 'BACK', 'CHEST', 'SHIRT', 'TABARD', 'WRIST'];
export const RIGHT_SLOTS = ['HANDS', 'WAIST', 'LEGS', 'FEET', 'FINGER_1', 'FINGER_2', 'TRINKET_1', 'TRINKET_2'];
export const BOTTOM_SLOTS = ['MAIN_HAND', 'OFF_HAND', 'RANGED'];

export const SLOT_LABELS: Record<string, string> = {
    HEAD: 'Head', NECK: 'Neck', SHOULDER: 'Shoulders', BACK: 'Back',
    CHEST: 'Chest', SHIRT: 'Shirt', TABARD: 'Tabard', WRIST: 'Wrists',
    HANDS: 'Hands', WAIST: 'Waist', LEGS: 'Legs', FEET: 'Feet',
    FINGER_1: 'Ring 1', FINGER_2: 'Ring 2', TRINKET_1: 'Trinket 1', TRINKET_2: 'Trinket 2',
    MAIN_HAND: 'Main Hand', OFF_HAND: 'Off Hand', RANGED: 'Ranged',
};

/** Build ordered items list from equipment for modal navigation */
export function buildOrderedItems(equipment: CharacterEquipmentDto): EquipmentItemDto[] {
    const itemsBySlot = new Map(equipment.items.map((i) => [i.slot, i]));
    const ordered: EquipmentItemDto[] = [];
    for (const slot of [...LEFT_SLOTS, ...RIGHT_SLOTS, ...BOTTOM_SLOTS]) {
        const item = itemsBySlot.get(slot);
        if (item) ordered.push(item);
    }
    return ordered;
}
