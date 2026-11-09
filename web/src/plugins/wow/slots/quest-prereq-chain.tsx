/**
 * Prerequisite chain line on an expanded quest card ("Requires: A → B → C").
 * ROK-1748: with the viewer's chain state each step is marked done / needed.
 */
import type { EnrichedDungeonQuestDto, QuestPrereqState, QuestPrereqStep } from '@raid-ledger/contract';
import { asDatedSource, formatSourceLine, type DatedSource } from '../lib/addon-source-line';
import { prerequisiteCount } from './quest-card-constants';

interface ChainStep { questId: number; name: string }

/**
 * Status mark for one step. The token class sits on this INNER span — the unlayered
 * `.quest-prereq__step` colour rule would otherwise beat a Tailwind utility (ROK-1745).
 */
function StepMark({ step }: { step: QuestPrereqStep }) {
    const done = step.done;
    return (
        <span className={done ? 'text-success' : 'text-warning'} data-testid={`quest-prereq-mark-${step.questId}`}>
            <span aria-hidden="true">{done ? '✓ ' : '○ '}</span>
            <span className="sr-only">{done ? 'done' : 'needed'}</span>
        </span>
    );
}

/**
 * The snapshot the chain state came from: the completion's source, else the first
 * dated step's. Null for manual-only state (no source line). ROK-2109 adds the Armory.
 */
function datedSourceOf(state: QuestPrereqState): DatedSource | null {
    const completed = asDatedSource(state.completedSource);
    if (completed) return completed;
    for (const step of state.steps) {
        const source = asDatedSource(step.source);
        if (source) return source;
    }
    return null;
}

/**
 * Render a quest's prerequisite chain. Without `state` the markup is exactly the
 * pre-ROK-1748 render (Classic events, AC6). Nothing when no prerequisite sits
 * before the quest — it is never listed as its own prerequisite (ROK-2143).
 */
export function QuestPrereqChain({ quest, state, asOf }: {
    quest: EnrichedDungeonQuestDto; state?: QuestPrereqState | undefined; asOf?: string | null | undefined;
}) {
    const steps = quest.prerequisiteChain;
    if (!steps || prerequisiteCount(quest) === 0) return null;
    const chain = <ChainLine quest={quest} steps={steps} state={state} />;
    const source = state ? datedSourceOf(state) : null;
    if (!source) return chain;
    return (
        <>
            {chain}
            <p className="mt-1 text-xs text-muted" data-testid="quest-prereq-source">
                {formatSourceLine(source, asOf ?? '')}
            </p>
        </>
    );
}

/** "Requires: A → B → C" with the current quest highlighted. */
function ChainLine({ quest, steps, state }: {
    quest: EnrichedDungeonQuestDto; steps: ChainStep[]; state: QuestPrereqState | undefined;
}) {
    const stepById = new Map(state?.steps.map((s) => [s.questId, s]));
    return (
        <div className="quest-prereq">
            <span className="text-xs">Requires:</span>
            {steps.map((step: ChainStep, idx: number) => {
                const status = stepById.get(step.questId);
                return <span key={step.questId}>
                    {idx > 0 && <span className="quest-prereq__arrow"> &rarr; </span>}
                    <span className={step.questId === quest.questId ? 'quest-prereq__step--current' : 'quest-prereq__step'}>
                        {status && <StepMark step={status} />}{step.name}
                    </span>
                </span>;
            })}
        </div>
    );
}
