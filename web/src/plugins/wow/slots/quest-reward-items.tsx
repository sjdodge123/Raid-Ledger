/**
 * ROK-2186: quest reward items (choice + guaranteed) render through the
 * shared boss-loot `ItemCompareRow` — stat chips + compare popup. Each
 * reward's loot shape is memoised so the row's comparison memo holds.
 */
import { useMemo, type JSX } from 'react';
import type { EnrichedDungeonQuestDto, EnrichedQuestReward, EquipmentItemDto } from '@raid-ledger/contract';
import { getWowheadItemUrl } from '../lib/wowhead-urls';
import { ItemCompareRow } from '../components/item-compare-row';
import { questRewardAsLoot } from '../lib/quest-reward-loot';

/** Props shared by the reward list and each row. */
interface RewardContext {
    wowheadSuffix: string;
    wowheadVariant: string;
    equippedBySlot: Map<string, EquipmentItemDto>;
    charClass: string | null;
    characterId: string | undefined;
}

/** One reward row; the loot shape + link props are stable across renders. */
function QuestRewardRow({ reward, expansion, ctx }: {
    reward: EnrichedQuestReward; expansion: EnrichedDungeonQuestDto['expansion']; ctx: RewardContext;
}): JSX.Element {
    const { wowheadSuffix, wowheadVariant } = ctx;
    const item = useMemo(() => questRewardAsLoot(reward, expansion), [reward, expansion]);
    const links = useMemo(() => ({
        url: getWowheadItemUrl(reward.itemId, wowheadVariant), data: `item=${reward.itemId}&${wowheadSuffix}`,
    }), [reward.itemId, wowheadVariant, wowheadSuffix]);
    return (
        <ItemCompareRow item={item} wowheadVariant={wowheadVariant} equippedBySlot={ctx.equippedBySlot}
            characterClass={ctx.charClass} hasCharacter={!!ctx.characterId} links={links} />
    );
}

/** The quest's reward items, or nothing when it has none. */
export function QuestRewardItems({ quest, ...ctx }: RewardContext & { quest: EnrichedDungeonQuestDto }): JSX.Element | null {
    if (!quest.rewards || quest.rewards.length === 0) return null;
    return (
        <div className="quest-rewards">
            {quest.rewards.map((reward) => (
                <QuestRewardRow key={reward.itemId} reward={reward} expansion={quest.expansion} ctx={ctx} />
            ))}
        </div>
    );
}
