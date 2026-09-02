/**
 * ROK-1464 AC2 / AC7 / AC8 — the status bar and the full-group prompt.
 *
 * The bar is the only place the LFG → LFM transition is visible, and the only
 * place a viewer joins or withdraws, so the copy and the button identity are
 * asserted rather than the layout.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/render-helpers';
import {
    createMockLfgGroupDetail,
    createMockLfgIntent,
    createMockLfgMember,
} from '../../test/lfg-factories';
import { LfgStatusBar } from './LfgStatusBar';
import { LfgFullGroupPrompt } from './LfgFullGroupPrompt';

function renderBar(group = createMockLfgGroupDetail(), handlers = {}) {
    const props = {
        group,
        onJoin: vi.fn(),
        onWithdraw: vi.fn(),
        onFindATime: vi.fn(),
        ...handlers,
    };
    renderWithProviders(<LfgStatusBar {...props} />);
    return props;
}

describe('LfgStatusBar', () => {
    it('reads "Looking for group" for a single player', () => {
        renderBar(createMockLfgGroupDetail({ activeCount: 1, state: 'lfg' }));

        expect(screen.getByText('Looking for group')).toBeInTheDocument();
        expect(screen.queryByText('Looking for members')).toBeNull();
    });

    it('flips to "Looking for members" once a second player joins', () => {
        renderBar(
            createMockLfgGroupDetail({
                activeCount: 2,
                state: 'lfm',
                members: [
                    createMockLfgMember(),
                    createMockLfgMember({ userId: 2, username: 'bo' }),
                ],
            }),
        );

        expect(screen.getByText('Looking for members')).toBeInTheDocument();
    });

    it('names the missing headcount when a viability threshold is known', () => {
        renderBar(
            createMockLfgGroupDetail({
                activeCount: 1,
                viabilityThreshold: 4,
            }),
        );

        expect(
            screen.getByText('1 looking · needs 3 more'),
        ).toBeInTheDocument();
    });

    it('falls back to a qualitative nudge when no threshold exists', () => {
        renderBar(
            createMockLfgGroupDetail({
                activeCount: 1,
                viabilityThreshold: null,
            }),
        );

        expect(
            screen.getByText('1 looking — one more makes it a group'),
        ).toBeInTheDocument();
        expect(screen.queryByText(/needs \d+ more/)).toBeNull();
    });
});

describe('LfgStatusBar — actions', () => {
    it('offers +1 when the viewer holds no intent', async () => {
        const user = userEvent.setup();
        const props = renderBar(
            createMockLfgGroupDetail({ ownIntent: null, hasOwnIntent: false }),
        );

        await user.click(screen.getByRole('button', { name: /i'm in/i }));

        expect(props.onJoin).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('button', { name: 'Withdraw' })).toBeNull();
    });

    it('offers Withdraw when the viewer already holds an intent', async () => {
        const user = userEvent.setup();
        const props = renderBar(
            createMockLfgGroupDetail({
                hasOwnIntent: true,
                ownIntent: createMockLfgIntent(),
            }),
        );

        await user.click(screen.getByRole('button', { name: 'Withdraw' }));

        expect(props.onWithdraw).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('button', { name: /i'm in/i })).toBeNull();
    });

    it('raises Find a time from the bar', async () => {
        const user = userEvent.setup();
        const props = renderBar();

        await user.click(screen.getByRole('button', { name: 'Find a time' }));

        expect(props.onFindATime).toHaveBeenCalledTimes(1);
    });

    it('shows the be-the-first empty state and still offers +1 at zero', () => {
        renderBar(
            createMockLfgGroupDetail({
                activeCount: 0,
                state: null,
                members: [],
            }),
        );

        expect(
            screen.getByText(
                "Nobody's looking for a group right now — be the first",
            ),
        ).toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: /i'm in/i }),
        ).toBeInTheDocument();
        expect(
            screen.queryByRole('button', { name: 'Find a time' }),
        ).toBeNull();
    });
});

describe('LfgFullGroupPrompt', () => {
    it('appears only once the server calls the group viable', async () => {
        const user = userEvent.setup();
        const onFindATime = vi.fn();
        renderWithProviders(
            <LfgFullGroupPrompt
                group={createMockLfgGroupDetail({
                    activeCount: 4,
                    viabilityThreshold: 4,
                    isViable: true,
                })}
                onFindATime={onFindATime}
            />,
        );

        expect(
            screen.getByText('You have a full group — find a time?'),
        ).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Find a time' }));
        expect(onFindATime).toHaveBeenCalledTimes(1);
    });

    it('stays hidden while the group is short of the threshold', () => {
        const { container } = renderWithProviders(
            <LfgFullGroupPrompt
                group={createMockLfgGroupDetail({
                    activeCount: 2,
                    viabilityThreshold: 4,
                    isViable: false,
                })}
                onFindATime={vi.fn()}
            />,
        );

        expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing at all when there is no threshold to measure', () => {
        const { container } = renderWithProviders(
            <LfgFullGroupPrompt
                group={createMockLfgGroupDetail({
                    activeCount: 9,
                    viabilityThreshold: null,
                    isViable: false,
                })}
                onFindATime={vi.fn()}
            />,
        );

        expect(container).toBeEmptyDOMElement();
    });
});
