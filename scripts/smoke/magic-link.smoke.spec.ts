/**
 * ROK-1366 — a magic sign-in link signs in ONCE (ACs 8, 9, 10 at the browser level).
 *
 * One link, two fresh browser contexts:
 *   A — lands on the link's deep path signed in. The fragment token is gone
 *       from the address bar, the stored access token is a real session for
 *       the link's user (it passes GET /auth/me) and is NOT the raw link token,
 *       and the auth method is recorded as 'magic'.
 *   B — the same URL is already spent: the redeem is a 401, and the app falls
 *       through to the login screen with no error toast and no stored token.
 *
 * The link is minted through `POST /admin/test/sign-in-link` (DEMO_MODE +
 * admin, the same endpoint `rl_env_signin_link` uses). The returned URL is a
 * live credential: it is never logged, and only its path + fragment are used,
 * re-rooted on the run's baseURL so CLIENT_URL's origin never matters.
 *
 * Each Playwright project signs in as its OWN user (see SIGN_IN_USER_BY_PROJECT).
 *
 * Deterministic waits only — NEVER sleep().
 */
import type { Browser, Page, Response } from '@playwright/test';
import { test, expect } from './base';
import { apiGet, apiPost, getAdminToken } from './api-helpers';

const ACCESS_TOKEN_KEY = 'raid_ledger_token';
const AUTH_METHOD_KEY = 'raid_ledger_auth_method';
/** A nested route whose heading renders on every project (desktop, phone, tablet). */
const LANDING_PATH = '/profile/preferences';

interface MintedLink {
    /** Path + `#token=…`, relative to the run's baseURL. */
    target: string;
    rawToken: string;
    userId: number;
}

/** `sub` of a JWT: the admin's user id, read from the run's admin token. */
function jwtSubject(jwt: string): number {
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString('utf8')) as {
        sub?: unknown;
    };
    const sub = Number(payload.sub);
    if (!Number.isInteger(sub) || sub < 1) throw new Error('admin token has no numeric sub');
    return sub;
}

/**
 * One distinct user per project. A targeted run starts the desktop, mobile and
 * tablet copies of this file at once. Every magic token now carries a random
 * jti, so same-second mints for one user no longer collide — distinct users
 * are kept anyway, so each project's replay check (B) only ever sees its own
 * user's single-use link spent.
 * Fixture slots 8 and 9 are used by no other smoke spec; the fixture upsert
 * keeps them active and onboarded, so AuthGuard never detours to /onboarding.
 */
const SIGN_IN_USER_BY_PROJECT: Readonly<Record<string, 'admin' | number>> = {
    desktop: 'admin',
    mobile: 8,
    tablet: 9,
};

async function signInUserId(adminToken: string, project: string): Promise<number> {
    const who = SIGN_IN_USER_BY_PROJECT[project];
    if (who === undefined) {
        throw new Error(`no distinct sign-in user for project "${project}": add one to SIGN_IN_USER_BY_PROJECT`);
    }
    if (who === 'admin') return jwtSubject(adminToken);
    // Only `userId` is read; the fixture's `jwt` is never used or logged.
    const res = (await apiPost(adminToken, '/admin/test/seed-fixture-user', { slot: who })) as {
        userId?: unknown;
    } | null;
    if (typeof res?.userId !== 'number') throw new Error(`seed-fixture-user(slot ${who}) returned no userId`);
    return res.userId;
}

async function mintSignInLink(path: string, project: string): Promise<MintedLink> {
    const adminToken = await getAdminToken();
    const userId = await signInUserId(adminToken, project);
    const res = (await apiPost(adminToken, '/admin/test/sign-in-link', { userId, path })) as {
        url?: unknown;
        message?: unknown;
    };
    // Never echo `url` — only the failure shape, which carries no token.
    if (typeof res?.url !== 'string') {
        throw new Error(`sign-in-link minted no url (message: ${String(res?.message)})`);
    }
    const link = new URL(res.url);
    const rawToken = new URLSearchParams(link.hash.slice(1)).get('token');
    if (!rawToken) throw new Error('sign-in-link url carries no #token= fragment');
    return { target: `${link.pathname}${link.search}${link.hash}`, rawToken, userId };
}

function isRedeem(response: Response): boolean {
    return (
        response.url().includes('/auth/redeem-magic-link') &&
        response.request().method() === 'POST'
    );
}

async function readAuthStorage(page: Page) {
    return page.evaluate(
        ([tokenKey, methodKey]) => ({
            token: window.localStorage.getItem(tokenKey),
            method: window.localStorage.getItem(methodKey),
        }),
        [ACCESS_TOKEN_KEY, AUTH_METHOD_KEY] as const,
    );
}

function loginButton(page: Page) {
    return page.getByRole('button', { name: /sign in|continue with/i }).first();
}

/** Open the link in a fresh, unauthenticated context; return the page + its redeem response. */
async function openLinkInFreshContext(browser: Browser, target: string) {
    const context = await browser.newContext({ storageState: undefined });
    try {
        const page = await context.newPage();
        const redeem = page.waitForResponse(isRedeem, { timeout: 15_000 });
        await page.goto(target, { waitUntil: 'domcontentloaded' });
        return { context, page, redeemStatus: (await redeem).status() };
    } catch (err) {
        await context.close();
        throw err;
    }
}

test.describe('Magic sign-in link is single-use (ROK-1366)', () => {
    test('first context lands signed in on the deep link; the same link in a second context shows login', async ({
        browser,
    }) => {
        const link = await mintSignInLink(LANDING_PATH, test.info().project.name);

        // --- Context A: the first open redeems and lands on the deep link.
        const a = await openLinkInFreshContext(browser, link.target);
        try {
            expect(a.redeemStatus, 'the first redeem of a fresh link must succeed').toBe(200);
            await expect(a.page.getByRole('heading', { name: 'Appearance' })).toBeVisible({ timeout: 15_000 });
            await expect(a.page).toHaveURL((url) => url.pathname === LANDING_PATH);
            expect(a.page.url(), 'the fragment token must be stripped from the address bar').not.toContain('token=');

            const stored = await readAuthStorage(a.page);
            expect(stored.token, 'a session access token must be stored after redeem').toBeTruthy();
            expect(stored.token, 'the raw magic-link token must never be stored').not.toBe(link.rawToken);
            expect(stored.method, 'a redeemed session records auth method "magic"').toBe('magic');
            const me = (await apiGet(stored.token as string, '/auth/me')) as { id?: unknown } | null;
            expect(me?.id, 'the stored token must be a live session for the link user').toBe(link.userId);
        } finally {
            await a.context.close();
        }

        // --- Context B: the same URL is spent — silent fall-through to login.
        const b = await openLinkInFreshContext(browser, link.target);
        try {
            expect(b.redeemStatus, 'a second redeem of the same link must be rejected').toBe(401);
            await expect(loginButton(b.page)).toBeVisible({ timeout: 15_000 });
            await expect(b.page).toHaveURL((url) => url.pathname === '/');
            await expect(b.page.locator('[data-sonner-toast][data-type="error"]')).toHaveCount(0);
            const stored = await readAuthStorage(b.page);
            expect(stored.token, 'a spent link must not leave a session behind').toBeNull();
        } finally {
            await b.context.close();
        }
    });
});
