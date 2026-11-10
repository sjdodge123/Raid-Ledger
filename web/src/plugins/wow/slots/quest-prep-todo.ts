/**
 * ROK-2169: what is still to do before dungeon night, for the lines under the
 * Quest Prep header — sharable quests nobody has picked up yet, and the quest
 * chains every player has to complete (with the viewer's own progress).
 */
import type { EnrichedDungeonQuestDto, EventQuestPrereqsResponse, QuestCoverageEntry } from '@raid-ledger/contract';
import { prerequisiteCount } from './quest-card-constants';

/** The viewer's own chain progress; `unknown` = no snapshot or a step we cannot speak to. */
export type ViewerChainProgress =
    | { status: 'missing'; steps: number }
    | { status: 'done' }
    | { status: 'unknown' };

export interface QuestPrepTodo {
    /** Sharable quests to get before going in that nobody signed up has picked up. */
    sharableToGrab: number;
    /** Quests in the "Requires quest chain" sub-group (both location groups). */
    chains: number;
    viewer: ViewerChainProgress;
}

/** Same split as the panel's "Sharable" sub-group: sharable and not part of a chain. */
const isSharable = (q: EnrichedDungeonQuestDto): boolean => q.sharable && !q.prevQuestId;
const isChain = (q: EnrichedDungeonQuestDto): boolean => !!q.prevQuestId;

/** Uncovered = nobody (viewer or anyone else) has marked it picked up — the card's ⚠. */
export function countSharableToGrab(
    quests: EnrichedDungeonQuestDto[],
    coverageMap: Map<number, QuestCoverageEntry>,
): number {
    return quests.filter((q) => isSharable(q) && !q.startsInsideDungeon
        && (coverageMap.get(q.questId)?.coveredBy.length ?? 0) === 0).length;
}

/**
 * Every step of every chain quest has a known state. The server drops an
 * unknown step (truncated snapshot, ROK-1758) from `steps`, so fewer steps than
 * the chain has means we cannot say the viewer is done.
 */
function allStepsKnown(chainQuests: EnrichedDungeonQuestDto[], prereqs: NonNullable<EventQuestPrereqsResponse>): boolean {
    const byQuest = new Map(prereqs.quests.map((s) => [s.questId, s]));
    return chainQuests.every((q) => {
        const state = byQuest.get(q.questId);
        return state !== undefined && state.steps.length >= prerequisiteCount(q);
    });
}

/** The viewer's suffix: missing steps (server count, unknown steps excluded), done, or unknown. */
export function viewerChainProgress(
    chainQuests: EnrichedDungeonQuestDto[],
    prereqs: EventQuestPrereqsResponse | undefined,
): ViewerChainProgress {
    if (!prereqs || prereqs.asOf === null) return { status: 'unknown' };
    if (prereqs.neededTotal > 0) return { status: 'missing', steps: prereqs.neededTotal };
    return allStepsKnown(chainQuests, prereqs) ? { status: 'done' } : { status: 'unknown' };
}

/** Summarise the panel's usable quests into the header's to-do counts. */
export function summariseQuestPrep(
    quests: EnrichedDungeonQuestDto[],
    coverageMap: Map<number, QuestCoverageEntry>,
    prereqs: EventQuestPrereqsResponse | undefined,
): QuestPrepTodo {
    const chainQuests = quests.filter(isChain);
    return {
        sharableToGrab: countSharableToGrab(quests, coverageMap),
        chains: chainQuests.length,
        viewer: viewerChainProgress(chainQuests, prereqs),
    };
}
