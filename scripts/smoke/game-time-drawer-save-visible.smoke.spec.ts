/**
 * ROK-1640 — the game-time drawer's Save is on screen, and a close with
 * unsaved edits asks first.
 *
 * Below 1024px `/profile/gaming/game-time` MOUNTS the "My game time" drawer
 * (`game-time-panel.tsx` → `GameTimeCheckSheet` + `PhoneWeekCheckStep`). Save
 * used to be `sticky` inside the scroll body and sat under the iPad toolbar;
 * it is now a pinned flex footer outside it. And ×, backdrop, swipe and Escape
 * silently dropped a half-entered week; they now run `useDirtyCloseGuard`,
 * which asks "Discard your changes?".
 *
 * Runs at a phone and a tablet viewport; the desktop project is skipped (at
 * ≥1024px the route is the seven-column panel, not a drawer). Nothing here
 * presses Save — the edit is always discarded, so no week is written.
 */
import type { Page } from '@playwright/test';
import { test, expect } from './base';
import { isPhoneLayout } from './helpers';

const VIEWPORTS = [
    { label: 'phone', viewport: { width: 390, height: 844 } },
    { label: 'tablet', viewport: { width: 820, height: 1180 } },
] as const;

const CONFIRM_TITLE = 'Discard your changes?';

async function openDrawer(page: Page): Promise<void> {
    await page.goto('/profile/gaming/game-time');
    await expect(page.getByTestId('game-time-check-sheet')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('phone-week-editor')).toBeVisible();
}

/** The block layer mounts once a row height is measured — a tap before that falls through. */
async function waitForLayer(page: Page): Promise<void> {
    await expect(page.getByTestId('block-editor-layer')).toBeAttached({ timeout: 10_000 });
    await expect
        .poll(
            async () => (await page.locator('[data-testid^="slot-day-target-"]').first().boundingBox())?.height ?? 0,
            { timeout: 10_000, message: 'the block layer never measured a row height' },
        )
        .toBeGreaterThan(0);
}

/** Page the strip to a day with no block and return one of its visible, uncovered cells. */
async function freeCellOnSomeDay(page: Page): Promise<string> {
    for (let d = 0; d < 7; d++) {
        const day = page.getByTestId(`phone-week-strip-day-${d}`);
        await day.click();
        await expect(day).toHaveAttribute('aria-current', 'date');
        if ((await page.locator(`[data-testid^="slot-block-${d}-"]`).count()) > 0) continue;
        const id = await page.evaluate((d0: number) => {
            for (const cell of Array.from(document.querySelectorAll(`[data-testid^="phone-cell-${d0}-"]`))) {
                const r = cell.getBoundingClientRect();
                if (r.width > 0 && r.height > 0) return (cell as HTMLElement).dataset.testid ?? null;
            }
            return null;
        }, d);
        if (id) return id;
    }
    throw new Error('no day without a block to tap an edit into');
}

/** Tap an empty hour: a new block makes the draft dirty, which enables Save. */
async function makeAnEdit(page: Page): Promise<void> {
    await waitForLayer(page);
    const cell = page.getByTestId(await freeCellOnSomeDay(page));
    await cell.scrollIntoViewIfNeeded();
    // force: the day target above the cell is the real recipient (see game-time-blocks.smoke.spec.ts).
    await cell.click({ force: true });
    await expect(page.getByRole('button', { name: 'Save my week' }), 'the edit should dirty the draft').toBeEnabled();
}

for (const { label, viewport } of VIEWPORTS) {
    test.describe(`Game-time drawer — Save on screen + dirty close (${label}, ROK-1640)`, () => {
        test.use({ viewport });

        test.beforeEach(() => {
            test.skip(!isPhoneLayout(test.info()), 'At ≥1024px the route is the desktop panel, not a drawer');
        });

        test(`${label}: Save is in the viewport when the drawer opens`, async ({ page }) => {
            await openDrawer(page);
            await expect(page.getByRole('button', { name: 'Save my week' }), 'Save is below the visible viewport').toBeInViewport();
        });

        test(`${label}: × with unsaved edits asks first — Keep editing stays, Discard closes`, async ({ page }) => {
            await openDrawer(page);
            await makeAnEdit(page);
            const sheet = page.getByTestId('game-time-check-sheet');
            const confirm = page.getByRole('dialog', { name: CONFIRM_TITLE });

            await sheet.getByRole('button', { name: 'Close sheet' }).click();
            await expect(confirm).toBeVisible();

            await confirm.getByRole('button', { name: 'Keep editing' }).click();
            await expect(confirm).toBeHidden();
            await expect(sheet, 'Keep editing should leave the drawer open').toBeVisible();
            await expect(page.getByRole('button', { name: 'Save my week' }), 'the draft should survive Keep editing').toBeEnabled();

            await sheet.getByRole('button', { name: 'Close sheet' }).click();
            await expect(confirm).toBeVisible();
            await confirm.getByRole('button', { name: 'Discard', exact: true }).click();
            await expect(confirm).toBeHidden();
            await expect(sheet, 'Discard should close the drawer').toBeHidden();
        });
    });
}
