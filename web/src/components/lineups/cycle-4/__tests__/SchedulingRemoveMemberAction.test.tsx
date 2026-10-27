/**
 * ROK-2020 — the Manage "Remove Participant" row: gate, roster minus the
 * creator, pick → confirm → DELETE, the optimistic roster drop, and the
 * error toast + restore for each refusal the API sends (400 / 403 / 404).
 * The real mutation hook runs against MSW; only auth and toast are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
    LineupParticipantsResponseDto,
    MatchDetailResponseDto,
} from '@raid-ledger/contract';
import { createTestQueryClient, renderWithProviders } from '../../../../test/render-helpers';
import { server } from '../../../../test/mocks/server';
import {
    createMockPollParticipant,
    pollParticipantsHandler,
    removePollMemberHandler,
    type RemoveMemberOutcome,
} from '../../../../test/mocks/poll-member-handlers';
import { toast } from '../../../../lib/toast';
import { SchedulingRemoveMemberAction } from '../SchedulingRemoveMemberAction';

vi.mock('../../../../lib/toast', () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

let viewer: { id: number; role: string } = { id: 10, role: 'member' };
// `fetchApi` reads the token from this module too — the real MSW round trip needs it.
vi.mock('../../../../hooks/use-auth', () => ({
    useAuth: () => ({ user: viewer }),
    getAuthToken: () => null,
    isOperatorOrAdmin: (u: { role?: string } | null) =>
        u?.role === 'operator' || u?.role === 'admin',
}));

const match = { lineupCreatedById: 10, members: [] } as unknown as MatchDetailResponseDto;
const roster = [
    createMockPollParticipant({ userId: 10, displayName: 'Creator Cat', role: 'creator' }),
    createMockPollParticipant({ userId: 2, displayName: 'Bob' }),
    createMockPollParticipant({ userId: 3, displayName: 'Dana', status: 'waiting' }),
];
const ROSTER_KEY = ['lineups', 'participants', 5, 9];

let getCalls: string[];
let deleteCalls: string[];

function renderAction(readOnly = false) {
    const queryClient = createTestQueryClient();
    renderWithProviders(
        <SchedulingRemoveMemberAction lineupId={5} matchId={9} match={match} readOnly={readOnly} />,
        { queryClient },
    );
    return queryClient;
}

const cachedIds = (qc: ReturnType<typeof createTestQueryClient>): number[] =>
    (qc.getQueryData<LineupParticipantsResponseDto>(ROSTER_KEY)?.participants ?? []).map(
        (p) => p.userId,
    );

async function pickBob(): Promise<void> {
    await userEvent.click(screen.getByRole('button', { name: 'Remove Participant' }));
    await userEvent.click(await screen.findByTestId('remove-poll-member-2'));
}

describe('SchedulingRemoveMemberAction (ROK-2020)', () => {
    beforeEach(() => {
        viewer = { id: 10, role: 'member' };
        getCalls = [];
        deleteCalls = [];
        vi.mocked(toast.success).mockClear();
        vi.mocked(toast.error).mockClear();
        server.use(pollParticipantsHandler(roster, getCalls));
    });

    it('is hidden from a plain member and in a read-only poll', () => {
        viewer = { id: 99, role: 'member' };
        renderAction();
        expect(screen.queryByTestId('remove-poll-member-button')).toBeNull();
        viewer = { id: 10, role: 'member' };
        renderAction(true);
        expect(screen.queryByTestId('remove-poll-member-button')).toBeNull();
    });

    it('shows an operator who is not the creator the row too', () => {
        viewer = { id: 77, role: 'operator' };
        renderAction();
        expect(screen.getByTestId('remove-poll-member-button')).toHaveTextContent(
            'take someone off this poll',
        );
    });

    it('lists the poll roster minus the creator', async () => {
        renderAction();
        await userEvent.click(screen.getByRole('button', { name: 'Remove Participant' }));
        const list = await screen.findByTestId('remove-poll-member-list');
        expect(list).toHaveTextContent('Bob');
        expect(list).toHaveTextContent('Dana');
        expect(list).not.toHaveTextContent('Creator Cat');
        expect(screen.queryByTestId('remove-poll-member-10')).toBeNull();
        expect(getCalls).toEqual(['9']);
    });

    it('confirm sends the DELETE, toasts, closes and invalidates the roster', async () => {
        server.use(removePollMemberHandler({ removedVotes: 2, memberCount: 2 }, deleteCalls));
        const qc = renderAction();
        await pickBob();
        expect(screen.getByTestId('remove-poll-member-confirm-body')).toHaveTextContent(
            'Remove Bob from this poll? Their votes on this poll are deleted too.',
        );
        await userEvent.click(screen.getByTestId('remove-poll-member-confirm'));
        await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Removed Bob from this poll'));
        expect(deleteCalls).toEqual(['5/9/2']);
        expect(screen.queryByRole('dialog')).toBeNull();
        // The modal (the roster's only observer) closed, so the roster is marked
        // stale for the next open rather than refetched now.
        await waitFor(() => expect(qc.getQueryState(ROSTER_KEY)?.isInvalidated).toBe(true));
    });

    it('drops the person from the cached roster before the server answers', async () => {
        let release = (): void => {};
        const gate = new Promise<void>((r) => { release = r; });
        server.use(removePollMemberHandler({ removedVotes: 0, memberCount: 2 }, deleteCalls, gate));
        const qc = renderAction();
        await pickBob();
        await userEvent.click(screen.getByTestId('remove-poll-member-confirm'));
        await waitFor(() => expect(cachedIds(qc)).toEqual([10, 3]));
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
        release();
        await waitFor(() => expect(toast.success).toHaveBeenCalled());
    });

    it('Cancel on the confirm returns to the list without a DELETE', async () => {
        server.use(removePollMemberHandler({ removedVotes: 0, memberCount: 3 }, deleteCalls));
        renderAction();
        await pickBob();
        await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(await screen.findByTestId('remove-poll-member-2')).toBeInTheDocument();
        expect(deleteCalls).toEqual([]);
    });

    it.each<[number, string]>([
        [400, "The poll creator can't be removed — cancel the poll instead"],
        [403, 'Only the poll creator or an operator can manage participants'],
        [404, 'Not a participant of this poll'],
    ])('a %i toasts the API message and restores the roster', async (status, message) => {
        const outcome = { status, message } as RemoveMemberOutcome;
        server.use(removePollMemberHandler(outcome, deleteCalls));
        const qc = renderAction();
        await pickBob();
        await userEvent.click(screen.getByTestId('remove-poll-member-confirm'));
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message));
        expect(toast.success).not.toHaveBeenCalled();
        expect(await screen.findByTestId('remove-poll-member-2')).toBeInTheDocument();
        await waitFor(() => expect(cachedIds(qc)).toEqual([10, 2, 3]));
    });
});
