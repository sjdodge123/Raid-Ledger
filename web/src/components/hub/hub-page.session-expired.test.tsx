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
import { delay, http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import type { GuildPage as GuildPageDto } from '@raid-ledger/contract';
import { server } from '../../test/mocks/server';
import { createTestQueryClient, renderWithProviders } from '../../test/render-helpers';
import { dropViewerPrivateCaches } from '../../hooks/viewer-private-caches';
import { activateWowPlugin } from '../../test/activate-wow-plugin';
import { AUTH_METHOD_KEY, USER_CACHE_KEY } from '../../lib/api/auth-storage-keys';
import { clearAccessToken } from '../../lib/api/access-token-store';
import { createMockUser } from '../../test/factories';
import { AuthGuard } from '../auth/AuthGuard';
import { refetchUnauthorized } from '../../lib/api/resume-refresh';
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
/** Who made each refresh POST, and whether the stranded screen was up then. */
type RefreshPost = { origin: 'recheck' | 'useAuth' | 'request' | 'other'; stranded: boolean };
let posts: RefreshPost[] = [];

/**
 * Attribute a refresh POST from its async stack: the hub's session re-check
 * (`checkSession`), useAuth's `/auth/me` check, or a request's own pre-request
 * / 401-backstop refresh in `fetchWithAuth`.
 */
function recordPost(): void {
    const limit = Error.stackTraceLimit;
    Error.stackTraceLimit = 200;
    const stack = new Error().stack ?? '';
    Error.stackTraceLimit = limit;
    const origin = stack.includes('use-session-recheck') ? 'recheck'
        : stack.includes('fetchCurrentUser') ? 'useAuth'
            : stack.includes('fetch-api') ? 'request' : 'other';
    posts.push({ origin, stranded: document.querySelector('[data-testid="guild-session-expired"]') !== null });
}
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
            recordPost();
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

/** The app's route shape: `/hubs/:id` sits under AuthGuard (app-routes.tsx). */
function renderGuardedPage(queryClient: ReturnType<typeof createTestQueryClient>) {
    return renderWithProviders(
        <Routes>
            <Route element={<AuthGuard />}>
                <Route path="/hubs/:id" element={<GuildPage />} />
            </Route>
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

beforeEach(() => { activateWowPlugin(); clearAccessToken(); refreshCalls = 0; posts = []; postsAfterHub401 = null; sessionLive = false; localStorage.clear(); sessionStorage.clear(); });
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
        // Settled `/auth/me` keeps useAuth's own check (which would drop the
        // caches and leave the page on its skeleton) out of this page-level test.
        const queryClient = createTestQueryClient();
        queryClient.setQueryData(['auth', 'me'], null);
        renderPage(queryClient);
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

});

describe('GuildPage — session drops and recovery (ROK-1947)', () => {
    it('a pending+idle hub query (a cache drop or an impersonation hand-off) shows the skeleton, never the expired prompt', async () => {
        localStorage.setItem(AUTH_METHOD_KEY, 'discord');
        serve(503);
        let hubRequested = false;
        let release: () => void = () => undefined;
        server.use(http.get(`${API}/guilds/7`, async () => {
            hubRequested = true;
            await new Promise<void>((resolve) => { release = resolve; });
            return HttpResponse.json({ message: 'gone' }, { status: 500 });
        }));
        const queryClient = createTestQueryClient();
        // Keep useAuth's own `/auth/me` check out of the count.
        queryClient.setQueryData(['auth', 'me'], null);
        renderPage(queryClient);
        await waitFor(() => expect(hubRequested, 'the hub request must be in flight').toBe(true));
        // A drop of the viewer's caches (useAuth's rejected refresh, or
        // cross-tab-auth's followIdentityChange before it re-mints the token)
        // resets the observed page query and leaves it idle.
        act(() => dropViewerPrivateCaches(queryClient));
        expect(screen.queryByTestId('guild-session-expired'), 'a pending+idle query is not a rejected session: Sign in there would revoke a live hand-off').toBeNull();
        expect(screen.getByTestId('guild-loading'), 'a pending+idle hub query shows the skeleton').toBeInTheDocument();
        release();
        await waitFor(() => expect(queryClient.isFetching()).toBe(0));
        expect(screen.queryByTestId('guild-session-expired'), 'the stranded request settling must not raise the prompt either').toBeNull();
        expect(posts.map((p) => p.origin), 'a pending+idle page never re-checks the session').not.toContain('recheck');
    });

    it('under AuthGuard, a rejected useAuth refresh on the hub lands on the login screen with the hub saved', async () => {
        localStorage.setItem(AUTH_METHOD_KEY, 'local');
        serve(200);
        const queryClient = createTestQueryClient();
        queryClient.setQueryData(['auth', 'me'], createMockUser({ onboardingCompletedAt: '2026-01-01T00:00:00.000Z' }));
        renderGuardedPage(queryClient);
        expect(await screen.findByTestId('guild-hero'), 'a live session shows the hub').toBeInTheDocument();
        await waitFor(() => expect(queryClient.isFetching()).toBe(0));
        // The token lapses and the refresh cookie is gone: useAuth's next check is REJECTED.
        refreshStatuses = [401];
        sessionLive = false;
        clearAccessToken();
        const before = refreshCalls;
        await act(() => queryClient.invalidateQueries({ queryKey: ['auth', 'me'] }));
        expect(await screen.findByTestId('login-screen'), 'the guard sends the signed-out viewer to the login screen').toBeInTheDocument();
        expect(sessionStorage.getItem('authRedirect'), 'the hub stays the post-sign-in destination').toBe('/hubs/7');
        await waitFor(() => expect(queryClient.isFetching()).toBe(0));
        const after = posts.slice(before);
        expect(after.filter((p) => p.origin === 'useAuth'), 'useAuth decides the session with exactly one refresh').toHaveLength(1);
        expect(after.map((p) => p.origin), 'the hub page never re-checks a session useAuth already rejected').not.toContain('recheck');
        // The viewer-keyed hub query refetches under 'anon' before the guard
        // redirects (its own pre-request + 401-backstop POSTs); the stranded
        // screen itself must add none.
        expect(after.filter((p) => p.stranded), 'no refresh POST while the stranded Sign in screen is up').toEqual([]);
        expect(after.map((p) => p.origin), 'every POST is useAuth or a request backstop').not.toContain('other');
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

describe('GuildPage — recovery that still 401s (ROK-1947)', () => {
    it('a refresh that lands but a hub GET that still 401s settles on Sign in after ONE re-check, with no loop', async () => {
        localStorage.setItem(AUTH_METHOD_KEY, 'discord');
        serve(200);
        // An uncached hub whose refreshed GET still 401s, with real network
        // latency so the refetch's own "fetching" frame renders.
        server.use(http.get(`${API}/guilds/7`, async () => {
            await delay(20);
            return HttpResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }));
        const queryClient = createTestQueryClient();
        renderPage(queryClient);
        const rechecks = () => posts.filter((p) => p.origin === 'recheck').length;
        await waitFor(() => expect(screen.queryByTestId('guild-session-expired') !== null || rechecks() > 1, 'the re-check must settle or repeat').toBe(true));
        expect(rechecks(), 'one 401 -> one re-check refresh; a still-401 refetch must not start another').toBe(1);
        expect(screen.getByTestId('guild-session-expired'), 'a refetch that still 401s means the session is rejected').toHaveTextContent(EXPIRED);
        await waitFor(() => expect(queryClient.isFetching()).toBe(0));
        expect(rechecks(), 'Sign in is final: no further re-check once the refetch settled').toBe(1);
        expect(screen.getByTestId('guild-session-expired'), 'Sign in stays up').toBeInTheDocument();
    });

    it('a resume refresh that refetches the hub into another 401 keeps the one Sign in, with no second re-check', async () => {
        localStorage.setItem(AUTH_METHOD_KEY, 'discord');
        serve(200);
        server.use(http.get(`${API}/guilds/7`, async () => {
            await delay(20);
            return HttpResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }));
        const queryClient = createTestQueryClient();
        renderPage(queryClient);
        const rechecks = () => posts.filter((p) => p.origin === 'recheck').length;
        await waitFor(() => expect(rechecks() === 1 && queryClient.isFetching() === 0, 'the one re-check and its refetch settle').toBe(true));
        const ids = recordTestIds();
        // The recovery's own still-401 refetch bumped errorUpdatedAt; a resume refresh refetches again, still 401.
        await act(() => refetchUnauthorized(queryClient));
        await waitFor(() => expect(queryClient.isFetching()).toBe(0));
        ids.stop();
        expect(rechecks(), 'a still-401 resume refetch must not remount the re-check').toBe(1);
        expect(ids.seen.has('guild-session-expired'), 'Sign in must not unmount and remount').toBe(false);
        expect(screen.getByTestId('guild-session-expired'), 'Sign in stays up').toHaveTextContent(EXPIRED);
    });

    it('a later refresh that refetches the 401 hub successfully replaces the stale Sign in with the hub', async () => {
        localStorage.setItem(AUTH_METHOD_KEY, 'discord');
        serve(200);
        server.use(http.get(`${API}/guilds/7`, async () => {
            await delay(20);
            return HttpResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }));
        const queryClient = createTestQueryClient();
        renderPage(queryClient);
        const rechecks = () => posts.filter((p) => p.origin === 'recheck').length;
        await waitFor(() => expect(rechecks() === 1 && queryClient.isFetching() === 0, 'the one re-check and its refetch settle').toBe(true));
        expect(screen.getByTestId('guild-session-expired'), 'the still-401 recovery lands on Sign in').toHaveTextContent(EXPIRED);
        // A resume refresh succeeds later and refetches the 401'd hub on its own (resume-refresh.ts).
        server.use(http.get(`${API}/guilds/7`, () => HttpResponse.json(PAGE)));
        await act(() => refetchUnauthorized(queryClient));
        await waitFor(() => expect(screen.queryByTestId('guild-session-expired'), 'an independent recovery must clear the Sign in latch').toBeNull());
        expect(await screen.findByTestId('guild-hero'), 'the recovered hub shows').toBeInTheDocument();
    });
});

describe('GuildPage — a newer error releases the recovery latch (ROK-1947)', () => {
    it('a later refetch that answers 403 replaces the stale Sign in with the not-a-member notice', async () => {
        localStorage.setItem(AUTH_METHOD_KEY, 'discord');
        serve(200);
        server.use(http.get(`${API}/guilds/7`, async () => {
            await delay(20);
            return HttpResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }));
        const queryClient = createTestQueryClient();
        renderPage(queryClient);
        const rechecks = () => posts.filter((p) => p.origin === 'recheck').length;
        await waitFor(() => expect(rechecks() === 1 && queryClient.isFetching() === 0, 'the one re-check and its refetch settle').toBe(true));
        expect(screen.getByTestId('guild-session-expired'), 'the still-401 recovery lands on Sign in').toHaveTextContent(EXPIRED);
        // Another refetch path (a resume refresh) refetches the hub, which now answers 403.
        server.use(http.get(`${API}/guilds/7`, () => HttpResponse.json({ message: 'Forbidden' }, { status: 403 })));
        await act(() => refetchUnauthorized(queryClient));
        await waitFor(() => expect(screen.queryByTestId('guild-session-expired'), 'a newer 403 must release the Sign in latch').toBeNull());
        expect(screen.getByTestId('guild-not-member'), 'the 403 shows the not-a-member notice').toBeInTheDocument();
    });
});
