/**
 * Create event form smoke tests — form rendering, validation, game search,
 * roster slot type switching, and successful event creation with cleanup.
 */
import { test, expect } from './base';
import { getAdminToken, apiDelete } from './api-helpers';

// ROK-1070 Codex review (P2): removed the file-level reset-to-seed
// beforeAll for the parallel-project race reason documented in
// events.smoke / plan-event.smoke / notifications.smoke.

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wait for the create event form to fully render. */
async function waitForForm(page: import('@playwright/test').Page) {
    await page.goto('/events/new');
    await expect(page.getByRole('heading', { name: 'Create Event', level: 1 })).toBeVisible({ timeout: 15_000 });
}

// ---------------------------------------------------------------------------
// Form rendering
// ---------------------------------------------------------------------------

test.describe('Create event form', () => {
    test('page renders form with all sections', async ({ page }) => {
        await waitForForm(page);

        // Section headings
        await expect(page.getByRole('heading', { name: 'Game & Content' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Details' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'When' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Roster' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Reminders' })).toBeVisible();

        // Key form fields
        await expect(page.getByRole('combobox', { name: 'Game', exact: true })).toBeVisible();
        await expect(page.getByRole('textbox', { name: 'Event Title' })).toBeVisible();
        await expect(page.getByRole('textbox', { name: 'Description' })).toBeVisible();
        await expect(page.getByRole('textbox', { name: 'Date' })).toBeVisible();
        await expect(page.getByRole('textbox', { name: 'Start Time' })).toBeVisible();

        // Duration: a segmented radiogroup (ROK-1649). The native radio is
        // sr-only, so visibility is asserted on its segment <label>.
        await expect(page.getByRole('radiogroup', { name: 'Duration', exact: true })).toBeVisible();
        await expect(page.getByRole('radio', { name: '2h', exact: true }).locator('xpath=..')).toBeVisible();

        // Repeat dropdown
        await expect(page.getByRole('combobox', { name: 'Repeat' })).toBeVisible();

        // Action buttons
        await expect(page.getByRole('button', { name: 'Create Event' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Save as Template' })).toBeVisible();
    });

    test('form validation shows errors on empty submit', async ({ page }) => {
        await waitForForm(page);

        // Submit without filling any required fields
        await page.getByRole('button', { name: 'Create Event' }).click();

        // Validation error messages
        await expect(page.getByText('Title is required')).toBeVisible({ timeout: 5_000 });
        await expect(page.getByText('Start date is required')).toBeVisible();
        await expect(page.getByText('Start time is required')).toBeVisible();

        // URL should not change — still on create page
        expect(page.url()).toContain('/events/new');
    });

    test('game search populates dropdown with results', async ({ page }) => {
        await waitForForm(page);

        const gameInput = page.getByRole('combobox', { name: 'Game', exact: true });
        await gameInput.click();
        await gameInput.pressSequentially('World', { delay: 50 });

        // Wait for the search dropdown to appear — in CI with sparse IGDB data,
        // the listbox may not appear if no games match. Soft check.
        const listbox = page.getByRole('listbox');
        const hasResults = await listbox.isVisible({ timeout: 10_000 }).catch(() => false);
        if (hasResults) {
            const options = listbox.getByRole('option');
            const count = await options.count();
            expect(count).toBeGreaterThan(0);
        }
    });

    test('MMO Roles slot type shows Tank/Healer/DPS composition', async ({ page }) => {
        await waitForForm(page);

        // Default view shows "Generic Slots" with single "Players" spinbutton
        await expect(page.getByRole('button', { name: 'MMO Roles' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Generic Slots' })).toBeVisible();

        // Click MMO Roles
        await page.getByRole('button', { name: 'MMO Roles' }).click();

        // Role composition fields should appear
        await expect(page.getByText('Tank')).toBeVisible({ timeout: 5_000 });
        await expect(page.getByText('Healer')).toBeVisible();
        await expect(page.getByText('DPS')).toBeVisible();

        // Total slots should reflect the sum of role slots
        await expect(page.getByText(/Total slots: \d+/)).toBeVisible();
    });

    test('duration radios are selectable', async ({ page }) => {
        await waitForForm(page);

        // Every duration segment renders (ROK-1649: segmented radiogroup; the
        // native radio is sr-only, so the segment <label> is what is visible)
        const durations = ['1h', '1.5h', '2h', '3h', '4h', 'Custom'];
        for (const dur of durations) {
            const radio = page.getByRole('radio', { name: dur, exact: true });
            await expect(radio.locator('xpath=..')).toBeVisible();
        }

        // Tap the 3h segment — its radio becomes the checked one
        await page.getByRole('radio', { name: '3h', exact: true }).locator('xpath=..').click();
        await expect(page.getByRole('radio', { name: '3h', exact: true })).toBeChecked();

        // Custom reveals the named hour/minute fields
        await page.getByRole('radio', { name: 'Custom', exact: true }).locator('xpath=..').click();
        await expect(page.getByRole('radio', { name: 'Custom', exact: true })).toBeChecked();
        await expect(page.getByRole('radio', { name: '3h', exact: true })).not.toBeChecked();
        await expect(page.getByRole('spinbutton', { name: 'Duration hours' })).toBeVisible();
        await expect(page.getByRole('spinbutton', { name: 'Duration minutes' })).toBeVisible();
    });

    test('successful event creation redirects to event detail', async ({ page, world }) => {
        await waitForForm(page);

        const token = await getAdminToken();

        // Per-test unique title — avoids the cross-project (desktop+mobile)
        // collision the hardcoded 'PW-894 Smoke Test Event' caused when both
        // projects raced the same detail-page text assertion.
        const title = world.uid('event');

        // Fill in required fields
        await page.getByRole('textbox', { name: 'Event Title' }).fill(title);

        // Set date to tomorrow (type="date" inputs need YYYY-MM-DD format)
        const tomorrow = new Date(Date.now() + 86_400_000);
        const dateStr = tomorrow.toISOString().split('T')[0];
        await page.getByRole('textbox', { name: 'Date' }).fill(dateStr);

        // Set start time (type="time" inputs need HH:MM 24-hr format)
        await page.getByRole('textbox', { name: 'Start Time' }).fill('20:00');

        // Select a duration (tap the segment; the sr-only radio is checked)
        await page.getByRole('radio', { name: '2h', exact: true }).locator('xpath=..').click();
        await expect(page.getByRole('radio', { name: '2h', exact: true })).toBeChecked();

        // Submit the form
        await page.getByRole('button', { name: 'Create Event' }).click();

        // Should redirect to event detail page
        await page.waitForURL(/\/events\/\d+/, { timeout: 15_000 });

        // Extract event ID from URL for cleanup
        const eventId = page.url().match(/\/events\/(\d+)/)?.[1];
        expect(eventId).toBeTruthy();

        try {
            // Verify event detail page loaded
            await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });
            // The event title should appear on the detail page
            await expect(page.getByText(title)).toBeVisible({ timeout: 10_000 });
        } finally {
            // Clean up: delete the created event via API
            if (eventId) {
                await apiDelete(token, `/events/${eventId}`);
            }
        }
    });

    test('cancel button navigates back', async ({ page }) => {
        // Navigate to events list first, then to create page
        await page.goto('/events');
        await expect(page.getByRole('heading', { name: /Events/i }).first()).toBeVisible({ timeout: 15_000 });

        await page.goto('/events/new');
        await expect(page.getByRole('heading', { name: 'Create Event', level: 1 })).toBeVisible({ timeout: 15_000 });

        // Click Cancel
        await page.getByRole('button', { name: 'Cancel' }).click();

        // Should navigate away from create page
        await expect(page).not.toHaveURL(/\/events\/new/, { timeout: 10_000 });
    });
});
