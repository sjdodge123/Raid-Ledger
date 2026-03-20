/**
 * Profile account panel smoke tests — danger zone, delete account confirmation.
 *
 * The /profile/account page renders a "Danger Zone" section with a delete
 * account flow that requires typing the user's display name to confirm.
 * These tests verify the panel renders and the confirmation modal works
 * at both desktop and mobile viewports.
 *
 * Note: No password-change section exists on this page — the account panel
 * is exclusively the "Danger Zone" / delete-account flow.
 */
import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Profile Account — Desktop
// ---------------------------------------------------------------------------

test.describe('Profile account panel — desktop', () => {
    test.beforeEach(async ({ page }, testInfo) => {
        test.skip(testInfo.project.name === 'mobile', 'Desktop-only test');
        await page.goto('/profile/account');
    });

    test('renders Danger Zone heading and description', async ({ page }) => {
        await expect(page.getByRole('heading', { name: 'Danger Zone' })).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText('Irreversible actions that permanently affect your account.')).toBeVisible();
    });

    test('delete account section visible with warning text', async ({ page }) => {
        await expect(page.getByRole('heading', { name: 'Delete My Account' })).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText(/permanently delete your account/i)).toBeVisible();
        await expect(page.getByRole('button', { name: 'Delete My Account' })).toBeVisible();
    });

    test('delete button opens confirmation modal with disabled submit', async ({ page }) => {
        const deleteBtn = page.getByRole('button', { name: 'Delete My Account' });
        await expect(deleteBtn).toBeVisible({ timeout: 15_000 });
        await deleteBtn.click();

        // Modal appears with confirmation heading
        const modal = page.getByRole('dialog', { name: 'Delete Account' });
        await expect(modal).toBeVisible({ timeout: 5_000 });
        await expect(modal.getByRole('heading', { name: 'Delete Account' })).toBeVisible();

        // Warning text inside the modal
        await expect(modal.getByText('This action is permanent and cannot be undone.')).toBeVisible();

        // Confirm input and disabled submit button
        await expect(modal.getByRole('textbox', { name: /to confirm/i })).toBeVisible();
        await expect(modal.getByRole('button', { name: 'Delete My Account' })).toBeDisabled();

        // Cancel button is present and closes the modal
        await modal.getByRole('button', { name: 'Cancel' }).click();
        await expect(modal).not.toBeVisible({ timeout: 5_000 });
    });

    test('confirmation modal does not enable submit without matching name', async ({ page }) => {
        await page.getByRole('button', { name: 'Delete My Account' }).click({ timeout: 15_000 });

        const modal = page.getByRole('dialog', { name: 'Delete Account' });
        await expect(modal).toBeVisible({ timeout: 5_000 });

        // Type a wrong name — submit should stay disabled
        const confirmInput = modal.getByRole('textbox', { name: /to confirm/i });
        await confirmInput.fill('wrong-name-xyz');
        await expect(modal.getByRole('button', { name: 'Delete My Account' })).toBeDisabled();
    });
});

// ---------------------------------------------------------------------------
// Profile Account — Mobile
// ---------------------------------------------------------------------------

test.describe('Profile account panel — mobile', () => {
    test.beforeEach(async ({ page }, testInfo) => {
        test.skip(testInfo.project.name === 'desktop', 'Mobile-only test');
        await page.goto('/profile/account');
    });

    test('renders Danger Zone heading and description', async ({ page }) => {
        await expect(page.getByRole('heading', { name: 'Danger Zone' })).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText('Irreversible actions that permanently affect your account.')).toBeVisible();
    });

    test('delete account section visible with warning text', async ({ page }) => {
        await expect(page.getByRole('heading', { name: 'Delete My Account' })).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText(/permanently delete your account/i)).toBeVisible();
        await expect(page.getByRole('button', { name: 'Delete My Account' })).toBeVisible();
    });

    test('delete button opens confirmation modal with disabled submit', async ({ page }) => {
        const deleteBtn = page.getByRole('button', { name: 'Delete My Account' });
        await expect(deleteBtn).toBeVisible({ timeout: 15_000 });
        await deleteBtn.click();

        // Modal appears with confirmation heading
        const modal = page.getByRole('dialog', { name: 'Delete Account' });
        await expect(modal).toBeVisible({ timeout: 5_000 });
        await expect(modal.getByRole('heading', { name: 'Delete Account' })).toBeVisible();

        // Warning text inside the modal
        await expect(modal.getByText('This action is permanent and cannot be undone.')).toBeVisible();

        // Confirm input and disabled submit button
        await expect(modal.getByRole('textbox', { name: /to confirm/i })).toBeVisible();
        await expect(modal.getByRole('button', { name: 'Delete My Account' })).toBeDisabled();

        // Cancel button is present and closes the modal
        await modal.getByRole('button', { name: 'Cancel' }).click();
        await expect(modal).not.toBeVisible({ timeout: 5_000 });
    });

    test('confirmation modal does not enable submit without matching name', async ({ page }) => {
        await page.getByRole('button', { name: 'Delete My Account' }).click({ timeout: 15_000 });

        const modal = page.getByRole('dialog', { name: 'Delete Account' });
        await expect(modal).toBeVisible({ timeout: 5_000 });

        // Type a wrong name — submit should stay disabled
        const confirmInput = modal.getByRole('textbox', { name: /to confirm/i });
        await confirmInput.fill('wrong-name-xyz');
        await expect(modal.getByRole('button', { name: 'Delete My Account' })).toBeDisabled();
    });
});
