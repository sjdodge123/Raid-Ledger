/**
 * ROK-1647 — game search is fully keyboard-operable (spike ROK-1644 §7 S3).
 *
 * The Game field is the shared `Combobox`: ↑/↓ move the highlight
 * (`aria-activedescendant`), Enter picks, Esc closes. Covered on create event
 * and in the Add Character modal, where Esc must close only the listbox and
 * leave the dialog open. Both projects (desktop + mobile) run it.
 *
 * The games come from `api/scripts/seed-games.ts`, which CI seeds (see
 * profile-gaming.smoke.spec.ts). No sleeps: we wait on the search response for
 * the final query, then on the option itself.
 */
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './base';

const WOW_FOREVER = 'World of Warcraft: Forever';

/** Resolve when `/games/search` answers for exactly `q` (the debounced final query). */
function searchSettled(page: Page, q: string): Promise<unknown> {
    return page.waitForResponse((r) => {
        const url = new URL(r.url());
        return url.pathname.endsWith('/games/search') && url.searchParams.get('q') === q && r.ok();
    }, { timeout: 20_000 });
}

/** Type `name`, wait for its final results, then reach it with ArrowDown and pick it with Enter. */
async function pickByKeyboard(page: Page, input: Locator, name: string): Promise<void> {
    const settled = searchSettled(page, name);
    await input.click();
    await input.pressSequentially(name, { delay: 20 });
    await settled;
    const listbox = page.getByRole('listbox');
    const option = listbox.getByRole('option', { name, exact: true });
    await expect(option, `the seeded "${name}" should be in the game search results`).toBeVisible({ timeout: 10_000 });
    const optionId = await option.getAttribute('id');
    const index = Number(/-option-(\d+)$/.exec(optionId ?? '')?.[1]);
    expect(Number.isInteger(index), `option id "${optionId}" should end in -option-<n>`).toBe(true);
    await expect(input).toHaveAttribute('aria-expanded', 'true');
    for (let i = 0; i <= index; i++) await input.press('ArrowDown');
    await expect(input, 'ArrowDown should highlight the target option').toHaveAttribute('aria-activedescendant', optionId!);
    await input.press('Enter');
    await expect(input).toHaveValue(name);
    await expect(input).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('listbox')).toHaveCount(0);
}

/** Type a query, wait for the listbox, and close it with Escape. */
async function escapeCloses(page: Page, input: Locator, q: string): Promise<void> {
    const settled = searchSettled(page, q);
    await input.click();
    await input.pressSequentially(q, { delay: 20 });
    await settled;
    await expect(page.getByRole('listbox')).toBeVisible({ timeout: 10_000 });
    await input.press('Escape');
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await expect(input).toHaveAttribute('aria-expanded', 'false');
    await expect(input, 'Escape on an open listbox closes it without clearing the text').toHaveValue(q);
}

async function openCreateEvent(page: Page): Promise<Locator> {
    await page.goto('/events/new');
    await expect(page.getByRole('heading', { name: 'Create Event', level: 1 })).toBeVisible({ timeout: 15_000 });
    return page.getByRole('combobox', { name: 'Game', exact: true });
}

async function openAddCharacter(page: Page): Promise<{ dialog: Locator; input: Locator }> {
    await page.goto('/profile/gaming/characters');
    await page.getByRole('button', { name: 'Add Character' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add Character' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    return { dialog, input: dialog.getByRole('combobox', { name: 'Game', exact: true }) };
}

test.describe('Game search combobox — keyboard (ROK-1647)', () => {
    test('create event: ArrowDown + Enter picks a game', async ({ page }) => {
        const input = await openCreateEvent(page);
        await pickByKeyboard(page, input, WOW_FOREVER);
    });

    test('create event: Escape closes the results', async ({ page }) => {
        const input = await openCreateEvent(page);
        await escapeCloses(page, input, 'World of Warcraft');
    });

    test('Add Character: ArrowDown + Enter picks a game', async ({ page }) => {
        const { dialog, input } = await openAddCharacter(page);
        await pickByKeyboard(page, input, WOW_FOREVER);
        await expect(dialog, 'picking a game keeps the modal open').toBeVisible();
    });

    test('Add Character: the first Escape closes only the listbox', async ({ page }) => {
        const { dialog, input } = await openAddCharacter(page);
        await escapeCloses(page, input, 'World of Warcraft');
        await expect(dialog, 'the modal must survive the Escape that closed the listbox').toBeVisible();
    });
});
