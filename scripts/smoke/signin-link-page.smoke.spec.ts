/**
 * ROK-2283 — `/signin-link`, the landing for the Discord `/login` command's
 * one-time link, waits for a tap before it spends the token.
 *
 *   A — a fresh context opens a link minted for `/signin-link`: the fragment is
 *       stripped, the page offers Continue, and NO redeem is sent until the
 *       tap. Continue → `POST /auth/redeem-magic-link` 200 → Calendar.
 *   B — the same URL in a second fresh context: Continue → 401 → the
 *       used/expired card, still on `/signin-link`.
 *   C — a first-time-member token (`signin: true`) goes to
 *       `POST /auth/redeem-discord-link`, never the magic endpoint. The token
 *       here is an unsigned stand-in, so the real server answers 401 and the
 *       page shows the used/expired card — what it proves is the endpoint pick.
 *
 * The real link is minted through `POST /admin/test/sign-in-link` (DEMO_MODE +
 * admin, the endpoint `rl_env_signin_link` uses) with `path: '/signin-link'`.
 * The URL is a live credential: never logged; only path + fragment are used.
 *
 * Deterministic waits only — NEVER sleep().
 */
import type { Browser, BrowserContext, Page, Request } from '@playwright/test';
import { test, expect } from './base';
import { apiPost, getAdminToken } from './api-helpers';

const SIGNIN_PATH = '/signin-link';
const MAGIC_REDEEM = '/auth/redeem-magic-link';
const DISCORD_REDEEM = '/auth/redeem-discord-link';
const DEAD_COPY = /already been used or has expired\. Run \/login in Discord for a new one\./;

/** One user per project (same slots as magic-link.smoke — fixtures stay onboarded, so no /onboarding detour). */
const SIGN_IN_USER_BY_PROJECT: Readonly<Record<string, 'admin' | number>> = { desktop: 'admin', mobile: 8, tablet: 9 };

function jwtSubject(jwt: string): number {
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString('utf8')) as { sub?: unknown };
    const sub = Number(payload.sub);
    if (!Number.isInteger(sub) || sub < 1) throw new Error('admin token has no numeric sub');
    return sub;
}

async function signInUserId(adminToken: string, project: string): Promise<number> {
    const who = SIGN_IN_USER_BY_PROJECT[project];
    if (who === undefined) throw new Error(`no sign-in user for project "${project}": add one to SIGN_IN_USER_BY_PROJECT`);
    if (who === 'admin') return jwtSubject(adminToken);
    const res = (await apiPost(adminToken, '/admin/test/seed-fixture-user', { slot: who })) as { userId?: unknown } | null;
    if (typeof res?.userId !== 'number') throw new Error(`seed-fixture-user(slot ${who}) returned no userId`);
    return res.userId;
}

/** Path + `#token=…` of a fresh link to `/signin-link`, relative to the run's baseURL. */
async function mintSigninPageLink(project: string): Promise<string> {
    const adminToken = await getAdminToken();
    const userId = await signInUserId(adminToken, project);
    const res = (await apiPost(adminToken, '/admin/test/sign-in-link', { userId, path: SIGNIN_PATH })) as {
        url?: unknown; message?: unknown;
    };
    if (typeof res?.url !== 'string') throw new Error(`sign-in-link minted no url (message: ${String(res?.message)})`);
    const link = new URL(res.url);
    if (!link.hash.includes('token=')) throw new Error('sign-in-link url carries no #token= fragment');
    return `${link.pathname}${link.hash}`;
}

/** A structurally valid but unsigned first-time-member token (the server rejects it). */
function unsignedSigninToken(): string {
    const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ discordId: '100000000000000001', username: 'Smoke Member', signin: true, src: 'cmd' })}.c2ln`;
}

const isRedeemPost = (path: string) => (req: Request) => req.method() === 'POST' && req.url().includes(path);

async function openInFreshContext(browser: Browser, target: string): Promise<{ context: BrowserContext; page: Page; redeems: string[] }> {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    const redeems: string[] = [];
    page.on('request', (req) => {
        if (isRedeemPost(MAGIC_REDEEM)(req)) redeems.push(MAGIC_REDEEM);
        if (isRedeemPost(DISCORD_REDEEM)(req)) redeems.push(DISCORD_REDEEM);
    });
    await page.goto(target, { waitUntil: 'domcontentloaded' });
    return { context, page, redeems };
}

function continueButton(page: Page) {
    return page.getByTestId('signin-link-continue');
}

async function tapContinue(page: Page, endpoint: string): Promise<number> {
    const res = page.waitForResponse((r) => isRedeemPost(endpoint)(r.request()), { timeout: 15_000 });
    await continueButton(page).click();
    return (await res).status();
}

test.describe('Sign-in link page waits for the tap (ROK-2283)', () => {
    test('Continue spends the link once and lands on Calendar; the same link again shows the expired card', async ({ browser }) => {
        const target = await mintSigninPageLink(test.info().project.name);

        const a = await openInFreshContext(browser, target);
        try {
            await expect(a.page.getByTestId('signin-link-title')).toHaveText(/^Sign in to .+/, { timeout: 15_000 });
            await expect(continueButton(a.page)).toBeVisible();
            expect(a.page.url(), 'the fragment token must be stripped from the address bar').not.toContain('token=');
            expect(a.redeems, 'nothing may be redeemed before the tap').toEqual([]);
            expect(await tapContinue(a.page, MAGIC_REDEEM), 'the first tap must redeem the fresh link').toBe(200);
            await expect(a.page).toHaveURL((url) => url.pathname === '/calendar', { timeout: 15_000 });
        } finally {
            await a.context.close();
        }

        const b = await openInFreshContext(browser, target);
        try {
            expect(await tapContinue(b.page, MAGIC_REDEEM), 'a spent link must be rejected').toBe(401);
            await expect(b.page.getByText(DEAD_COPY)).toBeVisible();
            await expect(b.page).toHaveURL((url) => url.pathname === SIGNIN_PATH);
        } finally {
            await b.context.close();
        }
    });

    test('a first-time-member token goes to /auth/redeem-discord-link, never the magic endpoint', async ({ browser }) => {
        const c = await openInFreshContext(browser, `${SIGNIN_PATH}#token=${unsignedSigninToken()}`);
        try {
            await expect(c.page.getByTestId('signin-link-title')).toHaveText(/^Sign in to .+ as Smoke Member$/, { timeout: 15_000 });
            expect(c.redeems, 'nothing may be redeemed before the tap').toEqual([]);
            expect(await tapContinue(c.page, DISCORD_REDEEM), 'the server rejects an unsigned token').toBe(401);
            await expect(c.page.getByText(DEAD_COPY)).toBeVisible();
            expect(c.redeems).toEqual([DISCORD_REDEEM]);
        } finally {
            await c.context.close();
        }
    });
});
