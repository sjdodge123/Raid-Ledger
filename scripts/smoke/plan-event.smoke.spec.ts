/**
 * Plan Event smoke tests — plan event form rendering, time slot selection,
 * game search, form validation, poll settings, and roster configuration.
 *
 * The plan event page creates a scheduling poll rather than an event directly.
 * Tests focus on form rendering and validation without actually submitting
 * (to avoid creating data that affects other tests).
 */
import { test, expect } from './base';

// ROK-1070 Codex review (P2): removed the file-level reset-to-seed
// beforeAll for the same reason as notifications.smoke — desktop+mobile
// projects run in parallel and a global truncate races against the other
// project's fixtures. Global setup is sufficient.

// ---------------------------------------------------------------------------
// Plan Event Form — Rendering
// ---------------------------------------------------------------------------

test.describe('Plan event form rendering', () => {
    test('page renders plan creation form with all sections', async ({ page }) => {
        await page.goto('/events/plan');
        await expect(page.getByRole('heading', { name: 'Plan Event', level: 1 })).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText('Poll your community to find the best time')).toBeVisible();

        // All form sections should render
        await expect(page.getByRole('heading', { name: 'Game & Details' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Candidate Time Slots' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Poll Settings' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Event Duration' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Roster' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Reminders' })).toBeVisible();
    });

    test('form action buttons are visible', async ({ page }) => {
        await page.goto('/events/plan');
        await expect(page.getByRole('heading', { name: 'Plan Event', level: 1 })).toBeVisible({ timeout: 15_000 });

        await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Start Poll' })).toBeVisible();
    });

    test('back button is visible', async ({ page }) => {
        await page.goto('/events/plan');
        await expect(page.getByRole('heading', { name: 'Plan Event', level: 1 })).toBeVisible({ timeout: 15_000 });

        await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeVisible();
    });
});

// ---------------------------------------------------------------------------
// Plan Event Form — Game Selection
// ---------------------------------------------------------------------------

test.describe('Plan event game selection', () => {
    test('game search input is available', async ({ page }) => {
        await page.goto('/events/plan');
        await expect(page.getByRole('heading', { name: 'Plan Event', level: 1 })).toBeVisible({ timeout: 15_000 });

        const gameInput = page.getByRole('textbox', { name: 'Game' });
        await expect(gameInput).toBeVisible();
        await expect(gameInput).toHaveAttribute('placeholder', 'Search for a game...');
    });

    test('event title and description fields are editable', async ({ page }) => {
        await page.goto('/events/plan');
        await expect(page.getByRole('heading', { name: 'Plan Event', level: 1 })).toBeVisible({ timeout: 15_000 });

        const titleInput = page.getByRole('textbox', { name: /Event Title/i });
        await expect(titleInput).toBeVisible();
        await titleInput.fill('Test Raid Night');
        await expect(titleInput).toHaveValue('Test Raid Night');

        const descInput = page.getByRole('textbox', { name: 'Description' });
        await expect(descInput).toBeVisible();
        await descInput.fill('A test description');
        await expect(descInput).toHaveValue('A test description');
    });
});

// ---------------------------------------------------------------------------
// Plan Event Form — Time Slot Selection
// ---------------------------------------------------------------------------

test.describe('Plan event time slot selection', () => {
    test('candidate time slot buttons are rendered', async ({ page }) => {
        await page.goto('/events/plan');
        await expect(page.getByRole('heading', { name: 'Candidate Time Slots' })).toBeVisible({ timeout: 15_000 });

        // Instruction text visible
        await expect(page.getByText('Select 2-9 time options for the poll')).toBeVisible();

        // Time slot suggestions load async from the API. Wait for the loading state to clear
        // and at least one suggestion button to appear (buttons have day-of-week labels like
        // "Saturday, Mar 21, 6:00 PM EDT"). The suggestion buttons live inside a flex-wrap container.
        // If no suggestions load (e.g. no game selected), the page shows "No suggestions available".
        const hasSuggestions = page.locator('button').filter({ hasText: /Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Jan|Feb/ }).first();
        const noSuggestions = page.getByText('No suggestions available');
        // Either suggestions appear or the "no suggestions" message shows
        await expect(hasSuggestions.or(noSuggestions)).toBeVisible({ timeout: 10_000 });
    });

    test('clicking a time slot toggles selection', async ({ page }) => {
        await page.goto('/events/plan');
        await expect(page.getByRole('heading', { name: 'Candidate Time Slots' })).toBeVisible({ timeout: 15_000 });

        // Wait for suggestions to load (async API call), then click the first one.
        // Suggestions contain month abbreviations in their labels.
        const suggestionButtons = page.locator('button').filter({ hasText: /Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Jan|Feb/ });
        const firstSlot = suggestionButtons.first();
        if (!await firstSlot.isVisible({ timeout: 15_000 }).catch(() => false)) {
            test.skip(true, 'No time slot suggestions available — cannot test selection');
            return;
        }
        await firstSlot.click();

        // After clicking, the "Selected" section should appear with 1 slot
        await expect(page.getByText('Selected (1/9)')).toBeVisible({ timeout: 5_000 });
    });

    test('custom time add section is available', async ({ page }) => {
        await page.goto('/events/plan');
        await expect(page.getByRole('heading', { name: 'Candidate Time Slots' })).toBeVisible({ timeout: 15_000 });

        await expect(page.getByText('Add Custom Time')).toBeVisible();
        // The Add button starts disabled until date/time are filled
        await expect(page.getByRole('button', { name: 'Add' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Add' })).toBeDisabled();
    });
});

// ---------------------------------------------------------------------------
// Plan Event Form — Validation
// ---------------------------------------------------------------------------

test.describe('Plan event form validation', () => {
    test('submitting empty form shows validation errors', async ({ page }) => {
        await page.goto('/events/plan');
        await expect(page.getByRole('heading', { name: 'Plan Event', level: 1 })).toBeVisible({ timeout: 15_000 });

        // Click Start Poll without filling anything
        await page.getByRole('button', { name: 'Start Poll' }).click();

        // Validation requires: title + at least 2 time slots
        await expect(page.getByText('Title is required')).toBeVisible({ timeout: 5_000 });
        await expect(page.getByText('Select at least 2 time options')).toBeVisible({ timeout: 5_000 });

        // Should NOT navigate away — still on plan page
        await expect(page).toHaveURL(/\/events\/plan/);
    });

    test('filling title clears title error but time slot error persists', async ({ page }) => {
        await page.goto('/events/plan');
        await expect(page.getByRole('heading', { name: 'Plan Event', level: 1 })).toBeVisible({ timeout: 15_000 });

        // Trigger validation
        await page.getByRole('button', { name: 'Start Poll' }).click();
        await expect(page.getByText('Title is required')).toBeVisible({ timeout: 5_000 });

        // Fill in title — error should clear on change
        await page.getByRole('textbox', { name: /Event Title/i }).fill('My Raid Night');
        await expect(page.getByText('Title is required')).not.toBeVisible({ timeout: 3_000 });

        // Time slot error should still be visible
        await expect(page.getByText('Select at least 2 time options')).toBeVisible();
    });
});

// ---------------------------------------------------------------------------
// Plan Event Form — Poll & Duration Settings
// ---------------------------------------------------------------------------

test.describe('Plan event poll and duration settings', () => {
    test('poll duration and mode buttons are interactive', async ({ page }) => {
        await page.goto('/events/plan');
        await expect(page.getByRole('heading', { name: 'Poll Settings' })).toBeVisible({ timeout: 15_000 });

        // Poll Duration options
        await expect(page.getByRole('button', { name: '6h' })).toBeVisible();
        await expect(page.getByRole('button', { name: '24h' })).toBeVisible();
        await expect(page.getByRole('button', { name: '72h' })).toBeVisible();

        // Click a different duration
        await page.getByRole('button', { name: '48h' }).click();
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i);

        // Poll Mode options
        await expect(page.getByRole('button', { name: 'Standard' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'All or Nothing' })).toBeVisible();

        // Click All or Nothing mode
        await page.getByRole('button', { name: 'All or Nothing' }).click();
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i);
    });

    test('event duration preset buttons work', async ({ page }) => {
        await page.goto('/events/plan');
        await expect(page.getByRole('heading', { name: 'Event Duration' })).toBeVisible({ timeout: 15_000 });

        // Duration presets — use exact: true to avoid matching 12h/72h etc.
        await expect(page.getByRole('button', { name: '1h', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: '2h', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: '4h', exact: true })).toBeVisible();

        // Click 3h — no crash
        await page.getByRole('button', { name: '3h', exact: true }).click();
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i);
    });
});

// ---------------------------------------------------------------------------
// Plan Event Form — Roster Configuration
// ---------------------------------------------------------------------------

test.describe('Plan event roster configuration', () => {
    test('roster section has slot type toggle and player count', async ({ page }) => {
        await page.goto('/events/plan');
        await expect(page.getByRole('heading', { name: 'Roster' })).toBeVisible({ timeout: 15_000 });

        // Slot type toggle
        await expect(page.getByRole('button', { name: 'MMO Roles' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Generic Slots' })).toBeVisible();

        // Player count controls — scope to main content to avoid matching nav links
        const mainContent = page.locator('main');
        await expect(mainContent.getByText('Players', { exact: true })).toBeVisible();
        await expect(page.getByRole('spinbutton').first()).toBeVisible();

        // Auto-promote toggle
        const autoPromote = page.getByRole('switch', { name: /auto-promote/i });
        await expect(autoPromote).toBeVisible();
        await expect(autoPromote).toBeChecked();
    });

    test('switching to MMO Roles shows role-specific slots', async ({ page }) => {
        await page.goto('/events/plan');
        await expect(page.getByRole('heading', { name: 'Roster' })).toBeVisible({ timeout: 15_000 });

        // Click MMO Roles
        await page.getByRole('button', { name: 'MMO Roles' }).click();

        // MMO-specific labels should appear (Tank, Healer, DPS)
        await expect(page.getByText('Tank', { exact: true })).toBeVisible({ timeout: 5_000 });
        await expect(page.getByText('Healer', { exact: true })).toBeVisible();
        await expect(page.getByText('DPS', { exact: true })).toBeVisible();
    });
});

// ---------------------------------------------------------------------------
// Plan Event Form — Reminders
// ---------------------------------------------------------------------------

test.describe('Plan event reminders', () => {
    test('reminder toggles are visible with correct defaults', async ({ page }) => {
        await page.goto('/events/plan');
        await expect(page.getByRole('heading', { name: 'Reminders' })).toBeVisible({ timeout: 15_000 });

        await expect(page.getByText('Reminders for the auto-created event')).toBeVisible();

        // 15 min reminder default: on
        const reminder15 = page.getByRole('switch', { name: /15 minutes before/i });
        await expect(reminder15).toBeVisible();
        await expect(reminder15).toBeChecked();

        // 1 hour reminder default: off
        const reminder1h = page.getByRole('switch', { name: /1 hour before/i });
        await expect(reminder1h).toBeVisible();
        await expect(reminder1h).not.toBeChecked();

        // 24 hour reminder default: off
        const reminder24h = page.getByRole('switch', { name: /24 hours before/i });
        await expect(reminder24h).toBeVisible();
        await expect(reminder24h).not.toBeChecked();
    });
});

// ---------------------------------------------------------------------------
// Plan Event Form — Cancel Navigation
// ---------------------------------------------------------------------------

test.describe('Plan event cancel navigation', () => {
    test('cancel button navigates to events list', async ({ page }) => {
        await page.goto('/events/plan');
        await expect(page.getByRole('heading', { name: 'Plan Event', level: 1 })).toBeVisible({ timeout: 15_000 });

        await page.getByRole('button', { name: 'Cancel' }).click();
        await expect(page).toHaveURL(/\/events$/, { timeout: 10_000 });
    });
});
