/**
 * SchedulingAddMembersAction tests (ROK-1440).
 *
 * Covers the creator/operator visibility gate (via the real
 * canBypassThreshold), the read-only hide, and the mutate payload — the
 * poll roster is otherwise derived, so this button is the only way a creator
 * can enrol members whose availability the lock threshold depends on.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MatchDetailResponseDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../../test/render-helpers';
import { SchedulingAddMembersAction } from '../SchedulingAddMembersAction';
import { getPlayers } from '../../../../lib/api-client';

vi.mock('../../../../lib/api-client', () => ({
    getPlayers: vi.fn(),
}));

const addMutateAsync = vi.fn().mockResolvedValue({ added: 1, memberCount: 3 });
let isPending = false;
vi.mock('../../../../hooks/use-scheduling', () => ({
    useAddPollMembers: () => ({
        mutateAsync: addMutateAsync,
        isPending,
    }),
}));

let authedUser: { id: number; role: string } | null = {
    id: 10,
    role: 'member',
};
vi.mock('../../../../hooks/use-auth', () => ({
    useAuth: () => ({ user: authedUser }),
}));

const match = { lineupCreatedById: 10 } as MatchDetailResponseDto;

function renderAction(readOnly = false) {
    return renderWithProviders(
        <SchedulingAddMembersAction
            lineupId={5}
            matchId={9}
            match={match}
            readOnly={readOnly}
        />,
    );
}

describe('SchedulingAddMembersAction', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        isPending = false;
        authedUser = { id: 10, role: 'member' };
        vi.mocked(getPlayers).mockResolvedValue({
            data: [
                { id: 10, username: 'alice', avatar: null, discordId: 'd-10' },
                { id: 11, username: 'bob', avatar: null, discordId: null },
            ],
            meta: { total: 2, page: 1, pageSize: 20, hasMore: false },
        } as unknown as Awaited<ReturnType<typeof getPlayers>>);
    });

    it('renders nothing for a plain member who is not the creator', () => {
        authedUser = { id: 99, role: 'member' };
        const { container } = renderAction();
        expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing when the poll is read-only', () => {
        const { container } = renderAction(true);
        expect(container).toBeEmptyDOMElement();
    });

    it('renders for the lineup creator', () => {
        renderAction();
        expect(screen.getByTestId('add-poll-members-button')).toBeInTheDocument();
    });

    it('renders for an operator who is not the creator', () => {
        authedUser = { id: 99, role: 'operator' };
        renderAction();
        expect(screen.getByTestId('add-poll-members-button')).toBeInTheDocument();
    });

    it('opens the picker and submits the chosen ids for this match', async () => {
        const user = userEvent.setup();
        renderAction();
        await user.click(screen.getByTestId('add-poll-members-button'));
        const row = await screen.findByTestId('invitee-option-10');
        await user.click(row);
        await user.click(screen.getByTestId('add-poll-members-submit'));
        expect(addMutateAsync).toHaveBeenCalledTimes(1);
        expect(addMutateAsync.mock.calls[0][0]).toEqual({
            lineupId: 5,
            matchId: 9,
            userIds: [10],
        });
    });

    it('keeps submit disabled until at least one member is picked', async () => {
        const user = userEvent.setup();
        renderAction();
        await user.click(screen.getByTestId('add-poll-members-button'));
        const submit = await screen.findByTestId('add-poll-members-submit');
        expect(submit).toBeDisabled();
    });
});
