/**
 * ROK-1947: a hub GET whose 401 survives the transparent refresh re-checks the
 * session before saying anything. Only a REJECTED refresh (or no session
 * marker at all) offers "Sign in", which ends the session, keeps this hub as
 * the post-sign-in destination and goes to `/`. An indeterminate refresh (a
 * phone waking into a 503) keeps the viewer signed in and offers "Try again";
 * a refresh that lands refetches the hub and shows it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import type { GuildPage as GuildPageDto } from '@raid-ledger/contract';
import { server } from '../../test/mocks/server';
import { createTestQueryClient, renderWithProviders } from '../../test/render-helpers';
import { dropViewerPrivateCaches } from '../../hooks/viewer-private-caches';
import { activateWowPlugin } from '../../test/activate-wow-plugin';
import { AUTH_METHOD_KEY, USER_CACHE_KEY } from '../../lib/api/auth-storage-keys';
import { GuildPage } from './hub-page';

const API = 'http://localhost:3000';
const EXPIRED = 'Your session expired. Sign in again to see this hub.';
const UNREACHABLE = "We couldn't reach the server. Try again.";
const PAGE: GuildPageDto = {
    guild: { id: 7, gameId: 1, kind: 'wow_guild', name: 'Iron Vanguard', region: 'us', realmSlug: null, realmName: 'Doomhowl', faction: 'Horde', memberCount: 0, lastSnapshotAt: null },
    importedBy: null,
    viewer: { role: 'member', canEdit: false, canManageEditors: false },
    ranks: [],
    roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
};

let refreshCalls = 0;
/**
 * Refresh answers, indexed by POSTs made AFTER the hub GET first 401'd (the
 * request's own 401 backstop is index 0, the page's re-check index 1); POSTs
 * before that answer index 0, and the last entry repeats. A 200 also lets the
 * hub GET succeed.
 */
let refreshStatuses: number[] = [];
let postsAfterHub401: number | null = null;
let sessionLive = false;

function serve(...statuses: number[]): void {
    refreshStatuses = statuses;
    server.use(
        http.get(`${API}/guilds/7`, () => {
            if (sessionLive) return HttpResponse.json(PAGE);
            postsAfterHub401 ??= 0;
            return HttpResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }),
        http.post(`${API}/auth/refresh`, () => {
            const index = postsAfterHub401 ?? 0;
            if (postsAfterHub401 !== null) postsAfterHub401 += 1;
            const status = refreshStatuses[Math.min(index, refreshStatuses.length - 1)] ?? 503;
            refreshCalls += 1;
            if (status !== 200) return HttpResponse.json({ message: 'no' }, { status });
            sessionLive = true;
            return HttpResponse.json({ access_token: 'renewed-token' });
        }),
    );
}

function renderPage(queryClient = createTestQueryClient()) {
    return renderWithProviders(
        <Routes>
            <Route path="/hubs/:id" element={<GuildPage />} />
            <Route path="/" element={<p data-testid="login-screen">login</p>} />
        </Routes>,
        { initialEntries: ['/hubs/7'], queryClient },
    );
}

/** Every `data-testid` the page ever inserted, so a one-frame flash is caught. */
function recordTestIds(): { seen: Set<string>; stop: () => void } {
    const seen = new Set<string>();
    const observer = new MutationObserver((records) => {
        for (const node of records.flatMap((r) => [...r.addedNodes])) {
            if (node instanceof HTMLElement && node.dataset.testid) seen.add(node.dataset.testid);
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return { seen, stop: () => observer.disconnect() };
}

beforeEach(() => { activateWowPlugin(); refreshCalls = 0; postsAfterHub401 = null; sessionLive = false; localStorage.clear(); sessionStorage.clear(); });
afterEach(() => { localStorage.clear(); sessionStorage.clear(); });

describe('GuildPage — expired session (ROK-1947)', () => {
    it('a 401 with no session marker shows the sign-in prompt, not the generic error', async () => {
        serve(503);
        renderPage();
        const prompt = await screen.findByTestId('guild-session-expired');
        expect(prompt, 'a 401 must explain the session expired').toHaveTextContent(EXPIRED);
        expect(screen.queryByTestId('guild-error'), 'the generic retry box must not show for a 401').toBeNull();
    });

    it('a REJECTED re-check offers Sign in: ends the session, saves the hub and goes to /', async () => {
        localStorage.setItem(AUTH_METHOD_KEY, 'discord');
        localStorage.setItem(USER_CACHE_KEY, JSON.stringify({ id: 1 }));
        serve(401);
        renderPage();
        expect(await screen.findByTestId('guild-session-expired')).toHaveTextContent(EXPIRED);
        expect(refreshCalls, 'the refresh must have been tried first').toBeGreaterThan(0);
        await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
        expect(sessionStorage.getItem('authRedirect'), 'sign-in must return the viewer to this hub').toBe('/hubs/7');
        expect(localStorage.getItem(USER_CACHE_KEY), 'sign-in clears the cached user').toBeNull();
        expect(await screen.findByTestId('login-screen'), 'sign-in goes to the login screen').toBeInTheDocument();
    });

    it('an INDETERMINATE re-check keeps the viewer signed in and offers Try again, which recovers the hub', async () => {
        localStorage.setItem(AUTH_METHOD_KEY, 'discord');
        serve(503);
        renderPage();
        expect(await screen.findByTestId('guild-session-unreachable')).toHaveTextContent(UNREACHABLE);
        expect(screen.queryByTestId('guild-session-expired'), 'a blip is not an expired session').toBeNull();
        expect(localStorage.getItem(AUTH_METHOD_KEY), 'a blip must not sign the viewer out').toBe('discord');
        refreshStatuses = [200];
        postsAfterHub401 = 0;
        await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(await screen.findByTestId('guild-hero'), 'Try again re-runs the check and shows the hub').toBeInTheDocument();
    });

    it('a session drop that resets the hub query (a rejected useAuth refresh) still offers Sign in', async () => {
        serve(503);
        const queryClient = createTestQueryClient();
        renderPage(queryClient);
        expect(await screen.findByTestId('guild-session-expired')).toHaveTextContent(EXPIRED);
        // What useAuth's handleRefreshFailure does: reset the observed page query, no token to refetch it.
        act(() => dropViewerPrivateCaches(queryClient));
        await waitFor(() => {
            expect(screen.queryByTestId('guild-session-expired'), 'a reset, idle hub query must offer Sign in, not an endless skeleton').not.toBeNull();
        }, { timeout: 3000 });
    });

    it('an OK re-check refetches the hub and shows it, with no prompt', async () => {
        localStorage.setItem(AUTH_METHOD_KEY, 'discord');
        // The request's own 401 backstop refresh blips (503); the re-check's refresh lands.
        serve(503, 200);
        const ids = recordTestIds();
        renderPage();
        expect(await screen.findByTestId('guild-hero'), 'a refresh that lands must show the hub').toBeInTheDocument();
        ids.stop();
        expect([...ids.seen], 'a recovered re-check must never flash "session expired"').not.toContain('guild-session-expired');
        expect(localStorage.getItem(AUTH_METHOD_KEY), 'the viewer stays signed in').toBe('discord');
    });
});
