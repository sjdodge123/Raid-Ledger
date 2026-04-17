/**
 * User profile taste-profile section smoke tests (ROK-949).
 *
 * Verifies the `<TasteProfileSection>` rendering on another user's profile:
 *   - "Taste Profile" heading always visible
 *   - Either the radar chart SVG or the empty-state message renders
 *   - When non-empty, an archetype pill is present on the page
 *   - "Show all" partners button (when present) opens a modal
 *   - Page loads without tripping the error boundary
 *
 * Mobile parity: all selectors rely on ARIA roles or text matchers so the
 * suite runs on both the desktop and mobile Playwright projects without
 * skips.  Backend already ships via ROK-948; this suite is TDD-first and
 * expected to fail until ROK-949 implementation lands.
 */
import { test, expect } from './base';

const ARCHETYPE_NAMES = [
    'Dedicated',
    'Specialist',
    'Explorer',
    'Social Drifter',
    'Casual',
];

/**
 * Navigate to the Players page and follow a user link to reach another
 * user's profile.  Mirrors the helper from `user-profile.smoke.spec.ts`.
 */
async function navigateToUserProfile(
    page: import('@playwright/test').Page,
): Promise<string> {
    await page.goto('/players');
    await expect(page.getByRole('heading', { name: 'Players' })).toBeVisible({
        timeout: 15_000,
    });

    const playerLink = page.locator('a[href*="/users/"]').first();
    await expect(playerLink).toBeVisible({ timeout: 10_000 });

    const href = await playerLink.getAttribute('href');
    expect(href).toBeTruthy();

    // Prefer a link that isn't the currently-logged-in user (/users/41).
    const allLinks = page.locator('a[href*="/users/"]');
    const count = await allLinks.count();
    let targetHref = href!;
    for (let i = 0; i < count; i++) {
        const h = await allLinks.nth(i).getAttribute('href');
        if (h && !h.endsWith('/users/41')) {
            targetHref = h;
            break;
        }
    }

    await page.goto(targetHref);
    // Wait for profile header to mount so taste profile has a chance to
    // fetch and render before assertions run.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({
        timeout: 15_000,
    });
    return targetHref;
}

test.describe('User profile taste section', () => {
    test('renders the "Taste Profile" heading (AC2)', async ({ page }) => {
        await navigateToUserProfile(page);

        // The section heading is always present (empty state and loaded
        // state both render it).  This is the source-of-truth selector
        // for the implementation.
        await expect(
            page.getByRole('heading', { name: 'Taste Profile' }),
        ).toBeVisible({ timeout: 15_000 });
    });

    test('renders either the radar chart or the empty-state message (AC3/AC4)', async ({
        page,
    }) => {
        await navigateToUserProfile(page);

        await expect(
            page.getByRole('heading', { name: 'Taste Profile' }),
        ).toBeVisible({ timeout: 15_000 });

        // Scope to the taste profile section's region so we don't pick up
        // unrelated SVGs elsewhere on the profile page.
        const tasteSection = page
            .locator('section, [data-testid="taste-profile-section"]')
            .filter({
                has: page.getByRole('heading', { name: 'Taste Profile' }),
            })
            .first();

        const radarSvg = tasteSection.locator('svg').first();
        const emptyState = page.getByText(
            'Not enough data yet — play more games!',
            { exact: false },
        );

        // Either the chart is visible OR the empty-state message is.
        const chartOrEmptyState = radarSvg.or(emptyState).first();
        await expect(chartOrEmptyState).toBeVisible({ timeout: 15_000 });
    });

    test('shows an archetype pill when the profile has data (AC1)', async ({
        page,
    }) => {
        await navigateToUserProfile(page);

        await expect(
            page.getByRole('heading', { name: 'Taste Profile' }),
        ).toBeVisible({ timeout: 15_000 });

        // Skip the archetype-pill assertion if the empty state is shown —
        // per spec, empty profiles do NOT render a pill.
        const emptyState = page.getByText(
            'Not enough data yet — play more games!',
            { exact: false },
        );
        if (await emptyState.isVisible().catch(() => false)) {
            test.info().annotations.push({
                type: 'skip-reason',
                description:
                    'Empty taste profile — no archetype pill expected (AC4).',
            });
            return;
        }

        // Non-empty: exactly one of the 5 archetype names must be on the
        // page.  We look for the regex union so the test is robust to the
        // pill's exact DOM structure (span / badge / pill component).
        const archetypeRegex = new RegExp(
            `\\b(${ARCHETYPE_NAMES.join('|')})\\b`,
        );
        await expect(page.getByText(archetypeRegex).first()).toBeVisible({
            timeout: 10_000,
        });
    });

    test('"Show all" partners button opens a modal when present (AC6)', async ({
        page,
    }) => {
        await navigateToUserProfile(page);

        await expect(
            page.getByRole('heading', { name: 'Taste Profile' }),
        ).toBeVisible({ timeout: 15_000 });

        // The "Show all (N)" button only renders when there are more than
        // 3 co-play partners.  Make the assertion conditional so the test
        // is stable across seeded users with varying partner counts.
        const showAllButton = page.getByRole('button', {
            name: /^Show all\s*\(\d+\)$/,
        });
        const hasButton = await showAllButton
            .first()
            .isVisible()
            .catch(() => false);
        if (!hasButton) {
            test.info().annotations.push({
                type: 'skip-reason',
                description:
                    'Seeded user has ≤3 partners — no "Show all" button rendered.',
            });
            return;
        }

        await showAllButton.first().click();

        // Clicking should open a dialog/modal.  Accept either a native
        // role="dialog" or an explicit modal container.
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible({ timeout: 5_000 });
    });

    test('page loads without the error boundary (AC7)', async ({ page }) => {
        await navigateToUserProfile(page);

        await expect(page.getByRole('heading', { level: 1 })).toBeVisible({
            timeout: 15_000,
        });
        await expect(
            page.getByRole('heading', { name: 'Taste Profile' }),
        ).toBeVisible({ timeout: 15_000 });

        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
        );
        await expect(page.getByText('User Not Found')).not.toBeVisible();
    });
});
