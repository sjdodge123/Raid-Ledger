/**
 * Prerequisite chain line on an expanded quest card ("Requires: A → B → C").
 * ROK-1748: with the viewer's chain state each step is marked done / needed.
 */
import type { EnrichedDungeonQuestDto, QuestPrereqState, QuestPrereqStep } from '@raid-ledger/contract';
import { formatAddonSourceLine } from '../lib/addon-source-line';

interface ChainStep { questId: number; name: string }

/**
 * Status mark for one step. The token class sits on this INNER span — the unlayered
 * `.quest-prereq__step` colour rule would otherwise beat a Tailwind utility (ROK-1745).
 */
function StepMark({ step }: { step: QuestPrereqStep }) {
    const done = step.done;
    return (
        <span className={done ? 'text-success' : 'text-warning'} data-testid={`quest-prereq-mark-${step.questId}`}>
            {done ? '✓ ' : '○ '}
            <span className="sr-only">{done ? 'done' : 'needed'}</span>
        </span>
    );
}

function hasAddonSource(state: QuestPrereqState): boolean {
    return state.completedSource === 'addon' || state.steps.some((s) => s.source === 'addon');
}

/**
 * Render a quest's prerequisite chain. Without `state` the markup is exactly the
 * pre-ROK-1748 render (Classic events, AC6).
 */
export function QuestPrereqChain({ quest, state, asOf }: {
    quest: EnrichedDungeonQuestDto; state?: QuestPrereqState | undefined; asOf?: string | null | undefined;
}) {
    const stepById = new Map(state?.steps.map((s) => [s.questId, s]));
    const chain = (
        <div className="quest-prereq">
            <span className="text-xs">Requires:</span>
            {quest.prerequisiteChain!.map((step: ChainStep, idx: number) => {
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
    if (!state || !hasAddonSource(state)) return chain;
    return (
        <>
            {chain}
            <p className="mt-1 text-xs text-muted" data-testid="quest-prereq-source">
                {asOf ? formatAddonSourceLine(asOf) : 'via addon'}
            </p>
        </>
    );
}
