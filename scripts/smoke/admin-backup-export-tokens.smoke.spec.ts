/**
 * ROK-2263 — Admin → Backups "Clone access tokens", end to end.
 *
 * The section renders on the backups page; "New token" mints an `rlbx_`
 * token shown once (Done before copying asks the discard guard → Stay keeps
 * the dialog; Copy → "Copied"; Done then closes and the value is gone); the
 * row is listed live; Revoke → confirm flips it to `data-status="revoked"`.
 *
 * The token is a secret even in a fixture env: it is never logged, never put
 * in an assertion value or message — only a boolean prefix check is (the
 * ROK-1841 rule `valheim-link-token.smoke.spec.ts` follows). Both projects run
 * it: desktop gets the Modal, phones the BottomSheet; the discard confirm has
 * the same test ids in both. Every token this spec mints is revoked in
 * `finally` so reruns never hit the 5-live cap.
 */
import type { Page, Response } from '@playwright/test';
import { test, expect } from './base';
import { apiDelete, apiGet, getAdminToken } from './api-helpers';

const PAGE = '/admin/settings/general/backups';
const TOKENS_PATH = '/admin/backup-export-tokens';
const LABEL_PREFIX = 'smoke-bx-';
/** A `smoke-bx-` token older than this is a leftover from a dead run, not a sibling project's. */
const STALE_MS = 10 * 60_000;

interface TokenRow { id: number; label: string; createdAt: string; revokedAt: string | null }

async function listTokens(adminToken: string): Promise<TokenRow[]> {
    const body = (await apiGet(adminToken, TOKENS_PATH)) as { tokens?: TokenRow[] } | null;
    return body?.tokens ?? [];
}

/** Revoke live leftovers from earlier dead runs (never a token a parallel project is using). */
async function revokeStaleSmokeTokens(adminToken: string): Promise<void> {
    const cutoff = Date.now() - STALE_MS;
    const stale = (await listTokens(adminToken)).filter(
        (t) => t.label.startsWith(LABEL_PREFIX) && !t.revokedAt && Date.parse(t.createdAt) < cutoff,
    );
    for (const t of stale) await apiDelete(adminToken, `${TOKENS_PATH}/${t.id}`);
}

function isTokensCall(method: string): (res: Response) => boolean {
    return (res) => res.request().method() === method && new URL(res.url()).pathname.includes(TOKENS_PATH);
}

/** A copy that always succeeds — headless clipboards vary by project. */
async function stubClipboard(page: Page): Promise<void> {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => undefined } });
    });
}

/** Fill the mint form and submit; returns the new token's id (never its value). */
async function mint(page: Page, label: string): Promise<number> {
    await expect(page.getByTestId('backup-export-token-new')).toBeEnabled({ timeout: 15_000 });
    await page.getByTestId('backup-export-token-new').click();
    const form = page.getByTestId('backup-export-token-mint-form');
    await expect(form).toBeVisible();
    await form.getByRole('textbox').fill(label);
    const minted = page.waitForResponse(isTokensCall('POST'));
    await page.getByTestId('backup-export-token-mint-submit').click();
    const res = await minted;
    expect(res.status(), 'mint should answer 201').toBe(201);
    const body = (await res.json()) as { item?: { id?: number } };
    const id = body.item?.id;
    expect(typeof id, 'mint response should carry the new row id').toBe('number');
    return id ?? -1;
}

/** The show-once step: rlbx_ value, guard on an uncopied close, copy, then close for real. */
async function checkShowOnceDialog(page: Page): Promise<void> {
    const dialog = page.getByTestId('backup-export-token-secret-dialog');
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    const value = page.getByTestId('backup-export-token-secret-value');
    const secret = await value.inputValue();
    expect(/^rlbx_/.test(secret), 'the dialog should show an rlbx_ token').toBe(true);

    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByTestId('discard-changes-confirm'), 'closing uncopied asks the discard guard').toBeVisible();
    await page.getByTestId('discard-changes-keep').click();
    await expect(page.getByTestId('discard-changes-confirm')).toBeHidden();
    await expect(dialog, 'Stay keeps the token on screen').toBeVisible();

    await page.getByTestId('backup-export-token-secret-copy').click();
    await expect(page.getByTestId('backup-export-token-secret-copy')).toHaveText('Copied');
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('backup-export-token-secret-value'), 'the token is gone once closed').toHaveCount(0);
}

async function revokeViaUi(page: Page, label: string): Promise<void> {
    const row = page.getByTestId('backup-export-token-row').filter({ hasText: label });
    await row.getByTestId('backup-export-token-revoke').click();
    const revoked = page.waitForResponse(isTokensCall('DELETE'));
    await page.getByTestId('backup-export-token-revoke-confirm').click();
    expect((await revoked).status(), 'revoke should answer 204').toBe(204);
    await expect(row).toHaveAttribute('data-status', 'revoked', { timeout: 15_000 });
    await expect(row.getByTestId('backup-export-token-revoke'), 'a revoked row offers no Revoke').toHaveCount(0);
}

test.describe('Admin — Backups clone access tokens (ROK-2263)', () => {
    test('mint shows the token once, the row is live, revoke marks it revoked', async ({ page }) => {
        const adminToken = await getAdminToken();
        const label = `${LABEL_PREFIX}w${test.info().parallelIndex}-${Date.now()}`;
        const created: number[] = [];
        await revokeStaleSmokeTokens(adminToken);
        try {
            await stubClipboard(page);
            await page.goto(PAGE);
            const section = page.getByTestId('backup-export-tokens-section');
            await expect(section).toBeVisible({ timeout: 15_000 });
            await expect(section.getByRole('heading', { name: 'Clone access tokens' })).toBeVisible();

            created.push(await mint(page, label));
            await checkShowOnceDialog(page);

            const row = page.getByTestId('backup-export-token-row').filter({ hasText: label });
            await expect(row).toHaveCount(1, { timeout: 15_000 });
            await expect(row).toHaveAttribute('data-status', 'live');

            await revokeViaUi(page, label);
            await expect(page.locator('body')).not.toHaveText(/something went wrong/i);
        } finally {
            for (const id of created) await apiDelete(adminToken, `${TOKENS_PATH}/${id}`).catch(() => undefined);
        }
    });
});
