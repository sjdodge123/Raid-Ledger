/**
 * ROK-1797 — the muted-games list under "Subscribed Games": each game links
 * to its page, Unmute sends DELETE and the refetched list drops the game, and
 * an empty list shows a one-line empty state.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { GameNotificationMuteItemDto } from '@raid-ledger/contract';
import { server } from '../../test/mocks/server';
import { renderWithProviders } from '../../test/render-helpers';
import { setAccessToken } from '../../lib/api/access-token-store';
import { MutedGamesList } from './muted-games-list';

const API = 'http://localhost:3000';

function game(gameId: number, name: string): GameNotificationMuteItemDto {
    return { gameId, name, slug: name.toLowerCase(), coverUrl: null, mutedAt: '2026-10-01T00:00:00.000Z' };
}

/** List reflects the server's mutes; DELETE removes the game. */
function seed(initial: GameNotificationMuteItemDto[]): string[] {
    const deletes: string[] = [];
    let mutes = [...initial];
    server.use(
        http.get(`${API}/notifications/game-mutes`, () => HttpResponse.json({ data: mutes })),
        http.delete(`${API}/games/:id/notification-mute`, ({ params }) => {
            const id = String(params.id);
            deletes.push(id);
            mutes = mutes.filter((m) => String(m.gameId) !== id);
            return HttpResponse.json({ gameId: Number(id), muted: false });
        }),
    );
    return deletes;
}

beforeEach(() => setAccessToken('test-token'));

describe('MutedGamesList', () => {
    it('lists each muted game as a link to its page', async () => {
        seed([game(7, 'Valheim'), game(9, 'Palworld')]);
        renderWithProviders(<MutedGamesList />);
        expect(await screen.findByRole('link', { name: 'Valheim' })).toHaveAttribute('href', '/games/7');
        expect(screen.getByRole('link', { name: 'Palworld' })).toHaveAttribute('href', '/games/9');
        expect(screen.getByTestId('muted-games-list')).toBeInTheDocument();
    });

    it('Unmute sends DELETE for that game and the refetched list drops it', async () => {
        const deletes = seed([game(7, 'Valheim'), game(9, 'Palworld')]);
        const user = userEvent.setup();
        renderWithProviders(<MutedGamesList />);
        await user.click(await screen.findByRole('button', { name: 'Unmute Valheim' }));
        await waitFor(() => expect(screen.queryByRole('link', { name: 'Valheim' })).not.toBeInTheDocument());
        expect(deletes).toEqual(['7']);
        expect(screen.getByRole('link', { name: 'Palworld' })).toBeInTheDocument();
    });

    it('shows a one-line empty state when nothing is muted', async () => {
        seed([]);
        renderWithProviders(<MutedGamesList />);
        expect(await screen.findByText(/No muted games/)).toBeInTheDocument();
        expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
    });
});
