/**
 * ROK-1353 — refresh-token / silent re-auth smoke tests (TDD, web level).
 *
 * Covers ACs 1, 3, and 7 at the browser level:
 *   AC1 — a returning user whose access token has expired sees NO login
 *         screen: the on-401 transparent refresh re-mints an access token
 *         from the httpOnly `rl_rt` cookie and the navigation completes.
 *   AC3 — after server-side logout the refresh cookie is revoked, so a
 *         forced refresh is rejected and the user lands back on the login
 *         screen.
 *   AC7 — the `/auth/success?silent_failed=1` fall-through routes to the
 *         login screen exactly once (no redirect loop / one-shot guard).
 *
 * These are FAILS-BY-CONSTRUCTION against current `origin/main`:
 *   - No `rl_rt` httpOnly cookie is issued on login today, so clearing the
 *     localStorage access token and navigating drops the user to the login
 *     screen instead of transparently refreshing (AC1 assertion fails).
 *   - There is no `POST /auth/logout` server revocation wired into the web
 *     logout, and no `/auth/refresh` endpoint, so AC3 cannot pass.
 *   - `auth-success-page.tsx` has no `silent_failed` branch yet, so the
 *     AC7 assertion that it routes cleanly to login (without an OAuth-error
 *     toast loop) fails.
 *
 * ROK-1754: the access token now lives in page MEMORY only (never in
 * localStorage). "Expiry" is therefore simulated by a NEW page in the same
 * context — memory empty, the httpOnly `rl_rt` cookie intact — or by a
 * reload. The ACs are unchanged; the evidence moved from "a token was
 * written to localStorage" to "the boot `POST /auth/refresh` succeeded and no
 * JWT is in web storage".
 *
 * Conventions: `./base` fixtures (domcontentloaded goto), `expandLocalLogin`,
 * deterministic Playwright waits only — NEVER sleep().
 */
import type { Page, Response } from '@playwright/test';
import { test, expect } from './base';
import { expandLocalLogin } from './helpers';
import { storageJwtEntries } from './browser-session';
const ADMIN_USER = 'admin@local';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'password';

/** Matches a POST whose path ends with `suffix` (any API prefix). */
function isPost(suffix: string) {
    return (r: Response) =>
        r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith(suffix);
}

/** Log in via the local form from a fresh, unauthenticated context page. */
async function loginViaForm(page: Page) {
    await page.goto('/');
    await expandLocalLogin(page);
    await page.locator('#username').fill(ADMIN_USER);
    await page.locator('#password').fill(ADMIN_PASS);
    const login = page.waitForResponse(isPost('/auth/local'), { timeout: 15_000 });
    await page.getByRole('button', { name: 'Sign In' }).click();
    // Positive login evidence, layout-agnostic: the login POST succeeded (the
    // desktop user-menu is hidden on mobile viewports, and asserting "Sign In
    // gone" alone is vacuous — the login card can collapse for other reasons).
    expect((await login).status(), 'the local login POST must succeed').toBeLessThan(300);
    await expect(loginButton(page)).not.toBeVisible({ timeout: 15_000 });
    expect(await storageJwtEntries(page), 'ROK-1754: no JWT in web storage after login').toEqual([]);
}

/** Navigate (or reload) and return the boot refresh's HTTP status. */
async function bootRefreshStatus(page: Page, go: () => Promise<unknown>): Promise<number> {
    const refresh = page.waitForResponse(isPost('/auth/refresh'), { timeout: 15_000 });
    await go();
    return (await refresh).status();
}

/** True when the page is currently showing the login screen. */
function loginButton(page: Page) {
    return page
        .getByRole('button', { name: /sign in|continue with/i })
        .first();
}

test.describe('Auth refresh (ROK-1353)', () => {
    test('AC1: expired access token transparently refreshes (no login screen)', async ({
        browser,
    }) => {
        const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
        const page = await context.newPage();

        await loginViaForm(page);

        // Simulate access-token expiry WITHOUT touching the httpOnly rl_rt
        // cookie — that cookie is what the transparent refresh relies on. The
        // token lives only in page memory, so a new page in the same context
        // starts with none (ROK-1754).
        const expired = await context.newPage();

        // Navigate to a protected route. With a valid refresh cookie the app
        // must silently re-mint an access token and render the page — the
        // user must NOT be bounced to the login screen.
        const status = await bootRefreshStatus(expired, () => expired.goto('/calendar'));
        expect(status, 'the boot refresh must re-mint an access token from the cookie').toBe(200);
        await expect(loginButton(expired)).not.toBeVisible({ timeout: 15_000 });

        // Reload = memory gone again: the same transparent path, still no login.
        const reloadStatus = await bootRefreshStatus(expired, () => expired.reload());
        expect(reloadStatus, 'a reload must re-mint from the cookie').toBe(200);
        await expect(loginButton(expired)).not.toBeVisible({ timeout: 15_000 });
        expect(await storageJwtEntries(expired), 'ROK-1754: no JWT in web storage after reload').toEqual([]);

        await context.close();
    });

    test('AC3: logout revokes refresh — a subsequent refresh is rejected', async ({
        browser,
    }) => {
        const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
        const page = await context.newPage();

        await loginViaForm(page);

        // Trigger the app logout (server-side revocation + cookie clear).
        // Desktop: logout lives in the user-menu dropdown; mobile: behind the
        // header hamburger ("Open menu") in the MoreDrawer.
        const userMenu = page.getByTestId('user-menu-trigger');
        if (await userMenu.isVisible({ timeout: 5_000 }).catch(() => false)) {
            await userMenu.click();
        } else {
            await page.getByRole('button', { name: 'Open menu' }).click();
        }
        await page
            .getByRole('button', { name: /log ?out|sign ?out/i })
            .first()
            .click();

        // Back on the login screen.
        await expect(loginButton(page)).toBeVisible({ timeout: 15_000 });

        // Drop the in-memory access token (a new page — ROK-1754) and force a
        // navigation: because logout revoked the refresh family server-side,
        // the transparent refresh must FAIL and leave the user on the login
        // screen (no silent re-entry with a dead cookie).
        const after = await context.newPage();
        await after.goto('/calendar');

        await expect(loginButton(after)).toBeVisible({ timeout: 15_000 });
        expect(await storageJwtEntries(after), 'no JWT in web storage after logout').toEqual([]);

        await context.close();
    });

    test('AC7: ?silent_failed=1 routes to login exactly once (no loop)', async ({
        browser,
    }) => {
        const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
        const page = await context.newPage();

        // The silent Discord re-auth fall-through lands here. The page must
        // route to the login screen WITHOUT entering an OAuth-error toast
        // loop and without bouncing through /auth/success repeatedly.
        await page.goto('/auth/success?silent_failed=1');

        // Lands on the login screen.
        await expect(loginButton(page)).toBeVisible({ timeout: 15_000 });

        // One-shot guard: we must NOT still be sitting on /auth/success, and
        // re-visiting the silent-failed URL must not relaunch a silent
        // redirect attempt (no loop) — it deterministically returns to login.
        await expect(page).not.toHaveURL(/\/auth\/success/, { timeout: 15_000 });

        await page.goto('/auth/success?silent_failed=1');
        await expect(loginButton(page)).toBeVisible({ timeout: 15_000 });
        await expect(page).not.toHaveURL(/\/auth\/success/, { timeout: 15_000 });

        await context.close();
    });
});
