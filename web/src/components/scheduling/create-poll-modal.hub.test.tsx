/**
 * ROK-1893 P3 — CreatePollModal opened from a hub: the game is locked (no
 * search), a "Tagged to <hub>" line shows, and the request carries `hubId`.
 * Without a hub nothing changes: the search shows and no `hubId` is sent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/render-helpers';
import { CreatePollModal } from './create-poll-modal';

vi.mock('../../hooks/use-standalone-poll', () => ({ useCreateSchedulingPoll: vi.fn() }));
vi.mock('../../lib/api-client', () => ({ getPlayers: vi.fn(), fetchGameRegistry: vi.fn().mockResolvedValue({ data: [] }), getGameEventTypes: vi.fn() }));
const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
    return { ...actual, useNavigate: () => navigate };
});

import { useCreateSchedulingPoll } from '../../hooks/use-standalone-poll';
import { getPlayers } from '../../lib/api-client';

const mutateAsync = vi.fn();

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useCreateSchedulingPoll).mockReturnValue({
        mutateAsync, isPending: false, isError: false, error: null,
    } as unknown as ReturnType<typeof useCreateSchedulingPoll>);
    vi.mocked(getPlayers).mockResolvedValue({
        data: [], meta: { total: 0, page: 1, pageSize: 20, hasMore: false },
    } as unknown as Awaited<ReturnType<typeof getPlayers>>);
});

describe('CreatePollModal — hub poll (ROK-1893 P3)', () => {
    it('locks the game, shows the hub tag and sends hubId', async () => {
        mutateAsync.mockResolvedValue({ id: 1, lineupId: 2, visibility: 'public', shareToken: null });
        const user = userEvent.setup();
        renderWithProviders(<CreatePollModal isOpen onClose={vi.fn()} initialGameId={5} hubId={7} hubName="Tavern Regulars" />);
        expect(screen.getByTestId('create-poll-hub-line')).toHaveTextContent('Tagged to Tavern Regulars');
        expect(screen.queryByTestId('game-search-input'), 'a hub poll is for the hub’s game only').toBeNull();
        await user.click(screen.getByRole('button', { name: /create poll/i }));
        expect(mutateAsync.mock.calls[0]?.[0]).toMatchObject({ gameId: 5, hubId: 7 });
        expect(navigate).toHaveBeenCalledWith('/community-lineup/2/schedule/1');
    });

    it('without a hub keeps the game search and the Create button disabled until a game is picked', () => {
        renderWithProviders(<CreatePollModal isOpen onClose={vi.fn()} />);
        expect(screen.getByTestId('game-search-input')).toBeInTheDocument();
        expect(screen.queryByTestId('create-poll-hub-line')).toBeNull();
        expect(screen.getByRole('button', { name: /create poll/i })).toBeDisabled();
    });
});
