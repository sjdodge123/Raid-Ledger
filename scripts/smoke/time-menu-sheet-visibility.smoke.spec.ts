/**
 * ROK-1641 — a time card's ⋯ sheet opens with its actions ON SCREEN.
 *
 * On iPhone/iPad Safari the short ⋯ bottom sheet (Rally, Lock this time)
 * opened with its actions under the browser toolbar: `vh` excludes the
 * toolbars and the `fixed inset-0` layer reached under them. The sheet now
 * lays out against the visible viewport (`dvh`). These cases open the leader
 * card's ⋯ and a ladder row's ⋯ as the poll's organiser, at a phone and a
 * tablet viewport, and assert both actions are `toBeInViewport()` — not merely
 * attached or "visible" somewhere below the fold.
 *
 * Below 1024px (`DESKTOP_MQ`) the menu is the bottom sheet; both viewports here
 * are under it, and each case asserts the sheet (not the desktop popover) is
 * what opened, so a breakpoint move cannot make it assert nothing. The desktop
 * project is skipped: its popover is not a sheet.
 *
 * WHAT THIS DOES NOT PROVE: Playwright runs Chromium, which has no iOS
 * dynamic toolbar, so the toolbar bug this story fixes cannot occur here and
 * `toBeInViewport()` would pass on origin/main as far as the toolbar goes. The
 * spec guards LAYOUT regressions (e.g. the body-overflow clip a non-counted
 * scroll lock caused, fixed on this branch). The iOS/iPadOS toolbar behaviour
 * is verified by the operator's iPad fleet test plan — do not fake an iOS
 * toolbar here.
 */
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './base';
import { isPhoneLayout } from './helpers';
import { apiDelete, apiPatch, getAdminToken } from './api-helpers';
import {
    nonLeadingRow,
    openRowMenu,
    openPollPage,
    seedNonLeadingRowPoll,
    type TwoSlotPoll,
} from './scheduling-poll-fixtures';

/** Phone: the ladder is unmounted while the game-time check sheet is up (ROK-1617) — confirm it first. */
test.beforeAll(async () => {
    const token = await getAdminToken();
    await apiPatch(token, '/users/me/game-time/confirm', {});
});

const VIEWPORTS = [
    { label: 'phone', viewport: { width: 390, height: 844 } },
    { label: 'tablet', viewport: { width: 820, height: 1180 } },
] as const;

/** Both actions of an open ⋯ sheet, by accessible name (`SchedulingTimeMenu.tsx`). */
async function expectActionsInViewport(sheet: Locator): Promise<void> {
    const lock = sheet.getByRole('button', { name: /^Lock this time/ });
    const rally = sheet.getByRole('button', { name: /^Rall(y|ying|ied)/ });
    await expect(lock, '"Lock this time" is below the visible viewport').toBeInViewport();
    await expect(rally, '"Rally" is below the visible viewport').toBeInViewport();
}

/** Open the leader card's ⋯ (`scheduling-leader-menu`); returns the sheet it opened. */
async function openLeaderSheet(page: Page): Promise<Locator> {
    const trigger = page.getByTestId('scheduling-leader-card').getByRole('button', { name: 'Poll actions' });
    await expect(trigger).toBeVisible({ timeout: 15_000 });
    await trigger.click();
    const sheet = page.getByTestId('scheduling-leader-menu-sheet');
    await expect(sheet, 'below 1024px the ⋯ menu should open as a bottom sheet').toBeVisible({ timeout: 10_000 });
    return sheet;
}

for (const { label, viewport } of VIEWPORTS) {
    test.describe(`Time card ⋯ sheet — actions on screen (${label}, ROK-1641)`, () => {
        test.use({ viewport });
        test.describe.configure({ timeout: 120_000 });

        test.beforeEach(() => {
            test.skip(!isPhoneLayout(test.info()), 'The ⋯ menu is a popover on the desktop project');
        });

        test(`${label}: leader card ⋯ shows Rally and Lock this time in the viewport`, async ({ page }) => {
            const token = await getAdminToken();
            let seeded: TwoSlotPoll | undefined;
            try {
                seeded = await seedNonLeadingRowPoll(token, 6, 8);
                await openPollPage(page, seeded);
                await expectActionsInViewport(await openLeaderSheet(page));
            } finally {
                if (seeded) await apiDelete(token, `/lineups/${seeded.lineupId}`).catch(() => {});
            }
        });

        test(`${label}: a ladder row's ⋯ shows Rally and Lock this time in the viewport`, async ({ page }) => {
            const token = await getAdminToken();
            let seeded: TwoSlotPoll | undefined;
            try {
                seeded = await seedNonLeadingRowPoll(token, 6, 8);
                await openPollPage(page, seeded);
                const row = nonLeadingRow(page, seeded);
                await expect(row).toBeVisible({ timeout: 15_000 });
                const { container, isSheet } = await openRowMenu(page, row);
                expect(isSheet, 'below 1024px the row ⋯ menu should open as a bottom sheet').toBe(true);
                await expectActionsInViewport(container);
            } finally {
                if (seeded) await apiDelete(token, `/lineups/${seeded.lineupId}`).catch(() => {});
            }
        });
    });
}
