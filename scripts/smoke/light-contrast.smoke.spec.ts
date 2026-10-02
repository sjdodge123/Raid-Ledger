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
 * the story and the tech-debt backlog. `known` is not a way round that: it
 * holds only nodes waiting on a recorded operator decision, each pinned to its
 * exact selector AND colour pair, so any other colour on that node still fails.
 */
import type { Page } from '@playwright/test';
import { test, expect } from './base';
import {
    type KnownContrastViolation,
    expectLightScheme,
    expectNoContrastViolations,
    useLightScheme,
    waitForFiniteAnimations,
} from './axe-contrast';

interface LightRoute {
    path: string;
    /** Resolves once the route's own content (not a skeleton) is on screen. */
    ready: (page: Page) => Promise<void>;
    known?: KnownContrastViolation[];
}

/*
 * OPEN OPERATOR CALL — "primary Button contrast 3.65:1 app-wide": the primary
 * action fill, emerald-600 (#009966) under a white label, measures 3.65:1
 * (AA needs 4.5:1). The colour is the operator's decision, so these nodes are
 * listed rather than repainted; TECH-DEBT-BACKLOG.md (2026-10-02,
 * fix/rok-1472-1001) tracks it. Delete each entry once the fill changes.
 */
const PRIMARY_FILL = { fg: '#ffffff', bg: '#009966' } as const;

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
                .or(page.getByTestId('event-card'))
                .filter({ visible: true });
            await expect(card.first()).toBeVisible({ timeout: 10_000 });
        },
        known: [
            { target: '.shadow-emerald-600\\/25', ...PRIMARY_FILL },
            { target: '.text-white.bg-emerald-600.py-2\\.5', ...PRIMARY_FILL },
        ],
    },
    {
        path: '/games',
        ready: async (page) => {
            const gameLink = page.locator('a[href*="/games/"]').filter({ visible: true });
            await expect(gameLink.first()).toBeVisible({ timeout: 15_000 });
        },
        // The active lineup's call-to-action; its id differs per seed.
        known: [{ target: /^a\[href="\/community-lineup\/\d+"\]$/, ...PRIMARY_FILL }],
    },
    {
        path: '/admin/settings/general',
        ready: async (page) => {
            await expect(
                page.getByRole('heading', { name: 'Site Settings', level: 2 }),
            ).toBeVisible({ timeout: 15_000 });
            await expect(page.getByRole('combobox').first()).toBeVisible({ timeout: 10_000 });
        },
        known: [
            { target: 'button[type="submit"] > .inline-flex.gap-2[data-button-label="true"]', ...PRIMARY_FILL },
            {
                target: 'div:nth-child(3) > .bg-emerald-600.hover\\:bg-emerald-500[type="button"] > .inline-flex.gap-2[data-button-label="true"]',
                ...PRIMARY_FILL,
            },
        ],
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
            // Still light after the route settled — a flipped scheme is not a contrast result.
            await expectLightScheme(page);
            await expectNoContrastViolations(page, route.known);
        });
    }
});
