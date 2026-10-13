/**
 * ROK-1780 — My Integrations renders the whole Calendars page inline below
 * Discord and Steam while the Calendar Sync kill switch is on, hides it while
 * it is off, and the OAuth callback's `?connected=google` still toasts here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { CalendarsOverview } from '@raid-ledger/contract';
import { server } from '../../test/mocks/server';
import { createTestQueryClient } from '../../test/render-helpers';
import { calendarsOverviewVariants, userCalendarHandlers } from '../../test/mocks/calendar-sync-handlers';
import { CALENDARS_OVERVIEW_KEY } from '../../hooks/use-calendar-sync';
import { setAccessToken, clearAccessToken } from '../../lib/api/access-token-store';
import { CALENDARS_COPY as C } from '../../components/features/calendar-sync/calendar-sync.copy';
import { IntegrationsPanel } from './integrations-panel';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../hooks/use-auth')>()),
    useAuth: () => ({
        user: { id: 1, username: 'TestUser', discordId: '123', avatar: null, customAvatarUrl: null },
        isAuthenticated: true, refetch: vi.fn(),
    }),
}));
vi.mock('../../hooks/use-system-status', () => ({
    useSystemStatus: () => ({ data: { discordConfigured: true, steamConfigured: false } }),
}));
vi.mock('../../hooks/use-discord-link', () => ({
    useDiscordLinkAction: () => ({ linkDiscord: vi.fn(), isPending: false }),
}));
vi.mock('../../hooks/use-steam-link', () => ({
    useSteamLink: () => ({
        linkSteam: vi.fn(), isLinkPending: false, steamStatus: { data: undefined },
        unlinkSteam: { mutate: vi.fn(), isPending: false },
        syncLibrary: { mutate: vi.fn(), isPending: false },
        syncWishlist: { mutate: vi.fn(), isPending: false },
    }),
}));

function renderPanel(overview: CalendarsOverview, url = '/profile/integrations'): QueryClient {
    server.use(...userCalendarHandlers(overview));
    const client = createTestQueryClient();
    render(
        <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={[url]}><IntegrationsPanel /></MemoryRouter>
        </QueryClientProvider>,
    );
    return client;
}

beforeEach(() => setAccessToken('test-token'));
afterEach(() => { clearAccessToken(); vi.clearAllMocks(); });

describe('IntegrationsPanel — inline Calendars section (ROK-1780)', () => {
    it('renders the Calendars page below the Integrations card when Calendar Sync is enabled', async () => {
        renderPanel(calendarsOverviewVariants.connected);
        const calendars = await screen.findByTestId('calendars-page');
        expect(calendars).toContainElement(await screen.findByTestId('calendar-connection-card'));
        const integrations = screen.getByRole('heading', { level: 2, name: 'Integrations' });
        const calendarsHeading = screen.getByRole('heading', { level: 2, name: C.title });
        expect(integrations.compareDocumentPosition(calendarsHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('hides the Calendars section while the kill switch is off', async () => {
        const client = renderPanel(calendarsOverviewVariants.disabled);
        await waitFor(() => expect(client.getQueryState([...CALENDARS_OVERVIEW_KEY])?.status).toBe('success'));
        expect(screen.getByRole('heading', { level: 2, name: 'Integrations' })).toBeInTheDocument();
        expect(screen.queryByTestId('calendars-page')).toBeNull();
        expect(screen.queryByTestId('calendars-unavailable')).toBeNull();
        expect(screen.queryByRole('heading', { name: C.title })).toBeNull();
    });

    it('the OAuth callback landing (?connected=google) toasts success on My Integrations', async () => {
        renderPanel(calendarsOverviewVariants.connected, '/profile/integrations?connected=google');
        await waitFor(() => expect(toast.success).toHaveBeenCalledWith(C.toastConnected, expect.anything()));
    });
});
