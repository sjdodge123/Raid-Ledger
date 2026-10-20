/**
 * ROK-1428 (L10, story ROK-1434) — the channel-automation admin page at
 * /admin/settings/discord/lifecycle and the bindings list's Lifecycle cell,
 * desktop + mobile.
 *
 * Seeds per project via POST /admin/test/channel-lifecycle/seed (names carry
 * the project + a run stamp so the two projects never share a game):
 *   create  — 2 events + 1 poll, no binding        → "Create" planned
 *   manual  — 1 event, a manual binding           → no Pin; PATCH pinned = 400
 *   managed — 1 event, an auto binding (active)   → Pin toggle on the bindings list
 *   blocked — 1 event, suppression 'deleted'      → "Suppressed" + Recreate
 *
 * Never touches Discord: enabling is route-mocked to the API's 400 (a fleet
 * env's bot IS connected and a real enable would create categories in the
 * shared guild), and only the dry run ("Preview changes") is clicked — never
 * "Run in Discord".
 */
import type { Page, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { API_BASE, apiGet, apiPatch, apiPost, getAdminToken, pollForCondition } from './api-helpers';
import { isDesktop } from './helpers';

const PAGE = '/admin/settings/discord/lifecycle';
const SETTINGS = /\/admin\/discord\/lifecycle\/settings$/;
const BOT_STATUS = /\/admin\/settings\/discord-bot$/;
const ENABLE_REFUSED = 'Choose or allow an Archived category before enabling';
const PIN_REFUSED = 'Only Raid Ledger-managed channels can be pinned';
const ENABLE_LABEL = 'Create and archive game channels automatically';

interface Seeded { gameId: number; gameName: string; bindingId: string | null }

let token: string;
let seeds: Record<'create' | 'manual' | 'managed' | 'blocked', Seeded>;

async function seed(name: string, body: Record<string, unknown>): Promise<Seeded> {
    const res = (await apiPost(token, '/admin/test/channel-lifecycle/seed', { gameName: name, ...body })) as Seeded;
    if (typeof res.gameId !== 'number') throw new Error(`seed ${name} failed: ${JSON.stringify(res)}`);
    return res;
}

test.beforeAll(async ({}, testInfo: TestInfo) => {
    token = await getAdminToken();
    const tag = `Smoke LC ${testInfo.project.name} ${Date.now().toString(36)}`;
    seeds = {
        create: await seed(`${tag} create`, { items: { events: 2, polls: 1 } }),
        manual: await seed(`${tag} manual`, { items: { events: 1 }, binding: { state: 'active', autoManaged: false } }),
        managed: await seed(`${tag} managed`, { items: { events: 1 }, binding: { state: 'active', autoManaged: true } }),
        blocked: await seed(`${tag} blocked`, { items: { events: 1 }, suppression: 'deleted' }),
    };
});

function activityRow(page: Page, gameName: string) {
    return page.getByTestId('lifecycle-activity-row').filter({ hasText: gameName });
}

async function openPage(page: Page): Promise<void> {
    await page.goto(PAGE);
    await expect(page.getByRole('heading', { name: 'Channel automation' })).toBeVisible({ timeout: 15_000 });
}

test.describe('Admin Discord — channel automation (ROK-1428)', () => {
    test('Preview lists the seeded game with its signals and planned action', async ({ page }, testInfo) => {
        await openPage(page);
        const layout = isDesktop(testInfo) ? 'lifecycle-activity-table' : 'lifecycle-activity-cards';
        const other = isDesktop(testInfo) ? 'lifecycle-activity-cards' : 'lifecycle-activity-table';
        await expect(page.getByTestId(layout)).toBeVisible({ timeout: 15_000 });
        await expect(page.getByTestId(other)).toHaveCount(0);
        const row = activityRow(page, seeds.create.gameName);
        await expect(row).toContainText('Events 2');
        await expect(row).toContainText('Polls 1');
        await expect(row).toContainText('Create');
        // A manual binding never offers Pin (only RL-managed channels can be pinned).
        await expect(activityRow(page, seeds.manual.gameName).getByRole('button', { name: 'Pin' })).toHaveCount(0);
    });

    test('enabling with no Archived category shows the API refusal inline', async ({ page }) => {
        await page.route((url) => BOT_STATUS.test(url.pathname), async (route) => {
            const response = await route.fetch();
            const real = (await response.json().catch(() => ({}))) as Record<string, unknown>;
            await route.fulfill({ response, status: 200, json: { ...real, connected: true } });
        });
        await page.route((url) => SETTINGS.test(url.pathname), async (route) => {
            if (route.request().method() !== 'PATCH') { await route.continue(); return; }
            // Never let the enable reach an env whose bot is connected.
            await route.fulfill({
                status: 400,
                headers: {
                    'access-control-allow-origin': route.request().headers()['origin'] ?? '*',
                    'access-control-allow-credentials': 'true',
                },
                json: { statusCode: 400, message: ENABLE_REFUSED, error: 'Bad Request' },
            });
        });
        await openPage(page);
        const automation = page.getByRole('region', { name: 'Automation' });
        await automation.getByRole('switch', { name: ENABLE_LABEL }).click();
        await expect(automation.getByRole('alert')).toContainText(ENABLE_REFUSED);
    });

    test('Preview changes renders the dry-run counts', async ({ page }) => {
        await openPage(page);
        await page.getByRole('button', { name: 'Preview changes' }).click();
        await expect(page.getByTestId('lifecycle-run-result')).toContainText(
            /Would create \d+ · unarchive \d+ · archive \d+ · link \d+ hubs · defer \d+/, { timeout: 15_000 },
        );
    });

    test('a threshold edit persists across a reload', async ({ page }, testInfo) => {
        test.skip(!isDesktop(testInfo), 'global setting — one project mutates it so the two never race');
        const before = (await apiGet(token, '/admin/discord/lifecycle/settings')) as { recentActivityDays: number };
        const next = before.recentActivityDays === 45 ? 46 : 45;
        try {
            await openPage(page);
            const box = page.getByLabel('Archive after N days without activity');
            await box.fill(String(next));
            await box.blur();
            await pollForCondition(async () => {
                const s = (await apiGet(token, '/admin/discord/lifecycle/settings')) as { recentActivityDays: number } | null;
                return s?.recentActivityDays === next ? s : null;
            }, { description: 'recentActivityDays saved' });
            await page.reload();
            await expect(page.getByLabel('Archive after N days without activity')).toHaveValue(String(next), { timeout: 15_000 });
        } finally {
            await apiPatch(token, '/admin/discord/lifecycle/settings', { recentActivityDays: before.recentActivityDays });
        }
    });

    test('pinning a manual binding is refused with 400', async () => {
        const res = await fetch(`${API_BASE}/admin/discord/bindings/${String(seeds.manual.bindingId)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ pinned: true }),
        });
        expect(res.status).toBe(400);
        expect(await res.text()).toContain(PIN_REFUSED);
    });

    test('a suppressed game offers Recreate, which clears the suppression', async ({ page }) => {
        const bot = (await apiGet(token, '/admin/settings/discord-bot')) as { connected?: boolean } | null;
        test.skip(bot?.connected !== true, 'suppressions are per bot guild — CI has no connected bot (DELETE answers 404)');
        await openPage(page);
        const row = activityRow(page, seeds.blocked.gameName);
        await expect(row).toContainText('Suppressed', { timeout: 15_000 });
        const cleared = page.waitForResponse((r) =>
            r.request().method() === 'DELETE' && r.url().endsWith(`/suppressions/${seeds.blocked.gameId}`));
        await row.getByRole('button', { name: 'Recreate' }).click();
        expect((await cleared).status()).toBe(204);
        await expect(row).not.toContainText('Suppressed', { timeout: 15_000 });
    });

    test('the bindings list shows the Lifecycle cell and toggles Pin', async ({ page }) => {
        await page.goto('/admin/settings/discord/channels');
        const row = page.getByTestId('channel-binding-row').filter({ hasText: seeds.managed.gameName });
        const cell = row.getByTestId('binding-lifecycle-cell');
        await expect(cell).toContainText('Managed', { timeout: 15_000 });
        await cell.getByRole('button', { name: 'Pin' }).click();
        await expect(cell.getByRole('button', { name: 'Unpin' })).toBeVisible({ timeout: 15_000 });
        await expect(page.getByTestId('channel-binding-row').filter({ hasText: seeds.manual.gameName })
            .getByTestId('binding-lifecycle-cell')).toHaveCount(0);
    });
});
