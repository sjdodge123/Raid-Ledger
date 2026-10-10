/**
 * ROK-1750 — CreatePollModal "Who can see this poll?":
 *  - Private sends `visibility:'private'`, does NOT navigate, and switches to a
 *    success state with the share link (Copy → copyWithToast) + Open poll.
 *  - Community (default) sends no `visibility` key and auto-navigates as before.
 *  - `hideVisibility` (ruling R3, reschedule polls) hides the control.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { IgdbGameDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../../test/render-helpers';
import { CreatePollModal } from './create-poll-modal';

vi.mock('../../hooks/use-standalone-poll', () => ({ useCreateSchedulingPoll: vi.fn() }));
vi.mock('../../lib/api-client', () => ({ getPlayers: vi.fn() }));
vi.mock('../../hooks/use-game-search', () => ({ useGameSearch: vi.fn() }));
vi.mock('../../lib/clipboard', () => ({ copyWithToast: vi.fn().mockResolvedValue(true) }));
const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
    return { ...actual, useNavigate: () => navigate };
});

import { useCreateSchedulingPoll } from '../../hooks/use-standalone-poll';
import { getPlayers } from '../../lib/api-client';
import { useGameSearch } from '../../hooks/use-game-search';
import { copyWithToast } from '../../lib/clipboard';

const mutateAsync = vi.fn();
const fakeGame = { id: 9001, name: 'Civ VI', slug: 'civ-vi', coverUrl: null } as unknown as IgdbGameDto;
const SHARE_URL = `${window.location.origin}/p/poll/tok_abc`;

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useCreateSchedulingPoll).mockReturnValue({
        mutateAsync, isPending: false, isError: false, error: null,
    } as unknown as ReturnType<typeof useCreateSchedulingPoll>);
    vi.mocked(getPlayers).mockResolvedValue({
        data: [], meta: { total: 0, page: 1, pageSize: 20, hasMore: false },
    } as unknown as Awaited<ReturnType<typeof getPlayers>>);
    vi.mocked(useGameSearch).mockReturnValue({
        data: { data: [fakeGame] }, isLoading: false, isError: false, error: null,
    } as unknown as ReturnType<typeof useGameSearch>);
});

async function pickGame(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByTestId('game-search-input'), 'Ci');
    await user.click(await screen.findByText(fakeGame.name));
}

function privateRadio(): HTMLElement {
    return screen.getByRole('radio', { name: /^Private — anyone with the link/ });
}

describe('CreatePollModal — private poll (ROK-1750)', () => {
    it('defaults "Who can see this poll?" to Community', () => {
        renderWithProviders(<CreatePollModal isOpen={true} onClose={vi.fn()} />);
        expect(screen.getByRole('radiogroup', { name: 'Who can see this poll?' })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: /^Community/ })).toBeChecked();
        expect(privateRadio()).not.toBeChecked();
    });

    it('Private sends visibility:"private", shows the share link and does not navigate', async () => {
        mutateAsync.mockResolvedValue({ id: 1, lineupId: 2, visibility: 'private', shareToken: 'tok_abc' });
        const user = userEvent.setup();
        renderWithProviders(<CreatePollModal isOpen={true} onClose={vi.fn()} />);
        await pickGame(user);
        await user.click(privateRadio());
        await user.click(screen.getByRole('button', { name: /create poll/i }));

        expect(mutateAsync.mock.calls[0]?.[0]).toMatchObject({ gameId: fakeGame.id, visibility: 'private' });
        expect(await screen.findByTestId('create-poll-success')).toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: 'Poll share link' })).toHaveValue(SHARE_URL);
        expect(navigate, 'a private poll must stay on the success state, not auto-navigate').not.toHaveBeenCalled();
    });

    it('the success state copies the link and Open poll navigates to the poll', async () => {
        mutateAsync.mockResolvedValue({ id: 1, lineupId: 2, visibility: 'private', shareToken: 'tok_abc' });
        const onClose = vi.fn();
        const user = userEvent.setup();
        renderWithProviders(<CreatePollModal isOpen={true} onClose={onClose} />);
        await pickGame(user);
        await user.click(privateRadio());
        await user.click(screen.getByRole('button', { name: /create poll/i }));
        await screen.findByTestId('create-poll-success');

        await user.click(screen.getByRole('button', { name: 'Copy link' }));
        expect(copyWithToast).toHaveBeenCalledWith(SHARE_URL, { success: 'Link copied', error: 'Failed to copy link' });

        await user.click(screen.getByRole('button', { name: 'Open poll' }));
        expect(navigate).toHaveBeenCalledWith('/community-lineup/2/schedule/1');
        expect(onClose).toHaveBeenCalled();
    });

    it('Community sends no visibility key and auto-navigates as before', async () => {
        mutateAsync.mockResolvedValue({ id: 1, lineupId: 2, visibility: 'public', shareToken: null });
        const user = userEvent.setup();
        renderWithProviders(<CreatePollModal isOpen={true} onClose={vi.fn()} />);
        await pickGame(user);
        await user.click(screen.getByRole('button', { name: /create poll/i }));

        expect(mutateAsync.mock.calls[0]?.[0]).not.toHaveProperty('visibility');
        expect(navigate).toHaveBeenCalledWith('/community-lineup/2/schedule/1');
        expect(screen.queryByTestId('create-poll-success')).toBeNull();
    });

    it('hideVisibility (R3, reschedule) hides the control and sends no visibility', async () => {
        mutateAsync.mockResolvedValue({ id: 1, lineupId: 2, visibility: 'public', shareToken: null });
        const user = userEvent.setup();
        renderWithProviders(<CreatePollModal isOpen={true} onClose={vi.fn()} hideVisibility />);
        expect(screen.queryByRole('radiogroup', { name: 'Who can see this poll?' })).toBeNull();
        await pickGame(user);
        await user.click(screen.getByRole('button', { name: /create poll/i }));
        expect(mutateAsync.mock.calls[0]?.[0]).not.toHaveProperty('visibility');
    });
});
