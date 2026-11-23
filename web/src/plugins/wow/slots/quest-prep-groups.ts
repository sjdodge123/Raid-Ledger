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

/** Location copy shared by the Quest Prep panel and the hub Dungeon planner (ROK-2276). */
export const UNCONFIRMED_GROUP = {
    title: 'Location not confirmed',
    hint: "We don't know yet if these start outside or inside",
    icon: '\u2754',
} as const;

/** Quests split by where they start, each list keeping the input order. */
export interface QuestLocationSplit {
    /** "Get before you go in": known to start outside. */
    before: EnrichedDungeonQuestDto[];
    /** "Picked up inside": known to start inside. */
    inside: EnrichedDungeonQuestDto[];
    /** "Location not confirmed": no start evidence (ROK-2276). */
    unconfirmed: EnrichedDungeonQuestDto[];
}

/** Split quests into before / inside / unconfirmed, keeping order. */
export function splitByLocation(list: EnrichedDungeonQuestDto[]): QuestLocationSplit {
    const unconfirmed = (q: EnrichedDungeonQuestDto): boolean => !q.startsInsideDungeon && q.startLocationUnconfirmed === true;
    return {
        before: list.filter((q) => !q.startsInsideDungeon && !unconfirmed(q)),
        inside: list.filter((q) => q.startsInsideDungeon),
        unconfirmed: list.filter(unconfirmed),
    };
}
