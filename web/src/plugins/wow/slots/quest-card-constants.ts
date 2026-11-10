/**
 * Constants and helpers for quest card components.
 */

/** Map Wowhead reward slot names to character equipment slot names */
export const REWARD_TO_EQUIP_SLOT: Record<string, string> = {
    HEAD: 'HEAD', NECK: 'NECK', SHOULDER: 'SHOULDER', BACK: 'BACK',
    CHEST: 'CHEST', WRIST: 'WRIST', HANDS: 'HANDS', WAIST: 'WAIST',
    LEGS: 'LEGS', FEET: 'FEET', FINGER: 'FINGER_1', TRINKET: 'TRINKET_1',
    MAIN_HAND: 'MAIN_HAND', ONE_HAND: 'MAIN_HAND', TWO_HAND: 'MAIN_HAND',
    OFF_HAND: 'OFF_HAND', HELD_IN_OFF_HAND: 'OFF_HAND', RANGED: 'RANGED',
    SHIRT: 'SHIRT', TABARD: 'TABARD',
};

/** Format copper amount into WoW gold/silver/copper display */
export function formatGold(copper: number): string {
    const gold = Math.floor(copper / 10000);
    const silver = Math.floor((copper % 10000) / 100);
    const copperRem = copper % 100;
    const parts: string[] = [];
    if (gold > 0) parts.push(`${gold}g`);
    if (silver > 0) parts.push(`${silver}s`);
    if (copperRem > 0 || parts.length === 0) parts.push(`${copperRem}c`);
    return parts.join(' ');
}

/**
 * ROK-2143: how many prerequisite quests sit before this quest in its chain.
 * 0 when there is no chain, or the only entry is the quest itself (a
 * `prevQuestId` that is not in our data) — never count the quest as its own.
 */
export function prerequisiteCount(quest: { questId: number; prerequisiteChain: { questId: number }[] | null }): number {
    const idx = quest.prerequisiteChain?.findIndex((step) => step.questId === quest.questId) ?? -1;
    return idx > 0 ? idx : 0;
}

/**
 * ROK-2161: Blizzard reputation rewards as one line, e.g. "+150 Ironforge,
 * -25 Gnomeregan". Empty string when there are none (the card then renders nothing).
 */
export function formatReputationRewards(rewards: { factionName: string; amount: number }[] | undefined): string {
    return (rewards ?? [])
        .map((r) => `${r.amount > 0 ? '+' : ''}${r.amount.toLocaleString()} ${r.factionName}`)
        .join(', ');
}
