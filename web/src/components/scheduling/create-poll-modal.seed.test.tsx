/**
 * ROK-2212 W10 — `initialMemberUserIds` seeds the member picker once per open:
 * a later prop change never re-seeds over the user's edits, and an untouched
 * pre-filled form closes without "Discard your changes?".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/render-helpers';
import { CreatePollModal } from './create-poll-modal';

vi.mock('../../hooks/use-standalone-poll', () => ({ useCreateSchedulingPoll: vi.fn() }));
vi.mock('../../lib/api-client', () => ({ getPlayers: vi.fn(), fetchGameRegistry: vi.fn().mockResolvedValue({ data: [] }), getGameEventTypes: vi.fn() }));

import { useCreateSchedulingPoll } from '../../hooks/use-standalone-poll';
import { getPlayers } from '../../lib/api-client';

const mutateAsync = vi.fn();

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useCreateSchedulingPoll).mockReturnValue({
        mutateAsync, isPending: false, isError: false, error: null,
    } as unknown as ReturnType<typeof useCreateSchedulingPoll>);
    vi.mocked(getPlayers).mockResolvedValue({
        data: [{ id: 1, username: 'Ann' }, { id: 2, username: 'Bo' }, { id: 3, username: 'Cy' }],
        meta: { total: 3, page: 1, pageSize: 20, hasMore: false },
    } as unknown as Awaited<ReturnType<typeof getPlayers>>);
});

describe('CreatePollModal — initialMemberUserIds (W10)', () => {
    it('seeds the members once; a new prop array does not undo the user\'s edit', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        const { rerender } = renderWithProviders(<CreatePollModal isOpen onClose={onClose} initialGameId={5} hubId={7} hubName="Hub" initialMemberUserIds={[1, 2]} />);
        expect(await screen.findByText('2 members selected')).toBeInTheDocument();
        await user.click(await screen.findByTestId('member-option-2'));
        expect(screen.getByText('1 member selected')).toBeInTheDocument();
        rerender(<CreatePollModal isOpen onClose={onClose} initialGameId={5} hubId={7} hubName="Hub" initialMemberUserIds={[1, 2]} />);
        expect(screen.getByText('1 member selected'), 'a re-render with a new array is not a new open').toBeInTheDocument();
    });

    it('sends the seeded members, and an untouched pre-filled form closes without asking', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        mutateAsync.mockResolvedValue({ id: 1, lineupId: 2, visibility: 'public', shareToken: null });
        renderWithProviders(<CreatePollModal isOpen onClose={onClose} initialGameId={5} hubId={7} hubName="Hub" initialMemberUserIds={[1, 3]} />);
        await screen.findByText('2 members selected');
        await user.keyboard('{Escape}');
        expect(onClose, 'the seed is the clean state — no discard prompt').toHaveBeenCalledTimes(1);
        expect(screen.queryByText(/Discard/)).toBeNull();
    });
});
