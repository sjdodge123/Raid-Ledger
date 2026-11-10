/**
 * The to-do lines under the Quest Prep header (ROK-1748, reworked ROK-2169):
 * how many sharable quests someone still has to grab, and how many quest
 * chains each player has to complete, with the viewer's own progress.
 */
import { useMemo } from 'react';
import type { EnrichedDungeonQuestDto, EventQuestPrereqsResponse, QuestCoverageEntry } from '@raid-ledger/contract';
import { summariseQuestPrep, type QuestPrepTodo, type ViewerChainProgress } from './quest-prep-todo';

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** Memoised to-do counts for the panel's usable quests. */
export function useQuestPrepTodo(
    quests: EnrichedDungeonQuestDto[],
    coverageMap: Map<number, QuestCoverageEntry>,
    prereqs: EventQuestPrereqsResponse | undefined,
): QuestPrepTodo {
    return useMemo(() => summariseQuestPrep(quests, coverageMap, prereqs), [quests, coverageMap, prereqs]);
}

function SharableLine({ count }: { count: number }) {
    return (
        <p className="text-sm text-warning break-words" data-testid="quest-prep-sharable-line">
            Someone needs to grab {count} sharable {plural(count, 'quest', 'quests')}
        </p>
    );
}

function ChainsLine({ count, viewer }: { count: number; viewer: ViewerChainProgress }) {
    const done = viewer.status === 'done';
    return (
        <p className={`text-sm break-words ${done ? 'text-muted' : 'text-warning'}`} data-testid="quest-prep-chains-line">
            Each player needs to complete {count} quest {plural(count, 'chain', 'chains')}
            {viewer.status === 'missing' && ` · you still need ${viewer.steps} more ${plural(viewer.steps, 'step', 'steps')}`}
            {done && <span className="text-success"> · yours are done</span>}
        </p>
    );
}

/** Renders nothing when there is nothing left to grab and no chain to complete. */
export function QuestPrepNeededLine({ todo }: { todo: QuestPrepTodo }) {
    if (todo.sharableToGrab <= 0 && todo.chains <= 0) return null;
    return (
        <>
            {todo.sharableToGrab > 0 && <SharableLine count={todo.sharableToGrab} />}
            {todo.chains > 0 && <ChainsLine count={todo.chains} viewer={todo.viewer} />}
        </>
    );
}
