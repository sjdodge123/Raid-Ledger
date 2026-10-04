/**
 * Link-success landings (ROK-1630).
 *
 * The Discord link callback used to 302 to `/profile?linked=success`. At the
 * exact path `/profile` ProfileLayout renders `<Navigate to="/profile/avatar">`
 * while the link-callback effect calls `setSearchParams({})` against the stale
 * `/profile` location in the same commit — the second navigation wins, the SPA
 * stays on `/profile` and renders nothing (blank page until F5). Success now
 * lands on `/profile/integrations?linked=success`; the legacy `/profile` URL is
 * still accepted for links already in flight.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProfileLayout } from '../../components/profile/profile-layout';
import { IntegrationsPanel } from './integrations-panel';
import { toast } from '../../lib/toast';

const refetch = vi.fn();

vi.mock('../../hooks/use-auth', () => ({
    useAuth: () => ({
        user: { id: 1, username: 'TestUser', discordId: '123', avatar: null, customAvatarUrl: null },
        isLoading: false,
        isAuthenticated: true,
        refetch,
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

async function renderAt(url: string) {
    window.history.replaceState({}, '', url);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={client}>
            <BrowserRouter>
                <Routes>
                    <Route path="/profile" element={<ProfileLayout />}>
                        <Route path="avatar" element={<div data-testid="avatar-panel" />} />
                        <Route path="integrations" element={<IntegrationsPanel />} />
                    </Route>
                </Routes>
            </BrowserRouter>
        </QueryClientProvider>,
    );
    await act(async () => {});
}

function expectIntegrationsRendered() {
    const where = `${window.location.pathname}${window.location.search}`;
    expect(
        screen.queryByRole('heading', { name: 'Integrations' }),
        `landed on ${where} with no Integrations panel rendered`,
    ).not.toBeNull();
    expect(window.location.pathname).toBe('/profile/integrations');
}

describe('Discord link-success landings (ROK-1630)', () => {
    beforeEach(() => vi.clearAllMocks());

    it.each([
        ['current', '/profile/integrations?linked=success'],
        ['legacy in-flight', '/profile?linked=success'],
    ])('%s URL renders Integrations, toasts once, refetches, clears the param', async (_k, url) => {
        await renderAt(url);

        expectIntegrationsRendered();
        await waitFor(() => expect(window.location.search).toBe(''));
        expect(toast.success).toHaveBeenCalledTimes(1);
        expect(toast.success).toHaveBeenCalledWith('Discord account linked successfully!');
        expect(toast.error).not.toHaveBeenCalled();
        expect(refetch).toHaveBeenCalledTimes(1);
        expectIntegrationsRendered();
    });
});

describe('Steam link-success landing at the default /profile returnTo (ROK-1630)', () => {
    beforeEach(() => vi.clearAllMocks());

    it('forwards to Integrations with the result instead of dropping it on Avatar', async () => {
        await renderAt('/profile?steam=success');

        expectIntegrationsRendered();
        expect(toast.success).toHaveBeenCalledTimes(1);
        expect(toast.success).toHaveBeenCalledWith('Steam account linked successfully!');
        expect(window.location.search).toBe('');
    });
});
