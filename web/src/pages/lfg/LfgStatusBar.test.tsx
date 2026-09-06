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

        // ROK-1479: +1 now ASKS when, exactly as the hearted prompt does, so
        // the join only fires on the second click.
        expect(props.onJoin).not.toHaveBeenCalled();
        await user.click(screen.getByTestId('lfg-urgency-week'));

        expect(props.onJoin).toHaveBeenCalledTimes(1);
        expect(props.onJoin).toHaveBeenCalledWith({ urgency: 'week' });
        expect(screen.queryByRole('button', { name: 'Withdraw' })).toBeNull();
    });

    it('carries no ttlMinutes KEY on a weekly pick (A2)', async () => {
        const user = userEvent.setup();
        const props = renderBar(
            createMockLfgGroupDetail({ ownIntent: null, hasOwnIntent: false }),
        );

        await user.click(screen.getByRole('button', { name: /i'm in/i }));
        await user.click(screen.getByTestId('lfg-urgency-week'));

        // `toEqual` ignores an undefined-valued key; the contract does not —
        // it rejects `week` PAIRED with a ttl rather than dropping it.
        const pick = (props.onJoin as ReturnType<typeof vi.fn>).mock
            .calls[0]?.[0] as Record<string, unknown>;
        expect(Object.keys(pick)).not.toContain('ttlMinutes');
    });

    it('joins as a 30-minute now intent from the group page', async () => {
        const user = userEvent.setup();
        const props = renderBar(
            createMockLfgGroupDetail({ ownIntent: null, hasOwnIntent: false }),
        );

        await user.click(screen.getByRole('button', { name: /i'm in/i }));
        await user.click(screen.getByTestId('lfg-urgency-now-30'));

        expect(props.onJoin).toHaveBeenCalledWith({
            urgency: 'now',
            ttlMinutes: 30,
        });
    });

    it('joins as an hour-long now intent when that is the pick', async () => {
        const user = userEvent.setup();
        const props = renderBar(
            createMockLfgGroupDetail({ ownIntent: null, hasOwnIntent: false }),
        );

        await user.click(screen.getByRole('button', { name: /i'm in/i }));
        await user.click(screen.getByTestId('lfg-urgency-now-60'));

        expect(props.onJoin).toHaveBeenCalledWith({
            urgency: 'now',
            ttlMinutes: 60,
        });
    });

    it('closes the choice again when +1 is re-clicked', async () => {
        const user = userEvent.setup();
        const props = renderBar(
            createMockLfgGroupDetail({ ownIntent: null, hasOwnIntent: false }),
        );
        const plusOne = screen.getByRole('button', { name: /i'm in/i });

        await user.click(plusOne);
        expect(screen.getByTestId('lfg-urgency-choice')).toBeInTheDocument();
        await user.click(plusOne);

        expect(screen.queryByTestId('lfg-urgency-choice')).toBeNull();
        expect(props.onJoin).not.toHaveBeenCalled();
    });

    it('offers the same choice from the empty-group state', async () => {
        const user = userEvent.setup();
        const props = renderBar(
            createMockLfgGroupDetail({
                activeCount: 0,
                members: [],
                ownIntent: null,
                hasOwnIntent: false,
            }),
        );

        await user.click(screen.getByRole('button', { name: /i'm in/i }));
        await user.click(screen.getByTestId('lfg-urgency-now-30'));

        expect(props.onJoin).toHaveBeenCalledWith({
            urgency: 'now',
            ttlMinutes: 30,
        });
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

    it('raises Find a time once the viewer is actually in the group', async () => {
        const user = userEvent.setup();
        const props = renderBar(
            createMockLfgGroupDetail({
                hasOwnIntent: true,
                ownIntent: createMockLfgIntent(),
            }),
        );

        const button = screen.getByRole('button', { name: 'Find a time' });
        expect(button).toBeEnabled();
        await user.click(button);

        expect(props.onFindATime).toHaveBeenCalledTimes(1);
    });
});

describe('LfgStatusBar — join gate', () => {
    it('gates Find a time behind +1 — convert only accepts participants', () => {
        renderBar(
            createMockLfgGroupDetail({ hasOwnIntent: false, ownIntent: null }),
        );

        const button = screen.getByRole('button', { name: 'Find a time' });
        expect(button).toBeDisabled();
        expect(button).toHaveAttribute(
            'title',
            '+1 first — you have to be in the group to start its poll',
        );
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
                    hasOwnIntent: true,
                    ownIntent: createMockLfgIntent(),
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

describe('LfgFullGroupPrompt — join gate', () => {
    it('disables its CTA for a viewer who has not joined the group', () => {
        renderWithProviders(
            <LfgFullGroupPrompt
                group={createMockLfgGroupDetail({
                    activeCount: 4,
                    viabilityThreshold: 4,
                    isViable: true,
                    hasOwnIntent: false,
                    ownIntent: null,
                })}
                onFindATime={vi.fn()}
            />,
        );

        const button = screen.getByRole('button', { name: 'Find a time' });
        expect(button).toBeDisabled();
        expect(button).toHaveAttribute(
            'title',
            '+1 first — you have to be in the group to start its poll',
        );
    });
});

/** A group with `nowMembers` people wanting to play right now. */
function groupWithNow(nowMembers: number, weekMembers = 1) {
    const now = Array.from({ length: nowMembers }, (_, i) =>
        createMockLfgMember({
            userId: 100 + i,
            username: `now-${i}`,
            urgency: 'now',
            expiresAt: new Date(Date.now() + (i + 1) * 600_000).toISOString(),
        }),
    );
    const week = Array.from({ length: weekMembers }, (_, i) =>
        createMockLfgMember({ userId: 200 + i, username: `week-${i}` }),
    );
    return createMockLfgGroupDetail({
        activeCount: nowMembers + weekMembers,
        state: nowMembers + weekMembers >= 2 ? 'lfm' : 'lfg',
        nowCount: nowMembers,
        members: [...week, ...now],
    });
}

describe('LfgStatusBar — right now (ROK-1479 A7)', () => {
    it('puts the Right now strip ABOVE the avatar row', () => {
        renderBar(groupWithNow(2));

        const strip = screen.getByTestId('lfg-now-strip');
        const avatars = screen.getByTestId('member-avatar-group');
        // DOM order is the acceptance criterion — presence alone would hold
        // with the strip rendered underneath.
        expect(
            strip.compareDocumentPosition(avatars) &
                Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
    });

    it('states how many of the group want to play now', () => {
        renderBar(groupWithNow(2));

        expect(screen.getByTestId('lfg-status-now-count')).toHaveTextContent(
            '🔥 2 want to play now',
        );
    });

    it('says nothing about now when the whole group is weekly', () => {
        renderBar(groupWithNow(0, 2));

        expect(screen.queryByTestId('lfg-status-now-count')).toBeNull();
        expect(screen.queryByTestId('lfg-now-strip')).toBeNull();
        // The weekly roster is untouched: the avatars still carry it.
        expect(screen.getByTestId('member-avatar-group')).toBeInTheDocument();
    });

    it('keeps the empty state free of both', () => {
        renderBar(
            createMockLfgGroupDetail({
                activeCount: 0,
                nowCount: 0,
                state: null,
                members: [],
            }),
        );

        expect(screen.queryByTestId('lfg-now-strip')).toBeNull();
        expect(screen.queryByTestId('lfg-status-now-count')).toBeNull();
        expect(
            screen.getByText("Nobody's looking for a group right now — be the first"),
        ).toBeInTheDocument();
    });
});
