/**
 * ROK-1748 L5c: per-step done/needed marks on the quest prerequisite chain.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { EnrichedDungeonQuestDto, QuestPrereqState } from '@raid-ledger/contract';
import { QuestPrereqChain } from './quest-prereq-chain';

const quest = {
    questId: 20,
    name: 'Final Step',
    prerequisiteChain: [
        { questId: 10, name: 'First Step' },
        { questId: 20, name: 'Final Step' },
    ],
} as EnrichedDungeonQuestDto;

function makeState(overrides: Partial<QuestPrereqState> = {}): QuestPrereqState {
    return {
        questId: 20,
        steps: [
            { questId: 10, name: 'First Step', done: true, source: 'addon' },
            { questId: 20, name: 'Final Step', done: false, source: null },
        ],
        neededCount: 1,
        completed: false,
        completedSource: null,
        ...overrides,
    };
}

/** Today's (pre-ROK-1748) markup for the chain — Classic must render exactly this. */
const LEGACY_MARKUP =
    '<div class="quest-prereq"><span class="text-xs">Requires:</span>'
    + '<span><span class="quest-prereq__step">First Step</span></span>'
    + '<span><span class="quest-prereq__arrow"> → </span>'
    + '<span class="quest-prereq__step--current">Final Step</span></span></div>';

describe('QuestPrereqChain', () => {
    it('renders the unchanged legacy markup when no state is given (AC6)', () => {
        const { container } = render(<QuestPrereqChain quest={quest} />);
        expect(container.innerHTML).toBe(LEGACY_MARKUP);
    });

    it('marks a done step with text-success, a check glyph and sr-only "done"', () => {
        render(<QuestPrereqChain quest={quest} state={makeState()} asOf="2026-10-01T12:00:00.000Z" />);
        const mark = screen.getByTestId('quest-prereq-mark-10');
        expect(mark).toHaveClass('text-success');
        expect(mark).toHaveTextContent('✓');
        expect(mark.querySelector('.sr-only')).toHaveTextContent('done');
    });

    it('marks a needed step with text-warning and sr-only "needed"', () => {
        render(<QuestPrereqChain quest={quest} state={makeState()} />);
        const mark = screen.getByTestId('quest-prereq-mark-20');
        expect(mark).toHaveClass('text-warning');
        expect(mark).not.toHaveClass('text-success');
        expect(mark.querySelector('.sr-only')).toHaveTextContent('needed');
    });

    it('keeps the current-quest class on the current step', () => {
        const { container } = render(<QuestPrereqChain quest={quest} state={makeState()} />);
        expect(container.querySelector('.quest-prereq__step--current')).toHaveTextContent('Final Step');
    });

    it('shows the addon source line when any step came from the addon', () => {
        render(<QuestPrereqChain quest={quest} state={makeState()} asOf="2026-10-01T12:00:00.000Z" />);
        const line = screen.getByTestId('quest-prereq-source');
        expect(line).toHaveTextContent('via addon · 1 Oct 2026');
        expect(line).toHaveClass('text-xs', 'text-muted');
    });

    it('shows no source line when every step is manual', () => {
        const steps = makeState().steps.map((s) => ({ ...s, source: 'manual' as const }));
        render(<QuestPrereqChain quest={quest} state={makeState({ steps })} asOf="2026-10-01T12:00:00.000Z" />);
        expect(screen.queryByTestId('quest-prereq-source')).toBeNull();
    });
});
