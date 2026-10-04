/**
 * Light-scheme colour-contrast guard (ROK-1472).
 *
 * Boots each route in `default-light` (every project) and in the tinted light
 * schemes sky / holy / dawn / celestial (desktop only, see below; quest-log gets a
 * token-only check at the end of this file) through the theme store's own
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
import { expectTokenContrast } from './scheme-token-contrast';

interface LightRoute {
    path: string;
    /** Resolves once the route's own content (not a skeleton) is on screen. */
    ready: (page: Page) => Promise<void>;
    known?: KnownContrastViolation[];
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
                .or(page.getByTestId('event-card'))
                .filter({ visible: true });
            await expect(card.first()).toBeVisible({ timeout: 10_000 });
        },
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

/*
 * Tinted light schemes (operator ruling 2026-10-04: automated, not a manual
 * test-plan step). They share the default-light component overrides in
 * index.css and differ only in their colour tokens, so viewport-dependent
 * markup is already covered by default-light on desktop, mobile AND tablet;
 * what a tinted scheme can break is colour, which the viewport does not change.
 * They therefore run on the desktop project only: every route x 4 schemes =
 * 16 scans, against 48 for the full 3-project matrix.
 */
const TINTED_LIGHT_SCHEMES = ['sky', 'holy', 'dawn', 'celestial'] as const;

/** Text tokens that must reach AA on every panel they sit on. */
const DIM_BACKGROUNDS = ['--color-surface', '--color-panel'];

async function scanRoute(page: Page, route: LightRoute, scheme: string): Promise<void> {
    await page.goto(route.path);
    await expectLightScheme(page, scheme);
    await route.ready(page);
    await waitForFiniteAnimations(page);
    // Still light after the route settled — a flipped scheme is not a contrast result.
    await expectLightScheme(page, scheme);
    await expectNoContrastViolations(page, route.known);
}

test.describe('Light scheme colour contrast (default-light)', () => {
    // axe walks every text node on the page; /games renders hundreds of cards.
    test.describe.configure({ timeout: 90_000 });

    test.beforeEach(async ({ page }) => {
        await useLightScheme(page);
    });

    for (const route of ROUTES) {
        test(`${route.path} has no color-contrast violations`, async ({ page }) => {
            await scanRoute(page, route, 'light');
        });
    }
});

for (const scheme of TINTED_LIGHT_SCHEMES) {
    test.describe(`Light scheme colour contrast (${scheme})`, () => {
        test.describe.configure({ timeout: 90_000 });

        test.beforeEach(async ({ page }, testInfo) => {
            test.skip(testInfo.project.name !== 'desktop', 'tinted schemes differ only in colour — desktop is enough');
            await useLightScheme(page, scheme);
        });

        // Token-level, so it fails even where no scanned route renders dim text.
        // Never allow-list a --color-dim miss: fix the scheme's token instead.
        test('--color-dim reaches 4.5:1 on surface and panel', async ({ page }) => {
            await page.goto('/players');
            await expectLightScheme(page, scheme);
            await expectTokenContrast(page, '--color-dim', DIM_BACKGROUNDS);
        });

        for (const route of ROUTES) {
            test(`${route.path} has no color-contrast violations`, async ({ page }) => {
                await scanRoute(page, route, scheme);
            });
        }
    });
}

/*
 * quest-log is `data-scheme="light"` plus `data-variant="quest-log"`, so it shares
 * default-light's routes; its parchment tokens are what it can break. Token-level
 * only (operator ruling 2026-10-04: dim AND muted darkened to AA), desktop only.
 */
test.describe('Light scheme colour contrast (quest-log tokens)', () => {
    test.beforeEach(async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop', 'a token check does not vary with the viewport');
        await useLightScheme(page, 'quest-log');
    });

    for (const text of ['--color-dim', '--color-muted']) {
        test(`${text} reaches 4.5:1 on surface and panel`, async ({ page }) => {
            await page.goto('/players');
            await expectLightScheme(page, 'light');
            await expect(page.locator('html')).toHaveAttribute('data-variant', 'quest-log');
            await expectTokenContrast(page, text, DIM_BACKGROUNDS);
        });
    }
});
