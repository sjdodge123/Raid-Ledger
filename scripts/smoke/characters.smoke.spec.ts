/**
 * Character detail smoke tests — equipment display, Wowhead tooltip suppression.
 *
 * ROK-921: On mobile, tapping a WoW equipment item should open only the
 * carousel modal — the Wowhead tooltip popup must not appear.
 */
import { test, expect } from './base';
import fs from 'fs';
import path from 'path';

const API_BASE = process.env.API_URL || 'http://localhost:3000';
const STORAGE_STATE_PATH = path.resolve(__dirname, '../.auth/admin.json');

/** Read the JWT token from the saved Playwright storageState file. */
function getTokenFromStorageState(): string | null {
    try {
        const state = JSON.parse(fs.readFileSync(STORAGE_STATE_PATH, 'utf-8'));
        const origin = state.origins?.find((o: { origin: string }) =>
            o.origin.includes('localhost'),
        );
        const entry = origin?.localStorage?.find(
            (e: { name: string }) => e.name === 'raid_ledger_token',
        );
        return entry?.value ?? null;
    } catch {
        return null;
    }
}

/**
 * Fetch a character ID that has WoW equipment via the API.
 * Returns the first character with a non-empty equipment.items array.
 */
async function findCharacterWithEquipment(token: string): Promise<string | null> {
    const res = await fetch(`${API_BASE}/users/me/characters`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;

    const { data } = (await res.json()) as {
        data: Array<{ id: string; equipment?: { items?: unknown[] } }>;
    };

    const match = data.find(
        (c) => c.equipment && c.equipment.items && c.equipment.items.length > 0,
    );
    return match?.id ?? null;
}

// ---------------------------------------------------------------------------
// Regression: ROK-921 — Wowhead tooltip overlaps carousel modal on mobile
// ---------------------------------------------------------------------------

test.describe('Regression: ROK-921 — mobile equipment tooltip suppression', () => {
    let characterId: string | null = null;

    test.beforeAll(async () => {
        const token = getTokenFromStorageState();
        if (token) {
            characterId = await findCharacterWithEquipment(token);
        }
    });

    test('only carousel modal shows on mobile item tap — no Wowhead tooltip', async ({ page }, testInfo) => {
        test.skip(testInfo.project.name === 'desktop', 'Mobile-only regression test');
        test.skip(!characterId, 'No character with equipment in seed data');

        await page.goto(`/characters/${characterId}`);

        // Wait for equipment heading to appear
        await expect(page.getByRole('heading', { name: 'Equipment' })).toBeVisible({ timeout: 15_000 });

        // Wait for at least one equipment slot link (wowhead URL)
        const equipmentLink = page.locator('a[href*="wowhead.com"]').first();
        await expect(equipmentLink).toBeVisible({ timeout: 10_000 });

        // Tap the first equipment slot (the parent clickable div)
        const equipmentSlot = equipmentLink.locator('xpath=ancestor::div[contains(@class, "cursor-pointer")]');
        await equipmentSlot.click();

        // The carousel modal should appear (has "/ N" counter text)
        const modalCounter = page.locator('text=/\\d+ \\/ \\d+/');
        await expect(modalCounter).toBeVisible({ timeout: 5_000 });

        // The Wowhead tooltip must NOT be visible
        const wowheadTooltip = page.locator('.wowhead-tooltip');
        // Wait briefly for any tooltip that might render asynchronously
        await page.waitForTimeout(500);
        const tooltipCount = await wowheadTooltip.count();
        for (let i = 0; i < tooltipCount; i++) {
            await expect(wowheadTooltip.nth(i)).not.toBeVisible();
        }
    });

    test('Wowhead tooltip still works on desktop hover', async ({ page }, testInfo) => {
        test.skip(testInfo.project.name === 'mobile', 'Desktop-only test');
        test.skip(!characterId, 'No character with equipment in seed data');

        await page.goto(`/characters/${characterId}`);
        await expect(page.getByRole('heading', { name: 'Equipment' })).toBeVisible({ timeout: 15_000 });

        const equipmentLink = page.locator('a[href*="wowhead.com"]').first();
        await expect(equipmentLink).toBeVisible({ timeout: 10_000 });

        // Hover over the equipment link to trigger Wowhead tooltip
        await equipmentLink.hover();

        // Wowhead tooltip should appear (may take a moment to render)
        const wowheadTooltip = page.locator('.wowhead-tooltip').first();
        await expect(wowheadTooltip).toBeVisible({ timeout: 5_000 });
    });
});
