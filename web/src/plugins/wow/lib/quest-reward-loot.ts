/**
 * ROK-2186: a quest reward as the loot shape the shared item-compare row
 * (and its popup) reads — so quest rewards and boss drops share one slot
 * mapping, one stat diff and one popup. Missing fields degrade to null.
 */
import type { BossLootDto, EnrichedDungeonQuestDto, EnrichedQuestReward } from '@raid-ledger/contract';

/** A reward as served; its `wow_item_meta` tooltip (when cached) passes through to the row. */
export type QuestRewardItem = EnrichedQuestReward;

/** Quest reward slots (UPPER_SNAKE) → the loot slot names `compareTarget` maps. */
export const QUEST_TO_LOOT_SLOT: Record<string, string> = {
    HEAD: 'Head', NECK: 'Neck', SHOULDER: 'Shoulder', BACK: 'Back', CHEST: 'Chest', WRIST: 'Wrist',
    HANDS: 'Hands', WAIST: 'Waist', LEGS: 'Legs', FEET: 'Feet', FINGER: 'Finger', TRINKET: 'Trinket',
    MAIN_HAND: 'Main Hand', ONE_HAND: 'One-Hand', TWO_HAND: 'Two-Hand', OFF_HAND: 'Off Hand',
    HELD_IN_OFF_HAND: 'Held In Off-hand', SHIELD: 'Shield', RANGED: 'Ranged',
};

const QUALITIES: readonly BossLootDto['quality'][] = ['Poor', 'Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];

/** Case-insensitive match onto the loot quality enum; unknown → Common. */
function lootQuality(quality: string): BossLootDto['quality'] {
    return QUALITIES.find((q) => q.toLowerCase() === quality.toLowerCase()) ?? 'Common';
}

/**
 * Map one quest reward onto the loot DTO shape (no boss, no drop rate). A
 * metadata-only reward has no slot; its cached tooltip's slot label (already
 * a loot slot name, e.g. "Two-Hand") stands in so it still gets a compare target.
 */
export function questRewardAsLoot(reward: QuestRewardItem, expansion: EnrichedDungeonQuestDto['expansion']): BossLootDto {
    return {
        id: reward.itemId, bossId: 0, itemId: reward.itemId, itemName: reward.itemName,
        slot: reward.slot ? (QUEST_TO_LOOT_SLOT[reward.slot] ?? reward.slot) : (reward.tooltip?.slotLabel ?? null),
        quality: lootQuality(reward.quality), itemLevel: reward.itemLevel, dropRate: null, expansion,
        classRestrictions: null, iconUrl: reward.iconUrl, itemSubclass: reward.itemSubclass,
        tooltip: reward.tooltip ?? null,
    };
}
