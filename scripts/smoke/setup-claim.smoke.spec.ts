/**
 * `/claim` smoke (ROK-1701) — desktop + mobile.
 *
 * Spec D-9: this spec STUBS the server side with `page.route` and never arms
 * a real claim. A real armed claim flips `claimRequired` for the WHOLE server
 * (every concurrent spec file would be bounced to `/claim`) and a real success
 * rewrites admin@local's password and revokes its sessions, poisoning the
 * shared smoke admin token. The real end-to-end claim (the
 * `/admin/test/claim/{arm,lock,reset}` fixtures) is proven by the integration
 * matrix and the fleet test plan, one env and one lane at a time.
 *
 * Stubs:
 * - `GET  **\/system/status` → the real body plus `claimRequired: true`
 *   and a future `claimExpiresAt` while `ClaimState.required` is true.
 * - `POST **\/setup/claim`   → 401 / 410 / 429 coded refusals, or 200 with a
 *   real admin `access_token` (so the signed-in state after success is real).
 * - `GET  **\/admin/onboarding/status` → the real body with `completed:false`,
 *   so "Continue to setup" lands on the wizard instead of its /calendar exit.
 *
 * Runs signed out (anonymous storageState) — the claimer has no session yet.
 * Every stub is per-page, so nothing leaks into other spec files and there is
 * no server state to reset afterwards.
 */
import type { Page, Route } from '@playwright/test';
import { test, expect } from './base';
import { getAdminToken } from './api-helpers';

const CLAIM_PATH = '/claim';
const PASSWORD = 'smoke-claim-password-1';
const CODE = 'ABCD-EFGH-IJKL-MNOP';
const HOURS_LEFT_MS = 48 * 60 * 60 * 1000;

/** Mutable claim flag the status stub reads on every request. */
interface ClaimState {
    required: boolean;
}

test.use({ storageState: { cookies: [], origins: [] } });

/** CORS headers for a fulfilled cross-origin response (API on another origin in dev). */
function corsHeaders(route: Route): Record<string, string> {
    return {
        'access-control-allow-origin': route.request().headers()['origin'] ?? '*',
        'access-control-allow-credentials': 'true',
    };
}

/** Serve the real `/system/status` body with the claim flags `state` dictates. */
async function stubStatus(page: Page, state: ClaimState): Promise<void> {
    await page.route('**/system/status', async (route) => {
        const response = await route.fetch();
        const real = (await response.json()) as Record<string, unknown>;
        const claim = state.required
            ? { claimRequired: true, claimExpiresAt: new Date(Date.now() + HOURS_LEFT_MS).toISOString() }
            : { claimRequired: false };
        await route.fulfill({ response, json: { ...real, ...claim } });
    });
}

/** Answer `POST /setup/claim` with `status` + `body`; the request never reaches the API. */
async function stubClaim(page: Page, status: number, body: Record<string, unknown>): Promise<void> {
    await page.unroute('**/setup/claim');
    await page.route('**/setup/claim', async (route) => {
        if (route.request().method() !== 'POST') {
            await route.continue();
            return;
        }
        await route.fulfill({ status, headers: corsHeaders(route), json: body });
    });
}

/** Keep the setup wizard open: the seeded community already finished setup. */
async function stubWizardOpen(page: Page): Promise<void> {
    await page.route('**/admin/onboarding/status', async (route) => {
        if (route.request().method() !== 'GET') {
            await route.continue();
            return;
        }
        const response = await route.fetch();
        const real = (await response.json()) as Record<string, unknown>;
        await route.fulfill({ response, json: { ...real, completed: false } });
    });
}

/** Open `/claim` with the claim pending and wait for the card. */
async function openClaim(page: Page, state: ClaimState): Promise<void> {
    await stubStatus(page, state);
    await page.goto(CLAIM_PATH);
    await expect(page.getByTestId('claim-card')).toBeVisible({ timeout: 15_000 });
}

/** Fill code + both passwords and submit. */
async function submitClaim(page: Page, code: string): Promise<void> {
    await page.getByLabel('Setup code').fill(code);
    await page.getByLabel('New password', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Confirm password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Claim and set password' }).click();
}

/** Submit once against a stubbed refusal and return the message's text. */
async function expectRefusal(page: Page, status: number, body: Record<string, unknown>, state: string): Promise<string> {
    await stubClaim(page, status, body);
    await submitClaim(page, CODE);
    const message = page.getByTestId('claim-code-message');
    await expect(message).toHaveAttribute('data-state', state);
    await expect(page.getByTestId('claim-code')).toHaveAttribute('aria-invalid', 'true');
    return (await message.innerText()).trim();
}

test.describe('Setup claim (/claim)', () => {
    test('every route lands on /claim while a claim is pending', async ({ page }) => {
        await stubStatus(page, { required: true });
        for (const path of ['/events', '/']) {
            await page.goto(path);
            await expect(page).toHaveURL(/\/claim$/, { timeout: 15_000 });
            await expect(page.getByRole('heading', { name: 'Claim this Raid Ledger' })).toBeVisible();
        }
    });

    test('wrong, expired and locked codes each show their own refusal', async ({ page }) => {
        await openClaim(page, { required: true });
        const wrong = await expectRefusal(page, 401, { code: 'claim_code_invalid', message: 'x' }, 'wrong');
        const expired = await expectRefusal(page, 410, { code: 'claim_expired', message: 'x' }, 'expired');
        const retryAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        const locked = await expectRefusal(page, 429, { code: 'claim_locked', message: 'x', retryAt }, 'locked');
        expect(new Set([wrong, expired, locked]).size, `refusal copy must differ: ${[wrong, expired, locked].join(' | ')}`).toBe(3);
        await expect(page.getByRole('link', { name: 'Continue to setup' })).toHaveCount(0);
    });

    test('a correct code signs in and "Continue to setup" opens the wizard', async ({ page }) => {
        const state: ClaimState = { required: true };
        await openClaim(page, state);
        await stubClaim(page, 200, { access_token: await getAdminToken() });
        await stubWizardOpen(page);
        await submitClaim(page, CODE);
        await expect(page.getByTestId('claim-code-message')).toHaveAttribute('data-state', 'ok');
        await expect(page.getByRole('button', { name: 'Claim and set password' })).toHaveCount(0);
        // The server is claimed from here on: a status refetch must not bounce back.
        state.required = false;
        await page.getByRole('link', { name: 'Continue to setup' }).click();
        await expect(page).toHaveURL(/\/admin\/setup$/, { timeout: 15_000 });
        await expect(page.getByTestId('claim-card')).toHaveCount(0);
    });

    test('/claim redirects away once the instance is claimed (real status)', async ({ page }) => {
        await page.goto(CLAIM_PATH);
        await expect(page).not.toHaveURL(/\/claim$/, { timeout: 15_000 });
        await expect(page.getByTestId('claim-card')).toHaveCount(0);
    });
});
