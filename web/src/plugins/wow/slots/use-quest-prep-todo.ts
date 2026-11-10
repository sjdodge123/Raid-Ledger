/**
 * Memoised Quest Prep to-do counts (ROK-2169). Lives apart from the component
 * file so that file only exports components (react-refresh).
 */
import { useMemo } from 'react';
import type { EnrichedDungeonQuestDto, EventQuestPrereqsResponse, QuestCoverageEntry } from '@raid-ledger/contract';
import { summariseQuestPrep, type QuestPrepTodo } from './quest-prep-todo';

/** Memoised to-do counts for the panel's usable quests. */
export function useQuestPrepTodo(
    quests: EnrichedDungeonQuestDto[],
    coverageMap: Map<number, QuestCoverageEntry>,
    prereqs: EventQuestPrereqsResponse | undefined,
): QuestPrepTodo {
    return useMemo(() => summariseQuestPrep(quests, coverageMap, prereqs), [quests, coverageMap, prereqs]);
}
