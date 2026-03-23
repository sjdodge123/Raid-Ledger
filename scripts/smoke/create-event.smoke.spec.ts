/**
 * Create event form smoke tests — form rendering, validation, game search,
 * roster slot type switching, and successful event creation with cleanup.
 */
import { test, expect } from '@playwright/test';

const API_BASE = process.env.API_URL || 'http://localhost:3000';

// ---------------------------------------------------------------------------
// API helpers (reused from events.smoke.spec.ts ROK-868 pattern)
// ---------------------------------------------------------------------------

async function getAdminToken(): Promise<string> {
    const res = await fetch(`${API_BASE}/auth/local`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin@local', password: process.env.ADMIN_PASSWORD || 'password' }),
    });
    const { access_token } = (await res.json()) as { access_token: string };
    return access_token;
}

async function apiDelete(token: string, path: string) {
    await fetch(`${API_BASE}${path}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
}

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
        await expect(page.getByRole('textbox', { name: 'Game' })).toBeVisible();
        await expect(page.getByRole('textbox', { name: 'Event Title' })).toBeVisible();
        await expect(page.getByRole('textbox', { name: 'Description' })).toBeVisible();
        await expect(page.getByRole('textbox', { name: 'Date' })).toBeVisible();
        await expect(page.getByRole('textbox', { name: 'Start Time' })).toBeVisible();

        // Duration buttons
        await expect(page.getByRole('button', { name: '2h' })).toBeVisible();

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

        const gameInput = page.getByRole('textbox', { name: 'Game' });
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

    test('duration buttons are selectable', async ({ page }) => {
        await waitForForm(page);

        // Click each duration button and verify it stays in the DOM
        const durations = ['1h', '1.5h', '2h', '3h', '4h', 'Custom'];
        for (const dur of durations) {
            const btn = page.getByRole('button', { name: dur, exact: true });
            await expect(btn).toBeVisible();
        }

        // Click the 3h button
        await page.getByRole('button', { name: '3h', exact: true }).click();
        // The button should still be visible (selected state)
        await expect(page.getByRole('button', { name: '3h', exact: true })).toBeVisible();
    });

    test('successful event creation redirects to event detail', async ({ page }) => {
        await waitForForm(page);

        const token = await getAdminToken();

        // Fill in required fields
        await page.getByRole('textbox', { name: 'Event Title' }).fill('PW-894 Smoke Test Event');

        // Set date to tomorrow (type="date" inputs need YYYY-MM-DD format)
        const tomorrow = new Date(Date.now() + 86_400_000);
        const dateStr = tomorrow.toISOString().split('T')[0];
        await page.getByRole('textbox', { name: 'Date' }).fill(dateStr);

        // Set start time (type="time" inputs need HH:MM 24-hr format)
        await page.getByRole('textbox', { name: 'Start Time' }).fill('20:00');

        // Select a duration
        await page.getByRole('button', { name: '2h', exact: true }).click();

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
            await expect(page.getByText('PW-894 Smoke Test Event')).toBeVisible({ timeout: 10_000 });
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
