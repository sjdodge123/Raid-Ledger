/**
 * ROK-2169 (was ROK-1748 L5c): the to-do lines under the Quest Prep header —
 * sharable quests someone still has to grab, and quest chains each player
 * has to complete with the viewer's own progress.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QuestPrepNeededLine } from './quest-prep-needed-line';
import type { QuestPrepTodo } from './quest-prep-todo';

function todo(overrides: Partial<QuestPrepTodo>): QuestPrepTodo {
    return { sharableToGrab: 0, chains: 0, viewer: { status: 'unknown' }, ...overrides };
}

describe('QuestPrepNeededLine — sharables', () => {
    it('says how many sharable quests someone needs to grab, in text-warning', () => {
        render(<QuestPrepNeededLine todo={todo({ sharableToGrab: 3 })} />);
        const line = screen.getByTestId('quest-prep-sharable-line');
        expect(line).toHaveTextContent(/^Someone needs to grab 3 sharable quests$/);
        expect(line).toHaveClass('text-sm', 'text-warning');
    });

    it('uses the singular for exactly one sharable quest', () => {
        render(<QuestPrepNeededLine todo={todo({ sharableToGrab: 1 })} />);
        expect(screen.getByTestId('quest-prep-sharable-line'))
            .toHaveTextContent(/^Someone needs to grab 1 sharable quest$/);
    });
});

describe('QuestPrepNeededLine — chains', () => {
    it('without a snapshot: count only, in text-warning', () => {
        render(<QuestPrepNeededLine todo={todo({ chains: 2 })} />);
        const line = screen.getByTestId('quest-prep-chains-line');
        expect(line).toHaveTextContent(/^Each player needs to complete 2 quest chains$/);
        expect(line).toHaveClass('text-warning');
        expect(screen.queryByTestId('quest-prep-sharable-line')).toBeNull();
    });

    it('with steps missing: adds the viewer count, in text-warning', () => {
        render(<QuestPrepNeededLine todo={todo({ chains: 1, viewer: { status: 'missing', steps: 3 } })} />);
        const line = screen.getByTestId('quest-prep-chains-line');
        expect(line).toHaveTextContent(/^Each player needs to complete 1 quest chain · you still need 3 more steps$/);
        expect(line).toHaveClass('text-warning');
    });

    it('uses the singular for exactly one missing step', () => {
        render(<QuestPrepNeededLine todo={todo({ chains: 2, viewer: { status: 'missing', steps: 1 } })} />);
        expect(screen.getByTestId('quest-prep-chains-line'))
            .toHaveTextContent(/^Each player needs to complete 2 quest chains · you still need 1 more step$/);
    });

    it('with the viewer done: muted line, "yours are done" in text-success', () => {
        render(<QuestPrepNeededLine todo={todo({ chains: 2, viewer: { status: 'done' } })} />);
        const line = screen.getByTestId('quest-prep-chains-line');
        expect(line).toHaveTextContent(/^Each player needs to complete 2 quest chains · yours are done$/);
        expect(line).toHaveClass('text-muted');
        expect(line).not.toHaveClass('text-warning');
        expect(screen.getByText('· yours are done')).toHaveClass('text-success');
    });
});

describe('QuestPrepNeededLine — nothing to do', () => {
    it('renders both lines when both counts are positive', () => {
        render(<QuestPrepNeededLine todo={todo({ sharableToGrab: 1, chains: 1 })} />);
        expect(screen.getByTestId('quest-prep-sharable-line')).toBeInTheDocument();
        expect(screen.getByTestId('quest-prep-chains-line')).toBeInTheDocument();
    });

    it('renders nothing when both counts are zero, and never an "all done" line', () => {
        const { container } = render(<QuestPrepNeededLine todo={todo({ viewer: { status: 'done' } })} />);
        expect(container).toBeEmptyDOMElement();
        expect(screen.queryByText(/All pre-reqs done|yours are done/)).toBeNull();
    });
});
