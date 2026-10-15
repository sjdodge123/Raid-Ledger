/**
 * ROK-1800 — Pelican admin "Detect Quick Play from server logs" switch.
 *
 * Seed: `POST /admin/test/pelican/seed-servers` (DEMO_MODE) resets four demo
 * servers and saves a fake connection, so the Servers section renders. The
 * "Missing" demo row is then mapped to Valheim — the one game with a log
 * parser — so its switch is enabled; the unmapped "Offline" row shows the
 * disabled state + hint. The toggle is put back in `finally`.
 * Both projects run it: desktop drives the table, phones the stacked cards.
 */
import { test, expect } from './base';
import { apiGet, apiPatch, apiPost, getAdminToken } from './api-helpers';

const PAGE = '/admin/settings/integrations/plugin/pelican/pelican-panel';
const SERVERS = '/admin/plugins/pelican/servers';
const MAPPED = 'Demo Server — Missing';
const UNMAPPED = 'Demo Server — Offline';

interface Row { id: number; name: string; presenceTracking: boolean; presenceSupported: boolean }

async function serverByName(token: string, name: string): Promise<Row> {
    const body = (await apiGet(token, SERVERS)) as { data?: Row[] } | null;
    const row = (body?.data ?? []).find((r) => r.name === name);
    expect(row, `seeded server "${name}" not listed`).toBeTruthy();
    if (!row) throw new Error(`seeded server "${name}" not listed`);
    return row;
}

/** Seed the demo servers, make the Valheim parser available, map MAPPED to Valheim. */
async function seed(token: string): Promise<Row> {
    await apiPost(token, '/admin/test/pelican/seed-servers');
    await apiPost(token, '/admin/plugins/valheim/install').catch(() => undefined);
    await apiPost(token, '/admin/plugins/valheim/activate').catch(() => undefined);
    const valheim = (await apiGet(token, '/games/slug/valheim')) as { id?: number } | null;
    expect(valheim?.id, 'no valheim game in this env').toEqual(expect.any(Number));
    const row = await serverByName(token, MAPPED);
    await apiPatch(token, `${SERVERS}/${row.id}`, { gameId: valheim?.id, presenceTracking: false });
    return serverByName(token, MAPPED);
}

test.describe('Pelican admin — Detect Quick Play switch (ROK-1800)', () => {
    test('renders, is disabled with a hint when unmapped, and toggles on a Valheim server', async ({ page }) => {
        const token = await getAdminToken();
        const mapped = await seed(token);
        expect(mapped.presenceSupported, 'the Valheim-mapped server should support Quick Play').toBe(true);
        const unmapped = await serverByName(token, UNMAPPED);
        try {
            await page.goto(PAGE);
            const unmappedSwitch = page.getByTestId(`pelican-server-${unmapped.id}-quick-play`);
            await expect(unmappedSwitch).toBeVisible({ timeout: 15_000 });
            await expect(unmappedSwitch).toBeDisabled();
            await expect(page.locator(`#pelican-server-${unmapped.id}-quick-play-hint`)).toHaveText('Map a game first');

            const sw = page.getByTestId(`pelican-server-${mapped.id}-quick-play`);
            await sw.scrollIntoViewIfNeeded();
            await expect(sw).toBeEnabled();
            await expect(sw).toHaveAttribute('aria-checked', 'false');
            const saved = page.waitForResponse((r) => r.request().method() === 'PATCH'
                && r.url().endsWith(`${SERVERS}/${mapped.id}`));
            await sw.click();
            expect((await saved).ok(), 'PATCH presenceTracking failed').toBe(true);
            await expect(sw).toHaveAttribute('aria-checked', 'true');
            expect((await serverByName(token, MAPPED)).presenceTracking).toBe(true);
        } finally {
            await apiPatch(token, `${SERVERS}/${mapped.id}`, { presenceTracking: false }).catch(() => undefined);
        }
    });
});
