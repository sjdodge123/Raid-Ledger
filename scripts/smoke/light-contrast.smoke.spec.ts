/**
 * Light-scheme colour-contrast guard (ROK-1472).
 *
 * Boots each route in `default-light` through the theme store's own
 * localStorage keys, waits for the route's data to render and for finite
 * animations to settle, then runs axe's `color-contrast` rule on the WHOLE
 * page. A red run prints one line per failing node (selector, colours, ratio).
 *
 * Do not narrow the scan with `exclude` / `include` / `disableRules` to get a
 * route green — fix the token or the markup, or drop the route with a note in
 * the story and the tech-debt backlog.
 */
import type { Page } from '@playwright/test';
import { test, expect } from './base';
import {
    expectLightScheme,
    expectNoContrastViolations,
    useLightScheme,
    waitForFiniteAnimations,
} from './axe-contrast';

interface LightRoute {
    path: string;
    /** Resolves once the route's own content (not a skeleton) is on screen. */
    ready: (page: Page) => Promise<void>;
}

const ROUTES: LightRoute[] = [
    {
        path: '/players',
        ready: async (page) => {
            await expect(page.getByRole('heading', { name: 'Players' })).toBeVisible({ timeout: 15_000 });
            await expect(page.locator('a[href*="/users/"]').first()).toBeVisible({ timeout: 10_000 });
        },
    },
    {
        path: '/events',
        ready: async (page) => {
            await expect(page.getByRole('heading', { name: /Events/i }).first()).toBeVisible({ timeout: 15_000 });
            // Phone cards and the md+ grid are both in the DOM; one is hidden.
            const card = page
                .getByTestId('mobile-event-card')
                .or(page.locator('.hidden.md\\:grid [role="button"]'))
                .filter({ visible: true });
            await expect(card.first()).toBeVisible({ timeout: 10_000 });
        },
    },
    {
        path: '/games',
        ready: async (page) => {
            const gameLink = page.locator('a[href*="/games/"]').filter({ visible: true });
            await expect(gameLink.first()).toBeVisible({ timeout: 15_000 });
        },
    },
    {
        path: '/admin/settings/general',
        ready: async (page) => {
            await expect(
                page.getByRole('heading', { name: 'Site Settings', level: 2 }),
            ).toBeVisible({ timeout: 15_000 });
            await expect(page.getByRole('combobox').first()).toBeVisible({ timeout: 10_000 });
        },
    },
];

test.describe('Light scheme colour contrast (default-light)', () => {
    // axe walks every text node on the page; /games renders hundreds of cards.
    test.describe.configure({ timeout: 90_000 });

    test.beforeEach(async ({ page }) => {
        await useLightScheme(page);
    });

    for (const route of ROUTES) {
        test(`${route.path} has no color-contrast violations`, async ({ page }) => {
            await page.goto(route.path);
            await expectLightScheme(page);
            await route.ready(page);
            await waitForFiniteAnimations(page);
            await expectNoContrastViolations(page);
        });
    }
});
