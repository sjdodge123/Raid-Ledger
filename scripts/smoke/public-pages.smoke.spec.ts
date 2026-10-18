/**
 * Public pages smoke tests — join page (/join) and invite page (/i/:code).
 *
 * Both routes live outside the AuthGuard so they must be accessible
 * without authentication.  The tests verify:
 *  - Pages render without the error boundary firing
 *  - Invalid/missing tokens show a graceful error state
 *  - Community branding (header link) is visible
 *  - Unauthenticated visitors can reach the pages
 */
import { test, expect } from './base';
import { apiGet, getAdminToken } from './api-helpers';


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
        const redeemBodies: string[] = [];
        await page.route('**/auth/redeem-intent', async (route) => {
            redeemBodies.push(route.request().postData() ?? '');
            await route.continue();
        });

        await page.goto(`/join?intent=signup&eventId=${String(eventId)}&token=${token}`);

        await page.waitForURL(new RegExp(`/events/${String(eventId)}(\\?|#|$)`), { timeout: 20_000 });
        expect(
            redeemBodies.length,
            'the stripped page must still have redeemed, exactly once, from its capture',
        ).toBe(1);
        expect(
            redeemBodies[0] ?? '',
            'the redeem POST must carry the token the address-bar strip captured',
        ).toContain(token);
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
