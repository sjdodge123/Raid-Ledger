/**
 * ROK-2207 prototype — the guild-faction quest filter (operator rulings ~19:00Z
 * and ~19:05Z): a guild is one faction, never both, so the planner shows that
 * faction's quests plus the neutral ones. Of a same-name Alliance/Horde pair
 * only the guild's own version shows.
 * BUILD: a quest's faction comes from Blizzard `quest/{id}` (ROK-1908 probe);
 * the guild's from the hub's guild record.
 */
import type { EnrichedDungeonQuestDto } from '@raid-ledger/contract';

export type GuildFaction = 'alliance' | 'horde';
export type QuestFaction = GuildFaction | 'neutral';

/** A dungeon quest plus the faction that can take it. */
export type PlannerQuest = EnrichedDungeonQuestDto & { faction: QuestFaction };

export const FACTION_LABEL: Readonly<Record<GuildFaction, string>> = { alliance: 'Alliance', horde: 'Horde' };

/** Can a guild of this faction take the quest? Neutral quests are open to both. */
export function canTakeQuest(quest: { faction: QuestFaction }, guild: GuildFaction): boolean {
    return quest.faction === 'neutral' || quest.faction === guild;
}

/** The guild's quests (own faction + neutral, original order) and how many of the other faction's were left out. */
export function questsForGuild<T extends { faction: QuestFaction }>(quests: T[], guild: GuildFaction): { shown: T[]; hidden: number } {
    const shown = quests.filter((q) => canTakeQuest(q, guild));
    return { shown, hidden: quests.length - shown.length };
}

/** "2 Horde quests hidden — this is an Alliance guild.", or null when nothing was left out. */
export function hiddenNote(hidden: number, guild: GuildFaction): string | null {
    if (hidden === 0) return null;
    const other = FACTION_LABEL[guild === 'alliance' ? 'horde' : 'alliance'];
    const article = guild === 'alliance' ? 'an' : 'a';
    return `${hidden} ${other} quest${hidden === 1 ? '' : 's'} hidden — this is ${article} ${FACTION_LABEL[guild]} guild.`;
}
