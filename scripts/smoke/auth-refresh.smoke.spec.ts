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
 * Conventions: `./base` fixtures (domcontentloaded goto), `expandLocalLogin`,
 * deterministic Playwright waits only — NEVER sleep().
 */
import { test, expect } from './base';
import { expandLocalLogin } from './helpers';

const TOKEN_KEY = 'raid_ledger_token';
const ADMIN_USER = 'admin@local';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'password';

/** Log in via the local form from a fresh, unauthenticated context page. */
async function loginViaForm(page: import('@playwright/test').Page) {
    await page.goto('/');
    await expandLocalLogin(page);
    await page.locator('#username').fill(ADMIN_USER);
    await page.locator('#password').fill(ADMIN_PASS);
    await page.getByRole('button', { name: 'Sign In' }).click();
    // Left the login page — the Sign In button is gone once authenticated.
    await expect(
        page.getByRole('button', { name: 'Sign In' }),
    ).not.toBeVisible({ timeout: 15_000 });
}

/** True when the page is currently showing the login screen. */
function loginButton(page: import('@playwright/test').Page) {
    return page
        .getByRole('button', { name: /sign in|continue with/i })
        .first();
}

test.describe('Auth refresh (ROK-1353)', () => {
    test('AC1: expired access token transparently refreshes (no login screen)', async ({
        browser,
    }) => {
        const context = await browser.newContext({ storageState: undefined });
        const page = await context.newPage();

        await loginViaForm(page);

        // Simulate access-token expiry WITHOUT touching the httpOnly rl_rt
        // cookie — that cookie is what the transparent refresh relies on.
        await page.evaluate((key) => {
            window.localStorage.removeItem(key);
        }, TOKEN_KEY);

        // Navigate to a protected route. With a valid refresh cookie the app
        // must silently re-mint an access token and render the page — the
        // user must NOT be bounced to the login screen.
        await page.goto('/calendar');

        await expect(loginButton(page)).not.toBeVisible({ timeout: 15_000 });
        // A fresh access token must have been written back to localStorage by
        // the transparent-refresh client.
        await expect
            .poll(
                async () =>
                    page.evaluate(
                        (key) => window.localStorage.getItem(key),
                        TOKEN_KEY,
                    ),
                { timeout: 15_000 },
            )
            .not.toBeNull();

        await context.close();
    });

    test('AC3: logout revokes refresh — a subsequent refresh is rejected', async ({
        browser,
    }) => {
        const context = await browser.newContext({ storageState: undefined });
        const page = await context.newPage();

        await loginViaForm(page);

        // Trigger the app logout (server-side revocation + cookie clear).
        const userMenu = page
            .getByRole('button', { name: /account|profile|menu|admin/i })
            .first();
        if (await userMenu.isVisible({ timeout: 5_000 }).catch(() => false)) {
            await userMenu.click();
        }
        await page
            .getByRole('button', { name: /log ?out|sign ?out/i })
            .first()
            .click();

        // Back on the login screen.
        await expect(loginButton(page)).toBeVisible({ timeout: 15_000 });

        // Clear the access token and force a navigation: because logout
        // revoked the refresh family server-side, the transparent refresh
        // must FAIL and leave the user on the login screen (no silent
        // re-entry with a dead cookie).
        await page.evaluate((key) => {
            window.localStorage.removeItem(key);
        }, TOKEN_KEY);
        await page.goto('/calendar');

        await expect(loginButton(page)).toBeVisible({ timeout: 15_000 });

        await context.close();
    });

    test('AC7: ?silent_failed=1 routes to login exactly once (no loop)', async ({
        browser,
    }) => {
        const context = await browser.newContext({ storageState: undefined });
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
