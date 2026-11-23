/**
 * ROK-2099 (S4, AC3) — Admin → General → "Addon errors".
 *
 * Fixtures: the `blizzard` plugin is installed + activated through the real
 * admin plugin API (the nav row and the page exist only while it is active),
 * then `POST /admin/test/wow/seed-addon-errors` (DEMO_MODE, idempotent) gives
 * three demo uploaders four scrubbed records in three groups:
 *   Questie   — one message, two members (aldric ×14, brannoc ×3) → 2 members, 17
 *   DBM-Core  — one member, ×2
 *   Details   — one member, ×1
 * The seed is a delete + insert per uploader, so a re-seed from a sibling
 * worker would empty the list for a moment under another test. `ensureSeeded`
 * therefore seeds only when the API does not already return those groups.
 *
 * Layout: the §4.21 table (`addon-error-row`) at 1024px and up, one card per
 * group (`addon-error-card`) below; filters behind the §4.1 funnel (toolbar
 * trigger + inline panel / Filters FAB + BottomSheet — `games-filters.ts`).
 * The admin sidebar shows at 768px and up; below it the More drawer's Admin
 * accordion carries the same rows.
 */
import { readFileSync } from 'node:fs';
import type { Download, Locator, Page } from '@playwright/test';
import { test, expect } from './base';
import { API_BASE, apiGet, apiPost, getAdminToken, pollForCondition } from './api-helpers';
import { closeGamesFilters, filtersOpener, filtersSurface, hasFilterFunnel } from './games-filters';

const PAGE_PATH = '/admin/settings/general/addon-errors';
const API = '/admin/plugins/blizzard/addon-errors';
/** `md` — where `admin-settings-layout.tsx` shows the sidebar. */
const SIDEBAR_MIN_WIDTH = 768;

/** Distinctive substrings of the seeded messages (`demo-test-addon-errors.helpers.ts`). */
const QUESTIE = "attempt to index field 'quest'";
const DBM = 'bad argument #1 to "format", got nil';
const DETAILS = '"spell, id" is not a number';
const EMPTY_FILTERED = 'No addon errors match these filters.';
const CSV_HEADER =
    'id,userId,username,characterName,characterRealm,source,sourceVersion,addon,message,stack,count,session,firstSeenAt,lastSeenAt,recordHash,scrubbedCount';

interface Group { addon?: unknown; message?: unknown; members?: unknown[]; totalCount?: unknown }

/** Install + activate a plugin (the `community-hubs.smoke.spec.ts` pattern; activate is idempotent). */
async function ensurePluginActive(token: string, pluginId: string): Promise<void> {
    const init = { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } };
    const install = await fetch(`${API_BASE}/admin/plugins/${pluginId}/install`, init);
    if (install.ok) return;
    const activate = await fetch(`${API_BASE}/admin/plugins/${pluginId}/activate`, init);
    if (!activate.ok) throw new Error(`failed to enable the ${pluginId} plugin: install ${install.status}, activate ${activate.status}`);
}

async function groupsOf(token: string, addon: string): Promise<Group[]> {
    const body = (await apiGet(token, `${API}?addon=${encodeURIComponent(addon)}`)) as { items?: Group[] } | null;
    return body?.items ?? [];
}

/** True when the API returns the three seeded groups with their seeded totals. */
async function seedPresent(token: string): Promise<boolean> {
    const [questie, dbm, details] = await Promise.all([groupsOf(token, 'Questie'), groupsOf(token, 'DBM-Core'), groupsOf(token, 'Details')]);
    const has = (groups: Group[], text: string) => groups.find((g) => typeof g.message === 'string' && g.message.includes(text));
    const q = has(questie, QUESTIE);
    return q?.totalCount === 17 && q.members?.length === 2 && !!has(dbm, DBM) && !!has(details, DETAILS);
}

async function ensureSeeded(): Promise<void> {
    const token = await getAdminToken();
    await ensurePluginActive(token, 'blizzard');
    if (await seedPresent(token)) return;
    await apiPost(token, '/admin/test/wow/seed-addon-errors');
    // A sibling worker seeding at the same moment can make this POST fail on the
    // unique index; whichever insert won leaves the same fixed set, so poll the state.
    await pollForCondition(async () => ((await seedPresent(token)) ? true : null), {
        timeoutMs: 15_000, description: 'seeded addon-error groups',
    });
}

/** The row (≥1024px) or card (below) of the group whose message contains `text`. */
function groupItem(page: Page, text: string): Locator {
    return page.getByTestId(hasFilterFunnel(page) ? 'addon-error-row' : 'addon-error-card').filter({ hasText: text });
}

async function openPage(page: Page): Promise<void> {
    await page.goto(PAGE_PATH);
    await expect(page.getByRole('heading', { name: 'Addon errors', level: 2 })).toBeVisible({ timeout: 20_000 });
    await expect(groupItem(page, QUESTIE), 'the seeded Questie group is listed').toBeVisible({ timeout: 20_000 });
}

function searchBox(page: Page): Locator {
    return page.getByRole('searchbox', { name: 'Search addon errors' });
}

/** Pick an addon in the Filters entry (inline panel / sheet), then close it. */
async function filterByAddon(page: Page, addon: string): Promise<void> {
    const opener = filtersOpener(page);
    await expect(opener).toHaveAttribute('aria-expanded', 'false');
    await opener.click();
    const surface = filtersSurface(page);
    await expect(surface).toBeVisible({ timeout: 10_000 });
    if (!hasFilterFunnel(page)) {
        // The sheet moves focus to its Close button on a 0 ms timer (`useSheetFocus`).
        await expect(surface.locator(':focus'), 'the Filters sheet moved focus inside itself').toHaveCount(1);
    }
    await surface.getByLabel('Addon', { exact: true }).selectOption(addon);
    await closeGamesFilters(page);
}

async function readDownload(download: Download): Promise<string> {
    const file = await download.path();
    if (!file) throw new Error(`[admin-addon-errors] download ${download.suggestedFilename()} has no file`);
    return readFileSync(file, 'utf-8');
}

async function exportAs(page: Page, label: 'Export JSON' | 'Export CSV'): Promise<Download> {
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: label, exact: true }).click(),
    ]);
    return download;
}

test.describe('Admin Addon errors (ROK-2099)', () => {
    test.beforeAll(async () => {
        await ensureSeeded();
    });

    test('nav row sits after Logs under General and opens the page', async ({ page }) => {
        await page.goto('/admin/settings/general');
        if ((page.viewportSize()?.width ?? 0) >= SIDEBAR_MIN_WIDTH) {
            const nav = page.getByRole('navigation', { name: 'Admin settings navigation' });
            await expect(nav.getByRole('link', { name: 'Addon errors', exact: true })).toBeVisible({ timeout: 15_000 });
            const names = (await nav.getByRole('link').allInnerTexts()).map((t) => t.trim());
            expect(names.indexOf('Addon errors'), `General rows: ${names.join(' | ')}`).toBe(names.indexOf('Logs') + 1);
            await nav.getByRole('link', { name: 'Addon errors', exact: true }).click();
        } else {
            await page.getByRole('button', { name: 'Open menu' }).click();
            const drawer = page.getByTestId('more-drawer-panel');
            await expect(drawer).toBeVisible({ timeout: 10_000 });
            // On an /admin/settings path the Admin accordion opens expanded (`more-drawer.tsx`).
            await expect(drawer.getByTestId('more-drawer-admin-toggle')).toHaveAttribute('aria-expanded', 'true');
            const row = drawer.getByTestId('admin-submenu').getByRole('link', { name: 'Addon errors', exact: true });
            await expect(row).toBeVisible({ timeout: 15_000 });
            await row.click();
        }
        await expect(page).toHaveURL(/\/admin\/settings\/general\/addon-errors$/);
        await expect(page.getByRole('heading', { name: 'Addon errors', level: 2 })).toBeVisible({ timeout: 15_000 });
    });

    test('groups show addon, message, members and count', async ({ page }) => {
        await openPage(page);
        const questie = groupItem(page, QUESTIE);
        await expect(questie).toHaveCount(1);
        await expect(questie).toContainText('Questie');
        if (hasFilterFunnel(page)) {
            await expect(questie.locator('td').nth(2), 'members column').toHaveText('2');
            await expect(questie.locator('td').nth(3), 'count column').toHaveText('17');
        } else {
            await expect(questie).toContainText('2 members · 17×');
        }
        await expect(groupItem(page, DBM)).toContainText('DBM-Core');
        await expect(groupItem(page, DETAILS)).toContainText('Details');
    });

    test('opening a group shows its occurrences and the sample stack', async ({ page }) => {
        await openPage(page);
        const toggle = groupItem(page, QUESTIE).getByRole('button', { name: /QuestieTracker\.lua:812/ });
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        const panelId = await toggle.getAttribute('aria-controls');
        if (!panelId) throw new Error('[admin-addon-errors] the message toggle has no aria-controls');
        const panel = page.locator(`[id="${panelId}"]`);
        await expect(panel.getByText('Stack (sample, scrubbed)')).toBeVisible({ timeout: 10_000 });
        await expect(panel.locator('pre')).toContainText('QuestieTracker.lua"]:81');
        const occurrences = panel.getByRole('table', { name: 'Occurrences' });
        await expect(occurrences).toContainText('addon-err-aldric', { timeout: 15_000 });
        await expect(occurrences).toContainText('addon-err-brannoc');
    });

    test('the addon filter narrows the list', async ({ page }) => {
        await openPage(page);
        await filterByAddon(page, 'DBM-Core');
        await expect(groupItem(page, QUESTIE)).toHaveCount(0, { timeout: 15_000 });
        await expect(groupItem(page, DBM)).toBeVisible();
        await expect(groupItem(page, DETAILS)).toHaveCount(0);
    });

    test('search narrows the list', async ({ page }) => {
        await openPage(page);
        await searchBox(page).fill('Details');
        await expect(groupItem(page, QUESTIE)).toHaveCount(0, { timeout: 15_000 });
        await expect(groupItem(page, DETAILS)).toBeVisible();
        await expect(groupItem(page, DBM)).toHaveCount(0);
    });

    test('a filter that matches nothing shows the filtered empty state', async ({ page }) => {
        await openPage(page);
        await filterByAddon(page, 'DBM-Core');
        await expect(groupItem(page, DBM)).toBeVisible({ timeout: 15_000 });
        await searchBox(page).fill('Questie');
        await expect(page.getByText(EMPTY_FILTERED)).toBeVisible({ timeout: 15_000 });
        await expect(groupItem(page, DBM)).toHaveCount(0);
    });

    test('export downloads the filtered rows as JSON and CSV', async ({ page }) => {
        await openPage(page);
        await searchBox(page).fill('Questie');
        await expect(groupItem(page, DBM)).toHaveCount(0, { timeout: 15_000 });

        const json = await exportAs(page, 'Export JSON');
        expect(json.suggestedFilename()).toMatch(/^addon-errors-\d{4}-\d{2}-\d{2}\.json$/);
        const body = JSON.parse(await readDownload(json)) as { rows?: Array<{ addon?: unknown }> };
        const addons = (body.rows ?? []).map((r) => r.addon);
        expect(addons.length, 'both seeded Questie records are exported').toBeGreaterThanOrEqual(2);
        expect(new Set(addons), 'only rows the search selects are exported').toEqual(new Set(['Questie']));

        const csv = await exportAs(page, 'Export CSV');
        expect(csv.suggestedFilename()).toMatch(/^addon-errors-\d{4}-\d{2}-\d{2}\.csv$/);
        const text = await readDownload(csv);
        expect(text.split(/\r?\n/)[0], 'CSV header row').toBe(CSV_HEADER);
        expect(text).toContain('QuestieTracker.lua:812');
        expect(text).not.toContain('DBM-Core');
    });
});
