/**
 * Constants and helpers for quest card components.
 */

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
 * ROK-2161: one Blizzard reputation reward, e.g. "+150 Ironforge" or "-25 Gnomeregan"
 * (the sign stays in the text so colour is never the only gain/loss cue).
 */
export function formatReputationReward(reward: { factionName: string; amount: number }): string {
    return `${reward.amount > 0 ? '+' : ''}${reward.amount.toLocaleString()} ${reward.factionName}`;
}
