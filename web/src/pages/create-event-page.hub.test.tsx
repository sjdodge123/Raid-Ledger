/** ROK-1893 P3 — `/events/new?guildId=` (a hub poll's lock-in) hands the hub to the form as its initial guild. */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test/render-helpers';
import { CreateEventPage } from './create-event-page';

vi.mock('../hooks/use-auth', () => ({ useAuth: () => ({ isAuthenticated: true, isLoading: false }) }));
vi.mock('../hooks/use-game-registry', () => ({ useGameRegistry: () => ({ games: [], isLoading: false }) }));
vi.mock('../hooks/use-events', () => ({ useEvent: () => ({ data: undefined, isLoading: false, isError: false }) }));
vi.mock('../components/events/create-event-form', () => ({
    CreateEventForm: ({ initialGuildId }: { initialGuildId?: number | null }) => <div data-testid="form" data-guild={String(initialGuildId)} />,
}));

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
