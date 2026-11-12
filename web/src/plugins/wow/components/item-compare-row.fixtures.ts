/**
 * ROK-2186: shared fixtures for the item-compare-row guard + quest reward specs.
 */
import type { BossLootDto, EnrichedDungeonQuestDto, EnrichedQuestReward, EquipmentItemDto, ItemTooltip } from '@raid-ledger/contract';

/** A stored Wowhead tooltip with the given stats. */
export function tooltip(over: Partial<ItemTooltip> = {}): ItemTooltip {
    return {
        env: 4, slotLabel: 'Legs', subclass: 'Cloth', binding: 'Binds when picked up', unique: false, requiredLevel: 30,
        armor: 60, weapon: null, stats: [], effects: [], setName: null, randomEnchant: false, ...over,
    };
}

const stat = (key: string, name: string, value: number) => ({ key, name, value, unit: 'flat' as const });

export const EQUIPPED_LEGS: EquipmentItemDto = {
    slot: 'LEGS', name: 'Old Leggings', itemId: 100, quality: 'RARE', itemLevel: 20, itemSubclass: 'Cloth',
    tooltip: tooltip({ armor: 50, stats: [stat('STAMINA', 'Stamina', 4)] }),
};

export const LOOT_LEGS: BossLootDto = {
    id: 1, bossId: 7, itemId: 11802, itemName: 'Lavacrest Leggings', slot: 'Legs', quality: 'Rare', itemLevel: 30,
    dropRate: null, expansion: 'classic', classRestrictions: null, iconUrl: null, itemSubclass: 'Cloth',
    tooltip: tooltip({ stats: [stat('STAMINA', 'Stamina', 10), stat('SPIRIT', 'Spirit', 6)] }),
};

/** A quest reward as the API may serve it — `tooltip` passes through when present. */
export type RewardFixture = EnrichedQuestReward & { tooltip?: ItemTooltip | null };

export const REWARD_LEGS: RewardFixture = {
    itemId: 2001, itemName: 'Questbound Leggings', quality: 'Uncommon', slot: 'LEGS', itemLevel: 28, iconUrl: null,
    itemSubclass: 'Cloth', tooltip: tooltip({ stats: [stat('STAMINA', 'Stamina', 9), stat('INTELLECT', 'Intellect', 3)] }),
};

/** A quest whose rewards are the given items. */
export function questWith(rewards: RewardFixture[], over: Partial<EnrichedDungeonQuestDto> = {}): EnrichedDungeonQuestDto {
    return {
        questId: 100, dungeonInstanceId: 1, name: 'Test Quest', questLevel: 25, requiredLevel: 20, expansion: 'classic',
        questGiverNpc: null, questGiverZone: null, prevQuestId: null, nextQuestId: null, rewardsJson: null, objectives: null,
        classRestriction: null, raceRestriction: null, startsInsideDungeon: false, sharable: false, rewardXp: null,
        rewardGold: null, rewardType: rewards.length > 1 ? 'choice' : 'guaranteed', rewards, prerequisiteChain: null, ...over,
    };
}
