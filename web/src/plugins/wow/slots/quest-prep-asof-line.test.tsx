/**
 * ROK-2144: the "Your progress" and "Quest data via Blizzard" as-of lines under the
 * Quest Prep header (placement B + Q5).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { EventQuestPrereqsResponse, QuestPrereqState } from '@raid-ledger/contract';
import { QuestPrepAsOfLine } from './quest-prep-asof-line';

type Prereqs = NonNullable<EventQuestPrereqsResponse>;

const COMPLETED_AT = '2026-11-02T12:00:00.000Z';
const LOG_AT = '2026-11-09T12:00:00.000Z';

function doneState(source: QuestPrereqState['completedSource']): QuestPrereqState {
    return { questId: 100, steps: [], neededCount: 0, completed: true, completedSource: source };
}

function makeResponse(overrides: Partial<Prereqs> = {}): Prereqs {
    return {
        characterId: '11111111-1111-4111-8111-111111111111',
        asOf: COMPLETED_AT,
        quests: [doneState('addon')],
        neededTotal: 0,
        inProgressAsOf: LOG_AT,
        questDataImportedAt: null,
        ...overrides,
    };
}

describe('QuestPrepAsOfLine — your progress', () => {
    it('dates the completed list and the quest log separately in text-xs text-muted', () => {
        render(<QuestPrepAsOfLine prereqs={makeResponse()} />);
        const line = screen.getByTestId('quest-prep-progress-asof');
        expect(line).toHaveTextContent('Your progress: completed list via addon · 2 Nov 2026 · quest log 9 Nov 2026');
        expect(line).toHaveClass('text-xs', 'text-muted');
    });

    it('collapses to one date when the log was captured the same day', () => {
        render(<QuestPrepAsOfLine prereqs={makeResponse({ inProgressAsOf: '2026-11-02T12:30:00.000Z' })} />);
        expect(screen.getByTestId('quest-prep-progress-asof')).toHaveTextContent(/^Your progress: via addon · 2 Nov 2026$/);
    });

    it('collapses to one date when the response carries no log date', () => {
        render(<QuestPrepAsOfLine prereqs={makeResponse({ inProgressAsOf: null })} />);
        expect(screen.getByTestId('quest-prep-progress-asof')).toHaveTextContent(/^Your progress: via addon · 2 Nov 2026$/);
    });

    it('names the Armory when the completed list came from the Armory sync', () => {
        render(<QuestPrepAsOfLine prereqs={makeResponse({ asOf: '2026-11-07T12:00:00.000Z', quests: [doneState('blizzard')] })} />);
        expect(screen.getByTestId('quest-prep-progress-asof'))
            .toHaveTextContent('Your progress: completed list via Armory · 7 Nov 2026 · quest log 9 Nov 2026');
    });

    it('takes the source from a dated step when no quest is completed', () => {
        const state: QuestPrereqState = {
            questId: 20, neededCount: 1, completed: false, completedSource: null,
            steps: [{ questId: 10, name: 'First Step', done: true, source: 'addon' }],
        };
        render(<QuestPrepAsOfLine prereqs={makeResponse({ quests: [state] })} />);
        expect(screen.getByTestId('quest-prep-progress-asof')).toHaveTextContent('completed list via addon · 2 Nov 2026');
    });

    it('keeps "via addon" when the viewer has completed none of the quests (asOfSource)', () => {
        const state: QuestPrereqState = {
            questId: 20, neededCount: 1, completed: false, completedSource: null,
            steps: [{ questId: 10, name: 'First Step', done: false, source: null }],
        };
        render(<QuestPrepAsOfLine prereqs={makeResponse({ quests: [state], asOfSource: 'addon' })} />);
        expect(screen.getByTestId('quest-prep-progress-asof'))
            .toHaveTextContent(/^Your progress: completed list via addon · 2 Nov 2026 · quest log 9 Nov 2026$/);
    });

    it('names the Armory from asOfSource with no quest states to infer from', () => {
        render(<QuestPrepAsOfLine prereqs={makeResponse({ quests: [], asOfSource: 'blizzard', inProgressAsOf: null })} />);
        expect(screen.getByTestId('quest-prep-progress-asof')).toHaveTextContent(/^Your progress: via Armory · 2 Nov 2026$/);
    });

    it('renders no progress line without a snapshot date (asOf null)', () => {
        render(<QuestPrepAsOfLine prereqs={makeResponse({ asOf: null })} />);
        expect(screen.queryByTestId('quest-prep-progress-asof')).toBeNull();
    });
});

describe('QuestPrepAsOfLine — quest catalogue (Q5)', () => {
    it('shows "Quest data via Blizzard · <date>" in text-xs text-dim under the progress line', () => {
        render(<QuestPrepAsOfLine prereqs={makeResponse({ questDataImportedAt: LOG_AT })} />);
        const line = screen.getByTestId('quest-prep-catalogue-asof');
        expect(line).toHaveTextContent(/^Quest data via Blizzard · 9 Nov 2026$/);
        expect(line).toHaveClass('text-xs', 'text-dim');
        const progress = screen.getByTestId('quest-prep-progress-asof');
        expect(progress.nextElementSibling, 'the catalogue line sits directly under the progress line').toBe(line);
    });

    it('renders no catalogue line when the import date is null', () => {
        render(<QuestPrepAsOfLine prereqs={makeResponse({ questDataImportedAt: null })} />);
        expect(screen.queryByTestId('quest-prep-catalogue-asof')).toBeNull();
    });

    it('renders no catalogue line when the field is absent (older api)', () => {
        const legacy: Prereqs = {
            characterId: '11111111-1111-4111-8111-111111111111', asOf: COMPLETED_AT, quests: [doneState('addon')], neededTotal: 0,
        };
        render(<QuestPrepAsOfLine prereqs={legacy} />);
        expect(screen.queryByTestId('quest-prep-catalogue-asof')).toBeNull();
    });

    it('still shows the catalogue line when the viewer has no snapshot date', () => {
        render(<QuestPrepAsOfLine prereqs={makeResponse({ asOf: null, questDataImportedAt: LOG_AT })} />);
        expect(screen.getByTestId('quest-prep-catalogue-asof')).toHaveTextContent('Quest data via Blizzard · 9 Nov 2026');
    });
});

describe('QuestPrepAsOfLine — hidden', () => {
    it('renders nothing for a viewer without a Forever character (root-null response)', () => {
        const { container } = render(<QuestPrepAsOfLine prereqs={null} />);
        expect(container.innerHTML).toBe('');
    });

    it('renders nothing while the response is loading (undefined)', () => {
        const { container } = render(<QuestPrepAsOfLine prereqs={undefined} />);
        expect(container.innerHTML).toBe('');
    });
});
