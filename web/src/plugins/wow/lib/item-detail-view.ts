/**
 * ROK-2176: one display model for the shared item body, built from either a
 * character's equipped item (Armory or addon gear) or a boss-loot drop. Stats,
 * armor and DPS come from `itemStatsView` (spec L3: the Wowhead tooltip wins,
 * Armory stats are the fallback), so the popup shows the same numbers the
 * deltas were computed from.
 */
import type { BossLootDto, EquipmentItemDto } from '@raid-ledger/contract';
import { itemStatsView, type StatLine } from './item-stat-diff';
import { getWowheadItemUrl, getWowheadItemUrlForExpansion } from './wowhead-urls';
import { isClassicFallbackItem, itemWowheadVariant } from './item-wowhead-variant';

export type DetailSource = EquipmentItemDto | BossLootDto;

export interface DetailWeapon { damageMin: number; damageMax: number; attackSpeed: number; dps: number }

export interface DetailItem {
    name: string;
    /** Upper-case quality key: EPIC, RARE … */
    quality: string;
    itemLevel: number | null;
    iconUrl: string | null;
    binding: string | null;
    slotLabel: string | null;
    subclass: string | null;
    armor: number | null;
    weapon: DetailWeapon | null;
    /** null = no stats known for this item ("stats not synced"). */
    stats: StatLine[] | null;
    effects: string[];
    enchantments: string[];
    sockets: { socketType: string; filled: boolean }[];
    requiredLevel: number | null;
    setName: string | null;
    description: string | null;
    wowheadUrl: string;
    classicHint: boolean;
}

const BINDING_LABELS: Record<string, string> = {
    ON_EQUIP: 'Binds when equipped',
    ON_ACQUIRE: 'Binds when picked up',
    ON_USE: 'Binds when used',
};

const SLOT_LABELS: Record<string, string> = {
    HEAD: 'Head', NECK: 'Neck', SHOULDER: 'Shoulders', BACK: 'Back',
    CHEST: 'Chest', SHIRT: 'Shirt', TABARD: 'Tabard', WRIST: 'Wrists',
    HANDS: 'Hands', WAIST: 'Waist', LEGS: 'Legs', FEET: 'Feet',
    FINGER_1: 'Ring 1', FINGER_2: 'Ring 2', TRINKET_1: 'Trinket 1', TRINKET_2: 'Trinket 2',
    MAIN_HAND: 'Main Hand', OFF_HAND: 'Off Hand', RANGED: 'Ranged',
};

export function equipSlotLabel(slot: string): string {
    return SLOT_LABELS[slot] ?? slot;
}

function isLoot(item: DetailSource): item is BossLootDto {
    return 'bossId' in item;
}

function fromLoot(loot: BossLootDto): DetailItem {
    const t = loot.tooltip ?? null;
    const view = itemStatsView(loot);
    return {
        name: loot.itemName, quality: loot.quality.toUpperCase(), itemLevel: loot.itemLevel,
        iconUrl: loot.iconUrl, binding: t?.binding ?? null, slotLabel: t?.slotLabel ?? loot.slot,
        subclass: loot.itemSubclass ?? t?.subclass ?? null, armor: view?.armor ?? null,
        weapon: t?.weapon ?? null, stats: view?.stats ?? null, effects: t?.effects ?? [],
        enchantments: [], sockets: [], requiredLevel: t?.requiredLevel ?? null,
        setName: t?.setName ?? null, description: null,
        wowheadUrl: getWowheadItemUrlForExpansion(loot.itemId, loot.expansion), classicHint: false,
    };
}

function fromEquipped(item: EquipmentItemDto, gameVariant: string | null): DetailItem {
    const t = item.tooltip ?? null;
    const view = itemStatsView(item);
    const binding = item.binding ? (BINDING_LABELS[item.binding] ?? item.binding) : (t?.binding ?? null);
    return {
        name: item.name, quality: item.quality.toUpperCase(), itemLevel: item.itemLevel,
        iconUrl: item.iconUrl ?? null, binding, slotLabel: equipSlotLabel(item.slot),
        subclass: item.itemSubclass ?? t?.subclass ?? null, armor: view?.armor ?? null,
        weapon: item.weapon ?? t?.weapon ?? null, stats: view?.stats ?? null, effects: t?.effects ?? [],
        enchantments: (item.enchantments ?? []).map((e) => e.displayString),
        sockets: (item.sockets ?? []).map((s) => ({ socketType: s.socketType, filled: s.itemId != null })),
        requiredLevel: item.requiredLevel ?? t?.requiredLevel ?? null,
        setName: item.setName ?? t?.setName ?? null, description: item.description ?? null,
        wowheadUrl: getWowheadItemUrl(item.itemId, itemWowheadVariant(item, gameVariant)),
        classicHint: isClassicFallbackItem(item),
    };
}

/** The display model for either source. */
export function toDetailItem(item: DetailSource, gameVariant: string | null): DetailItem {
    return isLoot(item) ? fromLoot(item) : fromEquipped(item, gameVariant);
}
