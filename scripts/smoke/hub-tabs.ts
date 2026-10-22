/**
 * Hub tab-row helpers (ROK-1876). Below desktop width the hub `TabRow` folds
 * the tabs that do not fit into a "More ▾" menu (`web/src/components/ui/tab-row.tsx`,
 * `tab-row-more.tsx`): a folded tab has no `a[href="#id"]` in the row, its menu
 * item exists only while the menu is open, and when it is the ACTIVE tab the
 * trigger is a `<button>` named "<Label>, more sections". Assert a hub tab
 * through these helpers, never through a bare `a[href="#…"]` in the nav.
 */
import type { Page, TestInfo } from '@playwright/test';
import { expect } from './base';
import { isDesktop } from './helpers';

/** The guild/server hub page's tab-row `<nav>` label. */
export const HUB_TABS_NAV = 'Guild page sections';

/**
 * The tab `id` (its `#hash`, without the `#`) is the active hub tab. Desktop
 * shows the full row, so there the row link itself must carry
 * `aria-current="page"`; on tablet/phone the tab may instead be folded, and
 * then the More trigger must name it as active.
 */
export async function expectActiveHubTab(page: Page, testInfo: TestInfo, label: string, id: string): Promise<void> {
    const nav = page.getByRole('navigation', { name: HUB_TABS_NAV });
    const rowLink = nav.getByTestId('tab-row-scroller').locator(`a[href="#${id}"][aria-current="page"]`);
    if (isDesktop(testInfo)) {
        await expect(rowLink, `desktop shows #${id} in the full row as the active tab`).toBeVisible({ timeout: 15_000 });
        await expect(nav.getByTestId('tab-row-more-trigger'), 'desktop shows the full row, no More menu').toHaveCount(0);
        return;
    }
    const folded = nav.getByRole('button', { name: `${label}, more sections`, exact: true });
    await expect(rowLink.or(folded), `#${id} is active: its row link, or the More trigger naming "${label}"`).toBeVisible({ timeout: 15_000 });
}

/** Tab ids in row order: the visible links, then (when the row overflows) the More menu's items. */
export async function tabOrder(page: Page): Promise<string[]> {
    const hrefs = await page.getByTestId('tab-row-scroller').locator('a').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));
    const trigger = page.getByTestId('tab-row-more-trigger');
    if (await trigger.isVisible()) {
        await trigger.click();
        const menu = page.getByTestId('tab-row-more-menu');
        await expect(menu).toBeVisible();
        hrefs.push(...await menu.locator('a').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? '')));
        await page.keyboard.press('Escape');
        await expect(menu).toHaveCount(0);
    }
    return hrefs.map((h) => h.replace(/^#/, ''));
}
