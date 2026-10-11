/**
 * ROK-1754 — in-memory access token + server-side impersonation (browser level).
 *
 *   1. A signed-in page holds NO JWT in localStorage/sessionStorage, before
 *      and after a reload (the token lives in memory, minted from `rl_rt`).
 *   2. Impersonation survives a reload: the marker lives on the context's
 *      refresh family, so the boot refresh re-mints the impersonation token
 *      and the banner is back on first render. Exit ends it server-side —
 *      the admin menu returns, and a further reload stays the admin.
 *
 * Impersonation is STARTED through the context's own request client (admin
 * bearer + this context's `rl_rt` cookie — the same request the UserMenu
 * makes), so the spec does not depend on the desktop dropdown vs the phone
 * drawer. Exit goes through the banner button, the real UI path.
 *
 * Conventions: `./base` fixtures (the default context is the admin with its
 * own refresh family), deterministic waits only — NEVER sleep().
 */
import type { Page } from '@playwright/test';
import { test, expect } from './base';
import { getAdminToken, getInviteeFixture } from './api-helpers';
import { storageJwtEntries } from './browser-session';
import { resolveApiUrl } from './target';

function banner(page: Page) {
    return page.getByText(/Viewing as/);
}

function exitButton(page: Page) {
    return page.getByRole('button', { name: 'Exit Impersonation' }).first();
}

/** The admin-only menu entry is reachable (desktop dropdown or phone drawer). */
async function expectAdminMenu(page: Page): Promise<void> {
    const trigger = page.getByTestId('user-menu-trigger');
    const openMenu = page.getByRole('button', { name: 'Open menu' });
    await expect(trigger.or(openMenu).first()).toBeVisible({ timeout: 15_000 });
    if (await trigger.isVisible()) {
        await trigger.click();
        await expect(
            page.getByRole('link', { name: 'Admin Settings' }),
            'the admin dropdown offers Admin Settings again after exit',
        ).toBeVisible({ timeout: 10_000 });
    } else {
        await openMenu.click();
        await expect(
            page.getByTestId('more-drawer-admin-toggle'),
            'the phone drawer offers the Admin section again after exit',
        ).toBeVisible({ timeout: 10_000 });
    }
}

test.describe('Access token in memory (ROK-1754)', () => {
    test('a signed-in page keeps no JWT in web storage, before and after reload', async ({ page }) => {
        await page.goto('/calendar');
        await expect(page.getByRole('button', { name: /sign in|continue with/i })).toHaveCount(0, { timeout: 15_000 });
        expect(await storageJwtEntries(page), 'no JWT in web storage after load').toEqual([]);

        await page.reload();
        await expect(page.getByRole('button', { name: /sign in|continue with/i })).toHaveCount(0, { timeout: 15_000 });
        expect(await storageJwtEntries(page), 'no JWT in web storage after reload').toEqual([]);
    });

    test('impersonate → reload → banner still shown → exit → admin menu back', async ({ page }) => {
        const invitee = await getInviteeFixture();
        await page.goto('/');
        await expect(exitButton(page)).toHaveCount(0, { timeout: 15_000 });

        // Start on THIS context's refresh family (cookie + admin bearer).
        const start = await page.context().request.post(
            `${resolveApiUrl()}/auth/impersonate/${invitee.userId}`,
            { headers: { Authorization: `Bearer ${await getAdminToken()}` } },
        );
        expect(start.status(), `impersonate start: ${await start.text()}`).toBe(200);

        // Reload = memory gone: the boot refresh must re-mint the impersonation.
        await page.reload();
        await expect(banner(page), 'the banner is back after a reload').toBeVisible({ timeout: 15_000 });
        expect(await storageJwtEntries(page), 'no JWT in web storage while impersonating').toEqual([]);

        await page.reload();
        await expect(banner(page), 'a second reload still impersonates').toBeVisible({ timeout: 15_000 });

        await exitButton(page).click();
        await expect(banner(page), 'exit removes the banner').toHaveCount(0, { timeout: 15_000 });
        await expectAdminMenu(page);
        expect(await storageJwtEntries(page), 'no JWT in web storage after exit').toEqual([]);

        // The marker ended server-side: a reload boots as the admin again.
        await page.reload();
        await expect(page.getByRole('button', { name: /sign in|continue with/i })).toHaveCount(0, { timeout: 15_000 });
        await expect(banner(page), 'a reload after exit does not resume impersonation').toHaveCount(0);
    });
});
