/**
 * User profile page smoke tests — viewing another user's profile.
 *
 * Navigates from the Players page to a seeded user's profile and verifies
 * the page renders key sections (username, game activity, characters)
 * without error boundaries.
 *
 * Mobile parity: all selectors are viewport-agnostic (ARIA roles, text
 * matchers, CSS-class-free) so these tests run on both the desktop and
 * mobile Playwright projects without skips.  Verified via MCP exploration
 * (ROK-903).
 */
import { test, expect } from './base';

/**
 * Navigate to the Players page and follow the first user link to reach
 * another user's profile.  Returns the resolved profile URL.
 */
async function navigateToUserProfile(page: import('@playwright/test').Page): Promise<string> {
    await page.goto('/players');
    await expect(page.getByRole('heading', { name: 'Players' })).toBeVisible({ timeout: 15_000 });

    // Wait for at least one user link to appear in the player list
    const playerLink = page.locator('a[href*="/users/"]').first();
    await expect(playerLink).toBeVisible({ timeout: 10_000 });

    const href = await playerLink.getAttribute('href');
    expect(href).toBeTruthy();

    // Navigate directly to the profile URL (avoids SPA routing issues
    // where clicking the link for the logged-in user would redirect
    // to the profile settings page).
    // Pick the second link if the first points to the logged-in user (/users/41)
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
    return targetHref;
}

test.describe('User profile page', () => {
    test('renders username heading and member-since text', async ({ page }) => {
        await navigateToUserProfile(page);

        // The profile header contains an <h1> with the username
        const heading = page.getByRole('heading', { level: 1 });
        await expect(heading).toBeVisible({ timeout: 15_000 });
        const username = await heading.textContent();
        expect(username).toBeTruthy();
        expect(username!.length).toBeGreaterThan(0);

        // "Member X ago" paragraph is always present
        await expect(page.getByText(/^Member /)).toBeVisible({ timeout: 5_000 });
    });

    test('Game Activity section is visible', async ({ page }) => {
        await navigateToUserProfile(page);

        // Activity section heading is always rendered (even with no data)
        await expect(
            page.getByRole('heading', { name: 'Game Activity' }),
        ).toBeVisible({ timeout: 15_000 });

        // Period selector buttons are always present
        await expect(page.getByRole('button', { name: 'This Week' })).toBeVisible({ timeout: 5_000 });
        await expect(page.getByRole('button', { name: 'This Month' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'All Time' })).toBeVisible();
    });

    test('Upcoming Events section is visible', async ({ page }) => {
        await navigateToUserProfile(page);

        // Upcoming Events heading is always rendered (shows "No upcoming events"
        // when the user has no signups)
        await expect(
            page.getByRole('heading', { name: /Upcoming Events/ }),
        ).toBeVisible({ timeout: 15_000 });
    });

    test('page loads without error boundary', async ({ page }) => {
        await navigateToUserProfile(page);

        // Wait for the profile to fully render
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });

        // Verify no error boundary text appears
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i);

        // Verify this is not the "User Not Found" error state
        await expect(page.getByText('User Not Found')).not.toBeVisible();
    });
});
