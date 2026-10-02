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
 * holds only nodes waiting on a recorded operator decision, each pinned to a
 * CSS selector the element must match (never axe's generated selector string,
 * which changes with the seed) AND the exact colour pair, so any other colour
 * on that node, and any other element, still fails.
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

/** The label span inside a primary `Button` (web/src/components/ui/button.tsx). */
const PRIMARY_BUTTON_LABEL = 'button.bg-emerald-600 > [data-button-label]';

/*
 * OPEN DESIGN DECISION — label colour on a brand fill: the admin branding
 * preview's "Sample Button" (web/src/components/admin/BrandingSection.tsx)
 * forces a white label onto the accent colour, the same idiom as Button
 * `brandColor` (index.css forced-white list). White on the default accent
 * #10b981 = 2.53:1. Options: pick the label colour by contrast against the
 * fill, or ship a darker default accent. Tracked in TECH-DEBT-BACKLOG.md;
 * delete this entry once that ruling lands.
 */
const BRAND_SAMPLE = { target: 'span[data-brand-fill]', fg: '#ffffff', bg: '#10b981' } as const;

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
            // Create Event: the header link (EventsPageHeader) or the empty-state one.
            { target: 'a[href="/events/new"]', ...PRIMARY_FILL },
            // The phone toolbar's active tab (events-mobile-toolbar.tsx).
            { target: 'button.bg-emerald-600.text-white.py-2\\.5', ...PRIMARY_FILL },
        ],
    },
    {
        path: '/games',
        ready: async (page) => {
            // md+ renders game cards as links; the phone renders DrawerCards
            // (data-testid="game-ref-row"), which are buttons, not anchors.
            const gameCard = page
                .locator('a[href*="/games/"]')
                .or(page.getByTestId('game-ref-row'))
                .filter({ visible: true });
            await expect(gameCard.first()).toBeVisible({ timeout: 15_000 });
        },
        // LineupBanner: "View Lineup" when a lineup is active (its id differs per
        // seed), "Start Lineup" when none is — the banner state is global.
        known: [
            { target: 'a[href^="/community-lineup/"]', ...PRIMARY_FILL },
            { target: '.border-dashed > button.bg-emerald-600.text-white', ...PRIMARY_FILL },
        ],
    },
    {
        path: '/admin/settings/general',
        ready: async (page) => {
            await expect(
                page.getByRole('heading', { name: 'Site Settings', level: 2 }),
            ).toBeVisible({ timeout: 15_000 });
            await expect(page.getByRole('combobox').first()).toBeVisible({ timeout: 10_000 });
        },
        known: [{ target: PRIMARY_BUTTON_LABEL, ...PRIMARY_FILL }, BRAND_SAMPLE],
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
