/**
 * ROK-1748 L5c: the "You need N more pre-reqs" line in the Quest Prep header.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { EventQuestPrereqsResponse } from '@raid-ledger/contract';
import { QuestPrepNeededLine } from './quest-prep-needed-line';

function makeResponse(neededTotal: number): NonNullable<EventQuestPrereqsResponse> {
    return {
        characterId: '11111111-1111-4111-8111-111111111111',
        asOf: '2026-10-01T12:00:00.000Z',
        quests: [],
        neededTotal,
    };
}

describe('QuestPrepNeededLine', () => {
    it('says how many pre-reqs are still needed in text-warning', () => {
        render(<QuestPrepNeededLine prereqs={makeResponse(2)} />);
        const line = screen.getByText('You need 2 more pre-reqs');
        expect(line).toHaveClass('text-sm', 'text-warning');
    });

    it('says all pre-reqs are done in text-success when none are needed', () => {
        render(<QuestPrepNeededLine prereqs={makeResponse(0)} />);
        expect(screen.getByText('All pre-reqs done')).toHaveClass('text-success');
    });

    it('renders nothing without a state', () => {
        const { container } = render(<QuestPrepNeededLine prereqs={null} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing without an addon snapshot (R-3: we cannot know)', () => {
        const { container } = render(<QuestPrepNeededLine prereqs={{ ...makeResponse(1), asOf: null }} />);
        expect(container).toBeEmptyDOMElement();
    });
});
