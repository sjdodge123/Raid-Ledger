/** ROK-1893 P3 — `/events/new?guildId=` (a hub poll's lock-in) hands the hub to the form as its initial guild. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test/render-helpers';
import { CreateEventPage } from './create-event-page';

const registry = vi.hoisted(() => ({ games: [] as Array<{ id: number; name: string }> }));

vi.mock('../hooks/use-auth', () => ({ useAuth: () => ({ isAuthenticated: true, isLoading: false }) }));
vi.mock('../hooks/use-game-registry', () => ({ useGameRegistry: () => ({ games: registry.games, isLoading: false }) }));
vi.mock('../hooks/use-events', () => ({ useEvent: () => ({ data: undefined, isLoading: false, isError: false }) }));
vi.mock('../components/events/create-event-form', () => ({
    CreateEventForm: ({ initialGuildId }: { initialGuildId?: number | null }) => <div data-testid="form" data-guild={String(initialGuildId)} />,
}));

beforeEach(() => {
    registry.games = [];
});

describe('CreateEventPage — hub preselect (ROK-1893 P3)', () => {
    it('reads guildId into initialGuildId', () => {
        renderWithProviders(<CreateEventPage />, { initialEntries: ['/events/new?guildId=7'] });
        expect(screen.getByTestId('form')).toHaveAttribute('data-guild', '7');
    });
    it('ignores a missing or junk guildId', () => {
        renderWithProviders(<CreateEventPage />, { initialEntries: ['/events/new?guildId=abc'] });
        expect(screen.getByTestId('form')).toHaveAttribute('data-guild', 'null');
    });
});

describe('CreateEventPage — "Schedule for guild" deep link (ROK-1817)', () => {
    it('keeps the guild when gameId resolves to a game', () => {
        registry.games = [{ id: 3, name: 'World of Warcraft' }];
        renderWithProviders(<CreateEventPage />, { initialEntries: ['/events/new?gameId=3&guildId=7'] });
        expect(screen.getByTestId('form')).toHaveAttribute('data-guild', '7');
    });
    it('drops the guild when gameId resolves to no game (the Guild field could not show it)', () => {
        renderWithProviders(<CreateEventPage />, { initialEntries: ['/events/new?gameId=99&guildId=7'] });
        expect(screen.getByTestId('form'), 'an unseen guild tag must not ride along').toHaveAttribute('data-guild', 'null');
    });
    it('a poll lock-in keeps its hub even when the game does not resolve', () => {
        renderWithProviders(<CreateEventPage />, { initialEntries: ['/events/new?gameId=99&guildId=7&matchId=5'] });
        expect(screen.getByTestId('form')).toHaveAttribute('data-guild', '7');
    });
});
