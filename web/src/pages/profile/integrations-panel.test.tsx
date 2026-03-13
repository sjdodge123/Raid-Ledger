/**
 * Tests for IntegrationsPanel (ROK-548).
 * Verifies Discord and Steam integration sections are rendered.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IntegrationsPanel } from './integrations-panel';

vi.mock('../../hooks/use-auth', () => ({
    useAuth: () => ({
        user: {
            id: 1,
            username: 'TestUser',
            discordId: '123',
            avatar: null,
            customAvatarUrl: null,
        },
        isAuthenticated: true,
        refetch: vi.fn(),
    }),
}));

vi.mock('../../hooks/use-system-status', () => ({
    useSystemStatus: () => ({
        data: { discordConfigured: true, steamConfigured: true },
    }),
}));

vi.mock('../../hooks/use-discord-link', () => ({
    useDiscordLink: () => vi.fn(),
}));

vi.mock('../../hooks/use-steam-link', () => ({
    useSteamLink: () => ({
        linkSteam: vi.fn(),
        steamStatus: { data: undefined },
        unlinkSteam: { mutate: vi.fn(), isPending: false },
        syncLibrary: { mutate: vi.fn(), isPending: false },
        syncWishlist: { mutate: vi.fn(), isPending: false },
    }),
}));

vi.mock('../../lib/avatar', () => ({
    isDiscordLinked: () => true,
    buildDiscordAvatarUrl: () => null,
}));

vi.mock('../../lib/toast', () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

function makeQueryClient() {
    return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderIntegrationsPanel() {
    return render(
        <QueryClientProvider client={makeQueryClient()}>
            <MemoryRouter>
                <IntegrationsPanel />
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

describe('IntegrationsPanel (ROK-548)', () => {
    it('renders the Integrations heading', () => {
        renderIntegrationsPanel();
        expect(screen.getByRole('heading', { name: /integrations/i })).toBeInTheDocument();
    });

    it('shows Discord section', () => {
        renderIntegrationsPanel();
        expect(screen.getByText(/discord/i)).toBeInTheDocument();
    });

    it('shows Steam section when configured', () => {
        renderIntegrationsPanel();
        expect(screen.getByRole('button', { name: /link steam account/i })).toBeInTheDocument();
    });
});
