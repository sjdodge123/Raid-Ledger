/**
 * ROK-1833 — Valheim Link mod token on the Pelican admin page, end to end.
 *
 * Seed: `POST /admin/test/valheim/link-fixture` (DEMO_MODE) activates Pelican
 * (fake connection) + Valheim and resets THIS worker's slot pair — a row
 * mapped to Valheim and a row on another game — to "no token". The slot is
 * the worker's `parallelIndex`, so desktop and mobile never share a row.
 *
 * UI: the Valheim row offers Generate, the other row the disabled unmapped
 * state; Generate opens the show-once dialog (server id + masked token, Show,
 * Copy, Done); the row then shows Rotate + Revoke. API (as the mod): the
 * revealed token POSTs the contract's golden character fixture → 202, a
 * wrong `serverId` → 403; after Rotate the old token → 401 and the new one
 * → 202; after Revoke → 401.
 *
 * The token is a secret even in a fixture env: it is never put in an
 * assertion value or an error message (ROK-1841) — only status codes and
 * booleans are. Both projects run it: desktop drives the table, phones the
 * stacked cards + bottom sheets.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './base';
import { API_BASE, apiPost, getAdminToken } from './api-helpers';

const PAGE = '/admin/settings/integrations/plugin/pelican/pelican-panel';
const FIXTURE = '/admin/test/valheim/link-fixture';
const INGEST = '/plugins/valheim/link/messages/character';
const CHARACTER_FIXTURE = 'packages/contract/valheim-link/v1/fixtures/character-vanilla.json';

interface Seeded { valheimServerId: number; otherServerId: number; serverId: string }

const golden = JSON.parse(readFileSync(path.resolve(process.cwd(), CHARACTER_FIXTURE), 'utf8')) as Record<string, unknown>;

/** POST the golden character message as the mod; returns ONLY the status code. */
async function postAsMod(modToken: string, serverId: string): Promise<number> {
    const body = { ...golden, serverId, capturedAt: new Date().toISOString() };
    const res = await fetch(`${API_BASE}${INGEST}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${modToken}` },
        body: JSON.stringify(body),
    });
    await res.body?.cancel();
    return res.status;
}

async function seed(adminToken: string, slot: number): Promise<Seeded> {
    const res = (await apiPost(adminToken, FIXTURE, { slot })) as Partial<Seeded>;
    expect(res.valheimServerId, 'valheim link fixture seed failed (is there a Valheim game?)').toEqual(expect.any(Number));
    expect(res.otherServerId, 'valheim link fixture has no other-game row').toEqual(expect.any(Number));
    return { valheimServerId: res.valheimServerId ?? -1, otherServerId: res.otherServerId ?? -1, serverId: res.serverId ?? '' };
}

/** A copy that always succeeds — headless clipboards vary by project. */
async function stubClipboard(page: Page): Promise<void> {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => undefined } });
    });
}

/** Navigate without echoing a URL into the failure (ROK-1841). */
async function openPelicanPage(page: Page): Promise<void> {
    try {
        await page.goto(PAGE);
    } catch {
        throw new Error('navigation to the Pelican admin page failed');
    }
}

/** In the open dialog: masked → Show → read → Copy → Done. Returns the token. */
async function revealCopyAndClose(page: Page, serverId: string): Promise<string> {
    const dialog = page.getByTestId('valheim-link-token-dialog');
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('valheim-link-server-id')).toHaveValue(serverId);
    const value = page.getByTestId('valheim-link-token-value');
    await expect(value).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: 'Show token' }).click();
    await expect(value).toHaveAttribute('type', 'text');
    await expect(page.getByTestId('valheim-link-token-instructions')).toBeVisible();
    const modToken = await value.inputValue();
    expect(modToken.length > 20, 'the dialog should reveal a full token').toBe(true);
    await page.getByTestId('valheim-link-token-copy').click();
    await expect(page.getByTestId('valheim-link-token-copy')).toHaveText('Copied');
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).toBeHidden();
    return modToken;
}

async function confirm(page: Page, id: number, kind: 'rotate' | 'revoke'): Promise<void> {
    await page.getByTestId(`valheim-link-token-${id}-${kind}`).click();
    await page.getByTestId(`valheim-link-token-confirm-${kind}`).click();
}

test.describe('Valheim Link mod token (ROK-1833)', () => {
    test('generate, ingest as the mod, rotate kills the old token, revoke kills the new one', async ({ page }) => {
        const adminToken = await getAdminToken();
        const slot = test.info().parallelIndex;
        const { valheimServerId: id, otherServerId, serverId } = await seed(adminToken, slot);
        expect(serverId).toBe(String(id));
        try {
            await stubClipboard(page);
            await openPelicanPage(page);
            await expect(page.getByTestId(`valheim-link-token-${id}-generate`)).toBeVisible({ timeout: 15_000 });
            await expect(page.getByTestId(`valheim-link-token-${otherServerId}-unmapped`)).toBeVisible();

            await page.getByTestId(`valheim-link-token-${id}-generate`).click();
            const first = await revealCopyAndClose(page, serverId);
            await expect(page.getByTestId(`valheim-link-token-${id}-rotate`)).toBeVisible();
            await expect(page.getByTestId(`valheim-link-token-${id}-revoke`)).toBeVisible();

            expect(await postAsMod(first, serverId), 'ingest with the new token').toBe(202);
            expect(await postAsMod(first, String(otherServerId)), 'ingest with a wrong serverId').toBe(403);

            await confirm(page, id, 'rotate');
            const second = await revealCopyAndClose(page, serverId);
            expect(second === first, 'rotate must issue a different token').toBe(false);
            expect(await postAsMod(first, serverId), 'ingest with the rotated-out token').toBe(401);
            expect(await postAsMod(second, serverId), 'ingest with the rotated-in token').toBe(202);

            await confirm(page, id, 'revoke');
            await expect(page.getByTestId(`valheim-link-token-${id}-generate`)).toBeVisible({ timeout: 15_000 });
            expect(await postAsMod(second, serverId), 'ingest with the revoked token').toBe(401);
        } finally {
            await apiPost(adminToken, FIXTURE, { slot }).catch(() => undefined);
        }
    });
});
