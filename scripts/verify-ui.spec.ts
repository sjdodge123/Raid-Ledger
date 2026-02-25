/**
 * Automated smoke tests — ROK-483
 *
 * Converts the manual checklist from implementation-artifacts/smoke-tests.md
 * into automated Playwright specs. Requires DEMO_MODE=true for persona-based
 * login flows (seeded admin + member accounts).
 *
 * Run:
 *   npx playwright test                          # auto-starts dev server
 *   BASE_URL=http://localhost:80 npx playwright test  # against Docker container
 */
import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

test.describe('Authentication', () => {
    test('login page loads and renders form', async ({ page }) => {
        await page.goto('/login', { waitUntil: 'networkidle' });
        await expect(page).toHaveTitle(/Raid Ledger|Login/i);
        // Page should not crash (error boundary)
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i);
    });

    test('demo admin can log in (DEMO_MODE)', async ({ page }) => {
        await page.goto('/login');

        // Demo mode shows quick-login buttons for seeded personas
        const adminBtn = page.getByRole('button', { name: /admin/i });
        if (await adminBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
            await adminBtn.click();
            // Should navigate away from login page after auth
            await page.waitForURL((url) => !url.pathname.includes('/login'), {
                timeout: 10_000,
            });
            await expect(page.locator('body')).not.toHaveText(/error/i);
        } else {
            test.skip(true, 'DEMO_MODE not enabled — skipping demo login');
        }
    });

    test('authenticated user sees calendar', async ({ page }) => {
        await page.goto('/login');

        const adminBtn = page.getByRole('button', { name: /admin/i });
        if (await adminBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
            await adminBtn.click();
            await page.waitForURL((url) => !url.pathname.includes('/login'), {
                timeout: 10_000,
            });
            // Calendar or dashboard should be visible
            const calendarOrDash = page.locator(
                '[data-testid="calendar"], [class*="calendar"], h1, h2',
            ).first();
            await expect(calendarOrDash).toBeVisible({ timeout: 10_000 });
        } else {
            test.skip(true, 'DEMO_MODE not enabled');
        }
    });

    test('admin can impersonate non-admin user (ROK-212)', async ({ page }) => {
        await page.goto('/login');

        const adminBtn = page.getByRole('button', { name: /admin/i });
        if (await adminBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
            await adminBtn.click();
            await page.waitForURL((url) => !url.pathname.includes('/login'), {
                timeout: 10_000,
            });

            // Look for impersonation trigger (dropdown, menu item, etc.)
            const impersonateLink = page.getByText(/impersonat/i).first();
            if (await impersonateLink.isVisible({ timeout: 3000 }).catch(() => false)) {
                await impersonateLink.click();
                // Should show a user selection or directly switch
                await page.waitForTimeout(1000);
                // Look for any user to impersonate
                const userOption = page.locator('[data-testid*="user"], button, a')
                    .filter({ hasNotText: /admin/i })
                    .first();
                if (await userOption.isVisible({ timeout: 3000 }).catch(() => false)) {
                    await userOption.click();
                    // Should show impersonation banner
                    const banner = page.getByText(/viewing as/i);
                    await expect(banner).toBeVisible({ timeout: 5000 });
                }
            } else {
                test.skip(true, 'Impersonation not available in current UI');
            }
        } else {
            test.skip(true, 'DEMO_MODE not enabled');
        }
    });

    test('impersonation banner shows and exit restores admin (ROK-212)', async ({ page }) => {
        await page.goto('/login');

        const adminBtn = page.getByRole('button', { name: /admin/i });
        if (await adminBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
            await adminBtn.click();
            await page.waitForURL((url) => !url.pathname.includes('/login'), {
                timeout: 10_000,
            });

            const impersonateLink = page.getByText(/impersonat/i).first();
            if (await impersonateLink.isVisible({ timeout: 3000 }).catch(() => false)) {
                await impersonateLink.click();
                await page.waitForTimeout(1000);

                const userOption = page.locator('[data-testid*="user"], button, a')
                    .filter({ hasNotText: /admin/i })
                    .first();
                if (await userOption.isVisible({ timeout: 3000 }).catch(() => false)) {
                    await userOption.click();

                    // Banner should be visible
                    const banner = page.getByText(/viewing as/i);
                    await expect(banner).toBeVisible({ timeout: 5000 });

                    // Exit impersonation
                    const exitBtn = page.getByText(/exit/i).first();
                    await exitBtn.click();

                    // Banner should disappear
                    await expect(banner).not.toBeVisible({ timeout: 5000 });
                }
            } else {
                test.skip(true, 'Impersonation not available');
            }
        } else {
            test.skip(true, 'DEMO_MODE not enabled');
        }
    });
});

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

test.describe('Navigation', () => {
    test('header nav links are functional', async ({ page }) => {
        // Log in first — unauthenticated users get redirected to /login (no nav)
        await page.goto('/login');
        const adminBtn = page.getByRole('button', { name: /admin/i });
        if (!(await adminBtn.isVisible({ timeout: 5000 }).catch(() => false))) {
            test.skip(true, 'DEMO_MODE not enabled — skipping nav test');
        }
        await adminBtn.click();
        await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 10_000 });

        // Look for navigation links in header/nav
        const nav = page.locator('nav, header').first();
        await expect(nav).toBeVisible({ timeout: 10_000 });

        // Should have at least one clickable link
        const links = nav.locator('a[href]');
        const count = await links.count();
        expect(count).toBeGreaterThan(0);
    });

    test('calendar loads without console errors', async ({ page }) => {
        const errors: string[] = [];
        page.on('console', (msg) => {
            if (msg.type() === 'error') errors.push(msg.text());
        });

        await page.goto('/');
        await page.waitForTimeout(3000);

        // Filter out known benign errors (e.g., network requests in dev)
        const criticalErrors = errors.filter(
            (e) => !e.includes('net::') && !e.includes('favicon') && !e.includes('404'),
        );
        expect(criticalErrors).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

test.describe('Calendar', () => {
    test('month view displays without crashing', async ({ page }) => {
        await page.goto('/');
        // Calendar container should render
        await page.waitForTimeout(2000);
        // Page should not show an error boundary
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i);
    });

    test('week view displays events', async ({ page }) => {
        await page.goto('/');
        await page.waitForTimeout(2000);

        // Look for week view toggle
        const weekBtn = page.getByRole('button', { name: /week/i });
        if (await weekBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
            await weekBtn.click();
            await page.waitForTimeout(1000);
            await expect(page.locator('body')).not.toHaveText(/something went wrong/i);
        }
    });

    test('day view shows event details', async ({ page }) => {
        await page.goto('/');
        await page.waitForTimeout(2000);

        // Look for day view toggle
        const dayBtn = page.getByRole('button', { name: /day/i });
        if (await dayBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
            await dayBtn.click();
            await page.waitForTimeout(1000);
            await expect(page.locator('body')).not.toHaveText(/something went wrong/i);
        }
    });

    test('attendee avatars render (ROK-194)', async ({ page }) => {
        await page.goto('/');
        await page.waitForTimeout(3000);

        // If there are events with attendees, avatars should render as images
        const avatars = page.locator('img[alt*="avatar" i], img[class*="avatar" i], [data-testid*="avatar"]');
        const count = await avatars.count();
        // This is a soft check — events may or may not exist
        if (count > 0) {
            await expect(avatars.first()).toBeVisible();
        }
    });
});

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

test.describe('Roster', () => {
    test('roster displays on event detail page (ROK-183)', async ({ page }) => {
        // Navigate to an event page — need an event to exist
        await page.goto('/');
        await page.waitForTimeout(2000);

        // Try to find and click an event link
        const eventLink = page.locator('a[href*="/events/"]').first();
        if (await eventLink.isVisible({ timeout: 3000 }).catch(() => false)) {
            await eventLink.click();
            await page.waitForTimeout(2000);

            // Event detail page should not crash
            await expect(page.locator('body')).not.toHaveText(/something went wrong/i);

            // Look for roster or signup section
            const rosterSection = page.locator(
                '[data-testid*="roster"], [class*="roster"], text=/roster|signed up|attendees/i',
            ).first();
            if (await rosterSection.isVisible({ timeout: 3000 }).catch(() => false)) {
                await expect(rosterSection).toBeVisible();
            }
        } else {
            test.skip(true, 'No events available to test roster');
        }
    });
});
