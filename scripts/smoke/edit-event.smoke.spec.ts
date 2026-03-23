/**
 * Edit event form smoke tests — pre-filled data, field editing, cancel, validation.
 *
 * Uses navigateToFirstEvent to find a seeded event, then appends /edit.
 * IMPORTANT: Tests do NOT submit changes to avoid mutating seed data.
 */
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { navigateToFirstEvent } from './helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Navigate to the edit page for the first upcoming event. */
async function navigateToEditEvent(page: Page, testInfo: TestInfo) {
    await navigateToFirstEvent(page, testInfo);
    const url = page.url();
    await page.goto(`${url}/edit`);
    await expect(page.getByRole('heading', { name: 'Edit Event' })).toBeVisible({ timeout: 15_000 });
}

// ---------------------------------------------------------------------------
// Desktop — Edit Event Form
// ---------------------------------------------------------------------------

test.describe('Edit event form (desktop)', () => {
    test.beforeEach(async ({ page }, testInfo) => {
        test.skip(testInfo.project.name === 'mobile', 'Desktop-only tests');
        await navigateToEditEvent(page, testInfo);
    });

    test('page renders with pre-filled form data', async ({ page }) => {
        // Title field should be pre-filled (not empty)
        const titleInput = page.getByRole('textbox', { name: 'Event Title' });
        await expect(titleInput).toBeVisible();
        const titleValue = await titleInput.inputValue();
        expect(titleValue.length).toBeGreaterThan(0);

        // Date field should be pre-filled
        const dateInput = page.getByRole('textbox', { name: 'Date' });
        await expect(dateInput).toBeVisible();
        const dateValue = await dateInput.inputValue();
        expect(dateValue).toMatch(/^\d{4}-\d{2}-\d{2}$/);

        // Start time field should be pre-filled
        const timeInput = page.getByRole('textbox', { name: 'Start Time' });
        await expect(timeInput).toBeVisible();
        const timeValue = await timeInput.inputValue();
        expect(timeValue).toMatch(/^\d{2}:\d{2}$/);

        // Game field should be pre-filled
        const gameInput = page.getByRole('textbox', { name: 'Game' });
        await expect(gameInput).toBeVisible();
        const gameValue = await gameInput.inputValue();
        expect(gameValue.length).toBeGreaterThan(0);
    });

    test('form headings and sections are visible', async ({ page }) => {
        await expect(page.getByRole('heading', { name: 'Game & Content' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Details' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'When' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Roster' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Reminders' })).toBeVisible();
    });

    test('title field is editable', async ({ page }) => {
        const titleInput = page.getByRole('textbox', { name: 'Event Title' });
        const originalValue = await titleInput.inputValue();

        // Clear and type new value
        await titleInput.fill('Edited Test Title');
        const newValue = await titleInput.inputValue();
        expect(newValue).toBe('Edited Test Title');

        // Restore original value (do not submit)
        await titleInput.fill(originalValue);
    });

    test('description field is editable', async ({ page }) => {
        const descInput = page.getByRole('textbox', { name: 'Description' });
        await expect(descInput).toBeVisible();

        const originalValue = await descInput.inputValue();

        await descInput.fill('Updated description for smoke test');
        expect(await descInput.inputValue()).toBe('Updated description for smoke test');

        // Restore original value
        await descInput.fill(originalValue);
    });

    test('cancel button navigates away from edit page', async ({ page }) => {
        const cancelBtn = page.getByRole('button', { name: 'Cancel' });
        await expect(cancelBtn).toBeVisible();
        await cancelBtn.click();

        // Cancel navigates to /events (the events list)
        await page.waitForURL(/\/events$/, { timeout: 10_000 });
    });

    test('save and action buttons are visible', async ({ page }) => {
        await expect(page.getByRole('button', { name: 'Save Changes' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Save as Template' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Back to Event' })).toBeVisible();
    });

    test('title validation rejects empty input', async ({ page }) => {
        const titleInput = page.getByRole('textbox', { name: 'Event Title' });
        const originalValue = await titleInput.inputValue();

        // Clear the title field
        await titleInput.fill('');

        // Click Save Changes — form should show validation error
        await page.getByRole('button', { name: 'Save Changes' }).click();

        // The form should NOT navigate away (still on edit page)
        expect(page.url()).toContain('/edit');

        // Restore original value
        await titleInput.fill(originalValue);
    });
});

// ---------------------------------------------------------------------------
// Mobile — Edit Event Form
// ---------------------------------------------------------------------------

test.describe('Edit event form (mobile)', () => {
    test.beforeEach(async ({ page }, testInfo) => {
        test.skip(testInfo.project.name === 'desktop', 'Mobile-only tests');
        await navigateToEditEvent(page, testInfo);
    });

    test('page renders with pre-filled form data', async ({ page }) => {
        const titleInput = page.getByRole('textbox', { name: 'Event Title' });
        await expect(titleInput).toBeVisible();
        const titleValue = await titleInput.inputValue();
        expect(titleValue.length).toBeGreaterThan(0);

        const dateInput = page.getByRole('textbox', { name: 'Date' });
        await expect(dateInput).toBeVisible();
        const dateValue = await dateInput.inputValue();
        expect(dateValue).toMatch(/^\d{4}-\d{2}-\d{2}$/);

        const timeInput = page.getByRole('textbox', { name: 'Start Time' });
        await expect(timeInput).toBeVisible();
        const timeValue = await timeInput.inputValue();
        expect(timeValue).toMatch(/^\d{2}:\d{2}$/);

        const gameInput = page.getByRole('textbox', { name: 'Game' });
        await expect(gameInput).toBeVisible();
        const gameValue = await gameInput.inputValue();
        expect(gameValue.length).toBeGreaterThan(0);
    });

    test('form headings and sections are visible', async ({ page }) => {
        await expect(page.getByRole('heading', { name: 'Game & Content' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Details' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'When' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Roster' })).toBeVisible();
        // Scroll down for Reminders heading on mobile
        await page.getByRole('heading', { name: 'Reminders' }).scrollIntoViewIfNeeded();
        await expect(page.getByRole('heading', { name: 'Reminders' })).toBeVisible();
    });

    test('title field is editable', async ({ page }) => {
        const titleInput = page.getByRole('textbox', { name: 'Event Title' });
        const originalValue = await titleInput.inputValue();

        await titleInput.fill('Edited Mobile Title');
        expect(await titleInput.inputValue()).toBe('Edited Mobile Title');

        await titleInput.fill(originalValue);
    });

    test('description field is editable', async ({ page }) => {
        const descInput = page.getByRole('textbox', { name: 'Description' });
        await expect(descInput).toBeVisible();

        const originalValue = await descInput.inputValue();

        await descInput.fill('Mobile description edit');
        expect(await descInput.inputValue()).toBe('Mobile description edit');

        await descInput.fill(originalValue);
    });

    test('cancel button navigates away from edit page', async ({ page }) => {
        // Scroll to bottom for the Cancel button on mobile
        const cancelBtn = page.getByRole('button', { name: 'Cancel' });
        await cancelBtn.scrollIntoViewIfNeeded();
        await expect(cancelBtn).toBeVisible();
        await cancelBtn.click();

        // Cancel navigates to /events (the events list)
        await page.waitForURL(/\/events$/, { timeout: 10_000 });
    });

    test('title validation rejects empty input', async ({ page }) => {
        const titleInput = page.getByRole('textbox', { name: 'Event Title' });
        const originalValue = await titleInput.inputValue();

        await titleInput.fill('');

        // Scroll to Save Changes button on mobile
        const saveBtn = page.getByRole('button', { name: 'Save Changes' });
        await saveBtn.scrollIntoViewIfNeeded();
        await saveBtn.click();

        // Should stay on edit page — form validation prevents navigation
        expect(page.url()).toContain('/edit');

        await titleInput.fill(originalValue);
    });
});
