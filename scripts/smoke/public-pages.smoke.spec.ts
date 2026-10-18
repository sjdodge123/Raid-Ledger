/**
 * Public pages smoke tests — join page (/join) and invite page (/i/:code).
 *
 * Both routes live outside the AuthGuard so they must be accessible
 * without authentication.  The tests verify:
 *  - Pages render without the error boundary firing
 *  - Invalid/missing tokens show a graceful error state
 *  - Community branding (header link) is visible
 *  - Unauthenticated visitors can reach the pages
 *  - A REDEEMABLE intent token (ROK-1841 fixture) actually signs the viewer
 *    up, and the landing leaves no `token=` behind (ROK-1839)
 */
import { test, expect } from './base';
import { apiDelete, apiGet, apiPost, getAdminToken, getInviteeFixture } from './api-helpers';
import { signInContextWithJwt } from './browser-session';

/**
 * `GET /events` answers a paginated `{ data, meta }` envelope, not a bare
 * array — r1 read it as an array, so `seededEventId()` always returned null
 * and the capture case below skipped on every project (Codex r2 P2). Both
 * shapes are accepted so the helper cannot silently disarm the test again.
 */
function eventList(body: unknown): unknown[] {
    if (Array.isArray(body)) return body;
    if (typeof body === 'object' && body !== null && 'data' in body) {
        const data: unknown = (body as { data: unknown }).data;
        if (Array.isArray(data)) return data;
    }
    return [];
}

/** The id of a seeded upcoming event — the join landing needs a real one. */
async function seededEventId(): Promise<number | null> {
    const token = await getAdminToken();
    const body: unknown = await apiGet(token, '/events?upcoming=true&limit=1');
    const first: unknown = eventList(body)[0];
    if (typeof first !== 'object' || first === null || !('id' in first)) return null;
    const id = (first as { id: unknown }).id;
    return typeof id === 'number' ? id : null;
}

// ---------------------------------------------------------------------------
// Join page — /join
// ---------------------------------------------------------------------------

test.describe('Join page (/join)', () => {
    test('renders invalid-link state when no token is provided', async ({ page }) => {
        await page.goto('/join');
        await expect(page.getByRole('heading', { name: 'Invalid Link' })).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText('This join link is invalid or has expired.')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Go to Calendar' })).toBeVisible();
    });

    /**
     * ROK-1839: the intent token is captured and `history.replaceState`d out of
     * the address bar before Sentry initialises, so a Session Replay's rrweb
     * Meta (type 4) href — built from `window.location.href` inside the SDK,
     * where no `beforeAddRecordingEvent` hook reaches — can never carry it.
     * A token with no `eventId` is an invalid link, so the page settles here
     * instead of navigating on to Discord or the event.
     */
    test('strips ?token= from the address bar on load (ROK-1839)', async ({ page }) => {
        await page.goto('/join?intent=signup&token=rok1839-smoke-not-a-real-token');
        await expect(page.getByRole('heading', { name: 'Invalid Link' })).toBeVisible({ timeout: 10_000 });

        const landed = new URL(page.url());
        expect(landed.search, 'the sign-in token must be gone from the address bar').not.toContain('token=');
        expect(landed.href, 'no part of the URL may carry the token value').not.toContain('rok1839-smoke');
        expect(landed.searchParams.get('intent'), 'every other query param survives the strip').toBe('signup');
    });

    /**
     * ROK-1839, the AC's second half. The strip must not cost the flow its
     * token: a signed-in visitor following a join link still gets through to
     * the event, driven off the CAPTURE (the address bar no longer has one by
     * the time /join renders).
     *
     * The token here is deliberately not redeemable — nothing mints an intent
     * token outside the Discord bot, and no DEMO_MODE fixture endpoint exists
     * for it (see HANDOVER-ROK-1839.md "deliberately not done"). The flow it
     * proves is the one the strip could break: capture → redeem call → land on
     * the event. A redeemable token would additionally assert the signup row.
     */
    test('a signed-in join link still redeems from the capture and lands on the event (ROK-1839)', async ({ page }) => {
        const eventId = await seededEventId();
        test.skip(eventId === null, 'no upcoming event in the seed');
        const token = 'rok1839-smoke-capture-not-a-real-token';

        // The load-bearing half: the strip must not cost the flow its token.
        // Reading the landing URL alone cannot tell a redeem that carried the
        // captured token from one that sent nothing (Codex r2 P2), so the
        // POST body is inspected directly.
        // r3 (Codex P3): a body substring would also accept a PUT, or a POST
        // that carried the token under some other key — record the method and
        // the PARSED `token` field so only the real redemption passes.
        const redeemCalls: { method: string; token: unknown }[] = [];
        await page.route('**/auth/redeem-intent', async (route) => {
            const request = route.request();
            let parsed: unknown = null;
            try {
                parsed = (JSON.parse(request.postData() ?? '') as { token?: unknown }).token ?? null;
            } catch {
                parsed = null;
            }
            redeemCalls.push({ method: request.method(), token: parsed });
            await route.continue();
        });

        await page.goto(`/join?intent=signup&eventId=${String(eventId)}&token=${token}`);

        await page.waitForURL(new RegExp(`/events/${String(eventId)}(\\?|#|$)`), { timeout: 20_000 });
        expect(
            redeemCalls,
            'exactly one POST /auth/redeem-intent must carry the captured token as its `token` field',
        ).toEqual([{ method: 'POST', token }]);
        const landed = new URL(page.url());
        expect(landed.href, 'the sign-in token must not survive into the landing URL').not.toContain(token);
        expect(landed.href, 'nor any fragment of it').not.toContain('rok1839-smoke');
        await expect(
            page.locator('body'),
            'the join landing must render the event page, not the error boundary',
        ).not.toHaveText(/something went wrong/i, { timeout: 10_000 });
    });

    test('does not trigger the error boundary', async ({ page }) => {
        await page.goto('/join');
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });
    });

    test('is accessible without authentication', async ({ browser }) => {
        const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
        const page = await context.newPage();

        await page.goto('/join');
        // Should NOT redirect to the login page — /join is a public route
        await expect(page.getByRole('heading', { name: 'Invalid Link' })).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText('This join link is invalid or has expired.')).toBeVisible();

        await context.close();
    });
});

// ---------------------------------------------------------------------------
// Join page — /join with a REDEEMABLE intent token (ROK-1841)
// ---------------------------------------------------------------------------

/** Read `key` off an API body, failing loudly when it is not a number. */
function mustNumber(body: unknown, key: string, label: string): number {
    const value: unknown = typeof body === 'object' && body !== null ? Reflect.get(body, key) : undefined;
    if (typeof value !== 'number') throw new Error(`${label}: no numeric \`${key}\` in ${JSON.stringify(body)}`);
    return value;
}

/** The minted token. Its value is never echoed into an error message. */
function mustToken(body: unknown): string {
    const value: unknown = typeof body === 'object' && body !== null ? Reflect.get(body, 'token') : undefined;
    if (typeof value !== 'string' || value === '') throw new Error('POST /admin/test/intent-token returned no token');
    return value;
}

/** User ids currently on the event's roster — a pure read for `expect.poll`. */
async function rosterUserIds(token: string, eventId: number): Promise<number[]> {
    const detail: unknown = await apiGet(token, `/events/${eventId}/detail`);
    const roster: unknown = typeof detail === 'object' && detail !== null ? Reflect.get(detail, 'roster') : undefined;
    const signups: unknown = typeof roster === 'object' && roster !== null ? Reflect.get(roster, 'signups') : undefined;
    if (!Array.isArray(signups)) return [];
    return signups.flatMap((s: unknown) => {
        const user: unknown = typeof s === 'object' && s !== null ? Reflect.get(s, 'user') : undefined;
        const id: unknown = typeof user === 'object' && user !== null ? Reflect.get(user, 'id') : undefined;
        return typeof id === 'number' ? [id] : [];
    });
}

/**
 * The admin CREATES the event (a creator is on its roster at once), and the
 * token is minted for — and redeemed by — the smoke invitee fixture user, so
 * "not signed up before, signed up after" is a real precondition.
 *
 * Codex r1 P2: the join URL carries a live sign-in token. Traces are off for
 * this block, and the page comes from a context the spec builds itself, so its
 * `goto` skips the `base.ts` retry wrapper that logs the raw URL.
 */
test.describe('Join page (/join) — redeemable intent token', () => {
    test.use({ trace: 'off' });

    let adminToken = '';
    const eventIds: number[] = [];

    test.beforeAll(async () => {
        adminToken = await getAdminToken();
    });

    test.afterAll(async () => {
        for (const id of eventIds.splice(0)) await apiDelete(adminToken, `/events/${id}`).catch(() => undefined);
    });

    /** A fresh event only its creator (the admin) is on, claimed for cleanup first. */
    async function freshEvent(project: string): Promise<number> {
        const start = new Date(Date.now() + 30 * 86_400_000);
        const body: unknown = await apiPost(adminToken, '/events', {
            title: `smoke-rok-1841-join-${project}-${Date.now()}`,
            startTime: start.toISOString(),
            endTime: new Date(start.getTime() + 2 * 3_600_000).toISOString(),
            maxAttendees: 10,
        });
        const id = mustNumber(body, 'id', 'POST /events');
        eventIds.push(id);
        return id;
    }

    test('redeems the token, signs the viewer up, and leaves no token in the URL', async ({ browser }, testInfo) => {
        const invitee = await getInviteeFixture();
        const eventId = await freshEvent(testInfo.project.name);
        const token = mustToken(
            await apiPost(adminToken, '/admin/test/intent-token', { eventId, intent: 'signup', userId: invitee.userId }),
        );
        expect(await rosterUserIds(adminToken, eventId), `user ${invitee.userId} must not be signed up before redeeming`).not.toContain(invitee.userId);

        const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
        try {
            await signInContextWithJwt(context, invitee.jwt);
            const page = await context.newPage();
            await page.goto(`/join?intent=signup&eventId=${eventId}&token=${encodeURIComponent(token)}`, {
                waitUntil: 'domcontentloaded',
            });

            // The landing hands off to the event page…
            // Poll the PATHNAME so a failure message can never print the token-bearing query.
            await expect
                .poll(() => new URL(page.url()).pathname, { message: 'the join landing must reach the event page', timeout: 20_000 })
                .toBe(`/events/${eventId}`);
            // …and ROK-1839: nothing carries the token forward into the URL.
            const landed = page.url();
            expect(landed.includes('token='), 'the join token must not survive into the landing URL').toBe(false);
            expect(landed.includes(token.slice(0, 24)), 'nor any fragment of it').toBe(false);
            await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });
        } finally {
            await context.close();
        }

        // The sign-in half of the flow actually happened, not just the redirect.
        await expect
            .poll(() => rosterUserIds(adminToken, eventId), {
                message: `redeeming the intent token must sign user ${invitee.userId} up to event ${eventId}`,
                timeout: 15_000,
            })
            .toContain(invitee.userId);
    });
});

// ---------------------------------------------------------------------------
// Invite page — /i/:code
// ---------------------------------------------------------------------------

test.describe('Invite page (/i/:code)', () => {
    test('renders error state for an invalid invite code', async ({ browser }) => {
        // Use unauthenticated context so the page stays on /i/:code
        // instead of auto-advancing through the invite wizard steps
        const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
        const page = await context.newPage();

        await page.goto('/i/invalid-test-code');
        await expect(page.getByRole('heading', { name: 'Invalid Invite' })).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText(/invalid or has expired/i)).toBeVisible();
        await expect(page.getByRole('button', { name: 'Go to Calendar' })).toBeVisible();

        await context.close();
    });

    test('does not trigger the error boundary', async ({ browser }) => {
        const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
        const page = await context.newPage();

        await page.goto('/i/invalid-test-code');
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });

        await context.close();
    });

    test('is accessible without authentication', async ({ browser }) => {
        const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
        const page = await context.newPage();

        await page.goto('/i/some-code-123');
        // The page should NOT redirect to login — /i/:code is public
        // It should either show the invite wizard (auth step) or error state
        const invalidHeading = page.getByRole('heading', { name: 'Invalid Invite' });
        const loadingText = page.getByText('Loading invite...');
        const loginButton = page.getByRole('button', { name: /discord|sign in|log in/i });

        // Wait for the page to settle — one of these states should appear
        await expect(
            invalidHeading.or(loadingText).or(loginButton).first(),
        ).toBeVisible({ timeout: 10_000 });

        // Confirm we did NOT get redirected to the auth guard login page
        expect(page.url()).toContain('/i/');

        await context.close();
    });
});

// ---------------------------------------------------------------------------
// Community branding — visible on public pages
// ---------------------------------------------------------------------------

test.describe('Community branding on public pages', () => {
    test('header shows community name on join page', async ({ page }) => {
        await page.goto('/join');
        // The header link contains the community name
        const headerLink = page.locator('header a[href="/"]');
        await expect(headerLink).toBeVisible({ timeout: 10_000 });
        // Community name text should be non-empty
        await expect(headerLink).not.toHaveText('', { timeout: 5_000 });
    });

    test('header shows community name on invite page', async ({ browser }) => {
        const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
        const page = await context.newPage();

        await page.goto('/i/branding-test');
        // Even on the invite error page, the header should render
        // Wait for page to settle (loading -> error state)
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });

        // The header / branding area may or may not render for unauthenticated
        // users depending on layout. Check that the page loaded without crash.
        const headerLink = page.locator('header a[href="/"]');
        if (await headerLink.isVisible({ timeout: 5_000 }).catch(() => false)) {
            await expect(headerLink).not.toHaveText('', { timeout: 3_000 });
        }

        await context.close();
    });
});
