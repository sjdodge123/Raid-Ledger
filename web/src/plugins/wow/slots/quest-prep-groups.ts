/**
 * ROK-2216 — the event page's quest grouping, shared by the Quest Prep panel
 * and the hub Dungeon planner so both show quests the same way.
 */
import type { EnrichedDungeonQuestDto } from '@raid-ledger/contract';

/** Quests bucketed by practical pickup type. */
export interface QuestTypeGroups {
    /** Sharable and not part of a chain. */
    sharable: EnrichedDungeonQuestDto[];
    /** Has a previous quest in its chain. */
    chain: EnrichedDungeonQuestDto[];
    /** Not sharable and not part of a chain. */
    solo: EnrichedDungeonQuestDto[];
}

/** Sub-group quests by practical pickup type ("Sharable" / "Requires quest chain" / "Must pick up yourself"). */
export function groupByType(list: EnrichedDungeonQuestDto[]): QuestTypeGroups {
    return {
        sharable: list.filter((q) => q.sharable && !q.prevQuestId),
        chain: list.filter((q) => !!q.prevQuestId),
        solo: list.filter((q) => !q.sharable && !q.prevQuestId),
    };
}

/** Split quests into "Get before you go in" (`before`) and "Picked up inside" (`inside`), keeping order. */
export function splitByLocation(list: EnrichedDungeonQuestDto[]): {
    before: EnrichedDungeonQuestDto[]; inside: EnrichedDungeonQuestDto[];
} {
    return {
        before: list.filter((q) => !q.startsInsideDungeon),
        inside: list.filter((q) => q.startsInsideDungeon),
    };
}
