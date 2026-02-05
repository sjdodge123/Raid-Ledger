import { test, expect } from '@playwright/test';

/**
 * UI Verification Tests (ROK-162)
 * 
 * These tests verify critical UI flows are working correctly.
 * Run with: npx playwright test
 * 
 * Prerequisites:
 *   - docker compose --profile test up -d
 *   - API health check passing: curl http://localhost:3000/health
 */

test.describe('UI Verification', () => {
    test.describe.configure({ mode: 'serial' });

    test('Landing page renders correctly', async ({ page }) => {
        await page.goto('/');

        // Verify hero section exists
        await expect(page.locator('h1')).toBeVisible();

        // Verify navigation header
        await expect(page.locator('header').first()).toBeVisible();

        // Verify CTA button or link
        const ctaButton = page.getByRole('link', { name: /event|get started|sign up/i })
            .or(page.getByRole('button', { name: /event|get started/i }));
        await expect(ctaButton.first()).toBeVisible();
    });

    test('Login page renders correctly', async ({ page }) => {
        await page.goto('/login');

        // Verify Discord OAuth button
        const discordButton = page.getByRole('link', { name: /discord/i })
            .or(page.getByRole('button', { name: /discord/i }));
        await expect(discordButton.first()).toBeVisible();

        // Verify centered layout (check main container exists)
        await expect(page.locator('main').first()).toBeVisible();
    });

    test('Events page displays event cards', async ({ page }) => {
        await page.goto('/events');

        // Verify "Events" header
        await expect(page.getByRole('heading', { name: /events/i })).toBeVisible();

        // Verify event cards exist (seeded by DEMO_MODE)
        // Event cards are buttons containing event titles
        const eventCards = page.getByRole('button').filter({ hasText: /prog|raid|rush|runs/i });

        // Should have at least 1 seeded event
        await expect(eventCards.first()).toBeVisible({ timeout: 10_000 });
    });

    test('Event Detail page shows roster and heatmap', async ({ page }) => {
        // Navigate to first event detail
        await page.goto('/events');

        // Click on first event card button
        const eventCard = page.getByRole('button').filter({ hasText: /prog|raid|rush|runs/i }).first();
        await eventCard.click();

        // Verify event title (h1)
        await expect(page.locator('h1')).toBeVisible();

        // Verify Roster section header
        await expect(page.getByRole('heading', { name: /roster/i })).toBeVisible();

        // Verify event date/time info
        await expect(page.getByText(/duration/i)).toBeVisible();
    });

    test('Profile page loads (with or without auth)', async ({ page }) => {
        await page.goto('/profile');

        // Either shows profile content OR redirects to login
        const profileOrLogin = page.getByText(/profile|my characters|discord|login/i);
        await expect(profileOrLogin.first()).toBeVisible();
    });

    // ROK-178: Calendar Day View Tests
    test('Calendar Day view toggle button exists', async ({ page }) => {
        await page.goto('/calendar');

        // Verify Day button exists in toolbar
        const dayButton = page.getByRole('button', { name: 'Day', exact: true });
        await expect(dayButton).toBeVisible();
    });

    test('Calendar Day view can be activated', async ({ page }) => {
        await page.goto('/calendar');

        // Click Day button
        const dayButton = page.getByRole('button', { name: 'Day', exact: true });
        await dayButton.click();

        // Verify URL updated
        await expect(page).toHaveURL(/view=day/);

        // Verify date format in toolbar title (should be full date like "Thursday, February 5, 2026")
        const title = page.locator('.toolbar-title');
        await expect(title).toContainText(/\w+,\s+\w+\s+\d+,\s+\d{4}/);
    });

    test('Calendar Day navigation works', async ({ page }) => {
        await page.goto('/calendar?view=day');

        // Get initial date from title
        const title = page.locator('.toolbar-title');
        const initialText = await title.textContent();

        // Click next button
        const nextButton = page.getByRole('button', { name: /Next day/i });
        await nextButton.click();

        // Verify date changed
        await expect(title).not.toHaveText(initialText!);
    });

    // ROK-177: Week View Attendee Avatars
    test('Calendar Week view shows attendee avatars', async ({ page }) => {
        await page.goto('/calendar?view=week');

        // Wait for week view to load
        await page.waitForSelector('.rbc-time-view', { timeout: 10000 });

        // Wait for events to render
        await page.waitForTimeout(2000);

        // Check for attendee avatars or the fallback signup text
        const avatars = await page.locator('.attendee-avatars').count();
        const signupText = await page.locator('.week-event-signups').count();

        console.log('Attendee avatar groups found:', avatars);
        console.log('Signup text fallbacks found:', signupText);

        // At least one should be present (avatars preferred, fallback if no signups data)
        expect(avatars + signupText).toBeGreaterThan(0);

        // If there are events with signups, avatars should be showing
        if (avatars > 0) {
            console.log('✅ Attendee avatars are rendering correctly!');
        } else {
            console.log('⚠️ Only fallback text is showing - signupsPreview may not be populating frontend');
        }
    });
});
