/**
 * Link-error landings on the Integrations page (ROK-1366 AC14).
 *
 * A spent/expired link nonce 302s to `/profile/integrations?{linked|steam}=error&message=…`
 * — the page that owns account linking. Rendered under the real ProfileLayout
 * (which reads `linked=`) with a BrowserRouter, because the Steam hook reads
 * `window.location` directly. Each landing must toast the ruled copy once,
 * stay on the Integrations page and clear its params.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProfileLayout } from '../../components/profile/profile-layout';
import { IntegrationsPanel } from './integrations-panel';
import { toast } from '../../lib/toast';

const EXPIRED_COPY = 'Link request expired. Please try again.';

vi.mock('../../hooks/use-auth', () => ({
    useAuth: () => ({
        user: { id: 1, username: 'TestUser', discordId: '123', avatar: null, customAvatarUrl: null },
        isLoading: false,
        isAuthenticated: true,
        refetch: vi.fn(),
    }),
}));

vi.mock('../../hooks/use-system-status', () => ({
    useSystemStatus: () => ({ data: { discordConfigured: true, steamConfigured: true } }),
}));

vi.mock('../../hooks/use-discord-link', () => ({
    useDiscordLinkAction: () => ({ linkDiscord: vi.fn(), isPending: false }),
}));

vi.mock('../../hooks/use-steam-link', () => ({
    useSteamLink: () => ({
        linkSteam: vi.fn(),
        isLinkPending: false,
        steamStatus: { data: undefined },
        unlinkSteam: { mutate: vi.fn(), isPending: false },
        syncLibrary: { mutate: vi.fn(), isPending: false },
        syncWishlist: { mutate: vi.fn(), isPending: false },
    }),
}));

vi.mock('../../lib/avatar', () => ({ isDiscordLinked: () => true, buildDiscordAvatarUrl: () => null }));
vi.mock('../../components/profile/profile-sidebar', () => ({ ProfileSidebar: () => null }));
vi.mock('../../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

function renderAt(url: string) {
    window.history.replaceState({}, '', url);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <BrowserRouter>
                <Routes>
                    <Route path="/profile" element={<ProfileLayout />}>
                        <Route path="integrations" element={<IntegrationsPanel />} />
                    </Route>
                </Routes>
            </BrowserRouter>
        </QueryClientProvider>,
    );
}

describe('Integrations page — link-error landings (ROK-1366 AC14)', () => {
    beforeEach(() => vi.clearAllMocks());

    it.each([
        ['Discord', 'linked'],
        ['Steam', 'steam'],
    ])('%s: toasts the ruled copy once, stays on Integrations, clears the params', async (_p, flag) => {
        renderAt(`/profile/integrations?${flag}=error&message=${encodeURIComponent(EXPIRED_COPY)}`);

        await waitFor(() => expect(toast.error).toHaveBeenCalledWith(EXPIRED_COPY));
        expect(toast.error).toHaveBeenCalledTimes(1);
        expect(toast.success).not.toHaveBeenCalled();
        await waitFor(() => expect(window.location.search).toBe(''));
        expect(window.location.pathname).toBe('/profile/integrations');
        expect(screen.getByRole('heading', { name: 'Integrations' })).toBeInTheDocument();
    });
});
