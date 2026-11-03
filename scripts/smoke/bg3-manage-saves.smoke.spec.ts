/**
 * ROK-2068 — "Manage my saves" on a BG3 `game_community` hub's Campaign tab: a
 * member ticks the month group(s) of their ~800-day-old playthroughs, sees the
 * footer count, confirms, and the server deletes exactly those saves while the
 * recent ones stay (spec AC 10, Playwright tier). Desktop AND mobile.
 *
 * Fixture: `POST /admin/test/bg3/seed-hub` variant `folder-keys` under a tag
 * unique to spec × project × worker (`hubSeedTag`). The seed gives
 * `bg3-member-<tag>` nine saves, each its own campaign key (`folderKeys`,
 * oldest first): `QuickSave_1..6` ~800 days old (1–2 filed in the active
 * campaign "Tactician run"), `QuickSave_7..9` 1–3 days old. Month headings are
 * computed in the browser (its locale + time zone, as the sheet does), so the
 * test never hard-codes a month. Every write is confirmed against
 * `GET /plugins/bg3/me/saves` with `pollForCondition`. No sleeps.
 */
import type { Locator, Page, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { API_BASE, apiGet, apiPost, getAdminToken, pollForCondition } from './api-helpers';
import { signInOnboardedMember } from './browser-session';
import { hubSeedTag } from './hub-seed';

const CAMPAIGN_NAME = 'Tactician run';
const UI_TIMEOUT = 20_000;
const OLD = 6;
/** The overlay's accessible name: the pick step, or the confirm step's "Remove N playthrough(s)?". */
const SHEET_NAME = /^(Manage my saves|Remove \d+ playthroughs?\?)$/;

interface Seed {
    hubId: number;
    memberId: number;
    folderKeys: string[];
}

interface MySave {
    saveName: string;
    savedAt: string;
    campaignKey: string;
}

/** The bg3 plugin is not active on a fresh env; install, else activate (a sibling worker won). */
async function ensurePluginActive(token: string, pluginId: string): Promise<void> {
    const init = { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } };
    const install = await fetch(`${API_BASE}/admin/plugins/${pluginId}/install`, init);
    if (install.ok) return;
    const activate = await fetch(`${API_BASE}/admin/plugins/${pluginId}/activate`, init);
    if (!activate.ok) throw new Error(`failed to enable the ${pluginId} plugin: install ${install.status}, activate ${activate.status}`);
}

async function seedHub(testInfo: TestInfo): Promise<Seed> {
    const token = await getAdminToken();
    const body = (await apiPost(token, '/admin/test/bg3/seed-hub', {
        tag: hubSeedTag('bg3-manage-saves', testInfo),
        variant: 'folder-keys',
    })) as { hubId?: unknown; users?: { member?: { userId?: unknown } }; folderKeys?: unknown } | null;
    const memberId = body?.users?.member?.userId;
    const folderKeys = body?.folderKeys;
    if (typeof body?.hubId !== 'number' || typeof memberId !== 'number' || !Array.isArray(folderKeys) || folderKeys.length !== 9) {
        throw new Error(`bg3 seed-hub folder-keys: ${JSON.stringify(body)}`);
    }
    return { hubId: body.hubId, memberId, folderKeys: folderKeys.map(String) };
}

/** The member's seeded saves (one page of 50 covers the nine), keyed by campaign key. */
async function seededSaves(jwt: string, folderKeys: readonly string[]): Promise<MySave[]> {
    const res = (await apiGet(jwt, '/plugins/bg3/me/saves')) as { saves?: MySave[] } | null;
    return (res?.saves ?? []).filter((s) => folderKeys.includes(s.campaignKey));
}

/** Month headings exactly as the sheet renders them (viewer locale + time zone). */
async function monthLabels(page: Page, isos: readonly string[]): Promise<string[]> {
    return page.evaluate(
        (list) => [...new Set(list.map((iso) => new Date(iso).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })))],
        [...isos],
    );
}

async function openManageSaves(page: Page, hubId: number): Promise<Locator> {
    await page.goto(`/hubs/${hubId}#campaign`);
    const open = page.getByTestId('bg3-campaign-tab').getByRole('button', { name: 'Manage my saves', exact: true });
    await expect(open, 'a member sees Manage my saves under Your saves').toBeVisible({ timeout: UI_TIMEOUT });
    await open.click();
    // The confirm step renames the overlay ("Remove 6 playthroughs?"), so match both titles (Codex P2).
    const sheet = page.getByRole('dialog', { name: SHEET_NAME });
    await expect(sheet.getByTestId('bg3-manage-saves-row'), 'all nine seeded playthroughs are listed').toHaveCount(9, { timeout: UI_TIMEOUT });
    return sheet;
}

const box = (sheet: Locator, name: string): Locator => sheet.getByRole('checkbox', { name, exact: true });

test.describe('BG3 Manage my saves (ROK-2068)', () => {
    test.beforeAll(async () => {
        await ensurePluginActive(await getAdminToken(), 'bg3');
    });

    test('tick the old month group(s) → Remove 6 playthroughs → confirm → only the 3 recent saves remain', async ({ page }, testInfo) => {
        const seed = await seedHub(testInfo);
        const jwt = await signInOnboardedMember(page, seed.memberId);
        const before = await seededSaves(jwt, seed.folderKeys);
        expect(before, 'the seed gave the member nine saves').toHaveLength(9);
        const oldKeys = seed.folderKeys.slice(0, OLD);
        const oldIsos = before.filter((s) => oldKeys.includes(s.campaignKey)).map((s) => s.savedAt);
        const oldMonths = await monthLabels(page, oldIsos);
        const sheet = await openManageSaves(page, seed.hubId);

        await expect(box(sheet, 'QuickSave_1'), 'a filed playthrough names its campaign').toHaveAccessibleDescription(new RegExp(`In ${CAMPAIGN_NAME}`));
        for (const month of oldMonths) await box(sheet, month).click();
        await expect(sheet.getByRole('button', { name: 'Remove 6 playthroughs · 6 saves' }), 'the footer counts the old run').toBeEnabled();
        for (const n of [7, 8, 9]) await expect(box(sheet, `QuickSave_${n}`), 'the recent saves stay unticked').not.toBeChecked();

        await box(sheet, 'QuickSave_3').click();
        const [q3Month] = await monthLabels(page, before.filter((s) => s.saveName === 'QuickSave_3').map((s) => s.savedAt));
        await expect(box(sheet, q3Month ?? ''), 'a partly picked month is indeterminate').toHaveJSProperty('indeterminate', true);
        await box(sheet, 'QuickSave_3').click();

        await sheet.getByRole('button', { name: 'Remove 6 playthroughs · 6 saves' }).click();
        await expect(sheet.getByTestId('bg3-remove-saves-confirm'), 'Remove asks first').toContainText('This deletes 6 saves you uploaded');
        await sheet.getByRole('button', { name: 'Remove saves', exact: true }).click();

        const left = await pollForCondition(
            async () => {
                const saves = await seededSaves(jwt, seed.folderKeys);
                return saves.length === 9 - OLD ? saves : null;
            },
            { timeoutMs: 15_000, description: 'only the three recent seeded saves remain' },
        );
        expect(left.map((s) => s.campaignKey).sort(), 'exactly the recent keys survive').toEqual(seed.folderKeys.slice(OLD).sort());
        await expect(sheet.getByTestId('bg3-manage-saves-row'), 'the sheet refreshes to the three recent playthroughs').toHaveCount(3, {
            timeout: UI_TIMEOUT,
        });
        await expect(box(sheet, 'QuickSave_1'), 'a removed playthrough is gone from the list').toHaveCount(0);
    });

    test('Cancel with a pick asks to discard, and Discard removes nothing', async ({ page }, testInfo) => {
        const seed = await seedHub(testInfo);
        const jwt = await signInOnboardedMember(page, seed.memberId);
        const sheet = await openManageSaves(page, seed.hubId);
        await box(sheet, 'QuickSave_1').click();
        await sheet.getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(page.getByText('Nothing will be removed.'), 'the dirty-close guard asks first').toBeVisible();
        await page.getByRole('button', { name: 'Discard', exact: true }).click();
        await expect(sheet, 'Discard closes the sheet').toHaveCount(0);
        expect(await seededSaves(jwt, seed.folderKeys), 'nothing was removed').toHaveLength(9);
    });
});
