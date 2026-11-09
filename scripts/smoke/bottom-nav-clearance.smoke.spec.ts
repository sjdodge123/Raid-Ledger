/**
 * ROK-2156 — the phone shell clears its bottom overlays — MOBILE project only.
 *
 * Below 768px the fixed bottom tab bar (+ its raised Hubs circle) and, on pages
 * with a FilterEntry, the Filters FAB sit over the end of the page. Since
 * ROK-2156 the shell `<main>` (`web/src/components/layout/Layout.tsx`) pads past
 * them instead of each page. On three representative pages — a hub with a
 * Filters FAB, /games (Filters FAB) and /events (no FAB) — the last rendered
 * content inside `<main>` must end above the tab bar's top edge and above the
 * FAB's top edge once the page is scrolled to its very end.
 *
 * The tab bar AUTO-HIDES while the page scrolls down (`useScrollDirection`), and
 * the Filters FAB drops from `bottom: 72` to `bottom: 16` with it, so measuring
 * them at the bottom of a scroll is a race against a 300ms transition. The spec
 * is deterministic instead by splitting the measurement in two, both
 * scroll-invariant:
 *   1. Scroll to the end (so infinite lists load), then read the last content
 *      element's bottom in DOCUMENT coordinates and its distance to the document
 *      end. At max scroll the viewport bottom IS the document end.
 *   2. Scroll back to the top — a scroll-up event, which shows the bar — wait
 *      until the bar is untranslated and no transition is running on it or the
 *      FAB (`getAnimations()`), and read how far up from the viewport bottom
 *      each overlay reaches. Fixed overlays sit the same at any scroll offset,
 *      and the shown state is the worst case (bar on screen, FAB at its highest).
 * Content is clear when its distance to the document end ≥ each overlay's reach.
 */
import type { Page, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { apiDelete, apiPost, getAdminToken } from './api-helpers';
import { signInOnboardedMember } from './browser-session';
import { isMobile } from './helpers';

interface ContentEnd {
    /** Distance (px) from the last content element's bottom to the document end. */
    gapToDocEnd: number;
    /** Whether the document is taller than the viewport. */
    scrolls: boolean;
    /** Which element ends last — for the failure message. */
    lastElement: string;
}

interface OverlayReach {
    /** How far up from the viewport bottom the bar (incl. the raised Hubs circle) reaches. */
    tabBar: number;
    /** How far up the Filters FAB reaches, or null when the page renders none. */
    filterFab: number | null;
}

function skipUnlessPhone(testInfo: TestInfo): void {
    test.skip(!isMobile(testInfo), 'The bottom tab bar renders below 768px only — the mobile project');
}

/** Scroll to the very end and let any infinite list settle its next page. */
async function scrollToEnd(page: Page): Promise<void> {
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
    await expect.poll(() => page.evaluate(() => Math.ceil(window.scrollY + document.documentElement.clientHeight) >= document.documentElement.scrollHeight),
        { message: 'the page is scrolled to its very end' }).toBe(true);
}

/**
 * The bottom-most visible content inside `<main>`, in document coordinates.
 * Skips fixed-position subtrees (portaled sheets, overlays) and clamps each box
 * to any clipping (`overflow` ≠ visible) ancestor, so a clipped carousel or an
 * off-canvas panel never counts as "content below the fold".
 */
function measureContentEnd(page: Page): Promise<ContentEnd> {
    return page.evaluate(() => {
        const main = document.querySelector('main#main-content');
        if (!main) throw new Error('no <main id="main-content"> in the shell');
        const docEnd = document.documentElement.scrollHeight;
        let bottom = 0;
        let lastElement = '(none)';
        for (const el of Array.from(main.querySelectorAll('*'))) {
            if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;
            let elBottom = rect.bottom;
            let fixed = false;
            for (let node: Element | null = el; node && node !== main; node = node.parentElement) {
                const style = getComputedStyle(node);
                if (style.position === 'fixed') { fixed = true; break; }
                if (node !== el && style.overflowY !== 'visible') elBottom = Math.min(elBottom, node.getBoundingClientRect().bottom);
            }
            if (fixed || elBottom + window.scrollY <= bottom) continue;
            bottom = elBottom + window.scrollY;
            const testId = el.getAttribute('data-testid');
            lastElement = `<${el.tagName.toLowerCase()}${testId ? ` data-testid="${testId}"` : ''}> "${(el.textContent ?? '').trim().slice(0, 40)}"`;
        }
        return { gapToDocEnd: docEnd - bottom, scrolls: docEnd > document.documentElement.clientHeight, lastElement };
    });
}

/** Show the bar (scroll up to the top) and wait until it and the FAB stop moving. */
async function showOverlays(page: Page): Promise<void> {
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await expect.poll(() => page.evaluate(() => {
        const bar = document.querySelector('[data-testid="bottom-tab-bar"]');
        if (!bar) return 'no bottom-tab-bar';
        const fab = document.querySelector('[data-filter-fab]');
        const shift = new DOMMatrixReadOnly(getComputedStyle(bar).transform).m42;
        const moving = bar.getAnimations().length + (fab?.getAnimations().length ?? 0);
        return shift === 0 && moving === 0 ? 'settled' : `shift ${shift}px, ${moving} running transition(s)`;
    }), { message: 'the tab bar is shown and nothing is mid-transition' }).toBe('settled');
}

/** How far each fixed overlay reaches up from the viewport bottom (bar shown). */
function measureOverlayReach(page: Page): Promise<OverlayReach> {
    return page.evaluate(() => {
        const viewportBottom = document.documentElement.clientHeight;
        const bar = document.querySelector('[data-testid="bottom-tab-bar"]');
        if (!bar) throw new Error('no bottom-tab-bar');
        // The raised Hubs circle overflows the bar's own box, so take the highest descendant.
        let top = bar.getBoundingClientRect().top;
        for (const el of Array.from(bar.querySelectorAll('*'))) {
            const rect = el.getBoundingClientRect();
            if (rect.height > 0 && rect.top < top) top = rect.top;
        }
        const fab = document.querySelector('[data-filter-fab]');
        const filterFab = fab && fab.checkVisibility() ? viewportBottom - fab.getBoundingClientRect().top : null;
        return { tabBar: viewportBottom - top, filterFab };
    });
}

async function expectContentClearsOverlays(page: Page, opts: { expectFab: boolean; mustScroll: boolean }): Promise<void> {
    await expect(page.getByTestId('bottom-tab-bar')).toBeVisible();
    if (opts.expectFab) await expect(page.getByTestId('filter-fab')).toBeVisible({ timeout: 15_000 });
    await scrollToEnd(page);
    const end = await measureContentEnd(page);
    if (opts.mustScroll) expect(end.scrolls, 'the page is taller than the viewport, so its end really meets the tab bar').toBe(true);
    await showOverlays(page);
    const reach = await measureOverlayReach(page);
    const gap = Math.round(end.gapToDocEnd);
    expect(gap, `the last content ${end.lastElement} ends ${gap}px above the page end, but the tab bar covers the bottom ${Math.round(reach.tabBar)}px`)
        .toBeGreaterThanOrEqual(Math.round(reach.tabBar));
    if (!opts.expectFab) return;
    expect(reach.filterFab, 'the Filters FAB is on screen').not.toBeNull();
    const fabReach = Math.round(reach.filterFab ?? 0);
    expect(gap, `the last content ${end.lastElement} ends ${gap}px above the page end, but the Filters FAB covers the bottom ${fabReach}px`)
        .toBeGreaterThanOrEqual(fabReach);
}

test.describe('Phone bottom-nav clearance (ROK-2156)', () => {
    test('hub Members tab: the last member row clears the tab bar and the Filters FAB', async ({ page }, testInfo) => {
        skipUnlessPhone(testInfo);
        const token = await getAdminToken();
        const name = `Smoke clear ${testInfo.project.name} w${testInfo.workerIndex} ${Date.now()}`.slice(0, 48);
        const body = (await apiPost(token, '/admin/test/wow/seed-guild', { name })) as { guildId?: number; users?: Record<string, { userId: number }> };
        const users = body.users ?? {};
        try {
            const gm = users['gm'];
            if (typeof body.guildId !== 'number' || !gm) throw new Error(`seed-guild: ${JSON.stringify(body)}`);
            await signInOnboardedMember(page, gm.userId);
            await page.goto(`/hubs/${body.guildId}#members`);
            await expect(page.getByTestId('guild-members')).toBeVisible({ timeout: 15_000 });
            await expect(page.getByTestId('guild-members-count')).toHaveText('5 members');
            // Five seeded rows may fit one phone screen; the gap-vs-reach check holds either way.
            await expectContentClearsOverlays(page, { expectFab: true, mustScroll: false });
        } finally {
            for (const user of Object.values(users)) await apiDelete(token, `/users/${user.userId}`).catch(() => undefined);
        }
    });

    test('/games: the last game row clears the tab bar and the Filters FAB', async ({ page }, testInfo) => {
        skipUnlessPhone(testInfo);
        await page.goto('/games');
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });
        await expectContentClearsOverlays(page, { expectFab: true, mustScroll: true });
    });

    test('/events: the last event clears the tab bar on a page with no FAB', async ({ page }, testInfo) => {
        skipUnlessPhone(testInfo);
        await page.goto('/events');
        await expect(page.getByRole('heading', { name: /Events/i }).first()).toBeVisible({ timeout: 15_000 });
        await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
        await expectContentClearsOverlays(page, { expectFab: false, mustScroll: true });
    });
});
