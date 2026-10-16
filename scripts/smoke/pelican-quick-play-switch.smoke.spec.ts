/**
 * ROK-1800 — Pelican admin "Detect Quick Play from server logs" switch.
 *
 * Seed: `POST /admin/test/pelican/seed-servers` (DEMO_MODE) resets four demo
 * servers and saves a fake connection, so the Servers section renders. The
 * "Missing" demo row is then mapped to Valheim — the one game with a log
 * parser — so its switch is enabled; the unmapped "Offline" row shows the
 * disabled state + hint. The toggle is put back in `finally`.
 * ROK-1819: the Valheim plugin owns that parser and is never auto-installed,
 * so the spec installs + activates it explicitly and fails loudly if it can't,
 * rather than relying on env state. It is left active afterwards: the desktop
 * and mobile workers share one API, so a deactivate by one would pull the
 * parser out from under the other (which is also why the inactive-plugin hint
 * is pinned in Vitest + the API integration spec, not here).
 * Both projects run it: desktop drives the table, phones the stacked cards.
 */
import { test, expect } from './base';
import { API_BASE, apiGet, apiPatch, apiPost, getAdminToken } from './api-helpers';

const PAGE = '/admin/settings/integrations/plugin/pelican/pelican-panel';
const SERVERS = '/admin/plugins/pelican/servers';
const MAPPED = 'Demo Server — Missing';
const UNMAPPED = 'Demo Server — Offline';

interface Row {
    id: number; name: string; presenceTracking: boolean; presenceSupported: boolean;
    presencePluginInactive?: { pluginId: string; pluginName: string };
}

/**
 * Install + activate the Valheim plugin via the real admin plugin API (the
 * `ai-suggestions-fixtures.ts::ensureAiPluginActive` pattern). A failed install
 * (already installed, or the sibling worker won the race) falls through to
 * activate, which must succeed.
 */
async function ensureValheimActive(token: string): Promise<void> {
    const init = { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } };
    const install = await fetch(`${API_BASE}/admin/plugins/valheim/install`, init);
    if (install.ok) return;
    const activate = await fetch(`${API_BASE}/admin/plugins/valheim/activate`, init);
    if (!activate.ok) throw new Error(`failed to enable the Valheim plugin: install ${install.status}, activate ${activate.status}`);
}

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
    await ensureValheimActive(token);
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
        expect(mapped.presencePluginInactive, 'the Valheim plugin should be active after seed').toBeUndefined();
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
