/**
 * ROK-1655 AC3 — the Add Character modal asks before it drops a draft.
 *
 * AddCharacterModal routes Escape, the backdrop, × and Cancel through
 * `useDirtyCloseGuard` (Modal `closeGuard`). A dirty form (a game picked, a
 * Name typed) gets "Discard your changes?": "Keep editing" keeps the draft,
 * "Discard" closes. An untouched form closes at once. The first Escape on an
 * open Game listbox still closes only the listbox (ROK-1647, see
 * game-search-combobox.smoke.spec.ts), dirty form or not.
 *
 * On the phone layout the primary action sits in the Modal's pinned footer, so
 * it is fully on screen right after the pick, without scrolling.
 *
 * The games come from `api/scripts/seed-games.ts`, which CI seeds. No sleeps:
 * we wait on the search response for the final query, then on the elements.
 */
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './base';
import { isPhoneLayout } from './helpers';

const WOW_FOREVER = 'World of Warcraft: Forever';
const DRAFT_NAME = 'Dirtyclose';
const CONFIRM_TITLE = 'Discard your changes?';

interface AddCharacter {
    dialog: Locator;
    game: Locator;
    name: Locator;
    confirm: Locator;
}

/** Resolve when `/games/search` answers for exactly `q` (the debounced final query). */
function searchSettled(page: Page, q: string): Promise<unknown> {
    return page.waitForResponse((r) => {
        const url = new URL(r.url());
        return url.pathname.endsWith('/games/search') && url.searchParams.get('q') === q && r.ok();
    }, { timeout: 20_000 });
}

/** Local copy of game-search-combobox.smoke's opener (kept local on purpose). */
async function openAddCharacter(page: Page): Promise<AddCharacter> {
    await page.goto('/profile/gaming/characters');
    await page.getByRole('button', { name: 'Add Character' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add Character' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    return {
        dialog,
        game: dialog.getByRole('combobox', { name: 'Game', exact: true }),
        name: dialog.getByRole('textbox', { name: 'Name', exact: true }),
        confirm: page.getByRole('dialog', { name: CONFIRM_TITLE }),
    };
}

/** Type the game, wait for its final results, reach it with ArrowDown and pick it with Enter. */
async function pickByKeyboard(page: Page, input: Locator, gameName: string): Promise<void> {
    const settled = searchSettled(page, gameName);
    await input.click();
    await input.pressSequentially(gameName, { delay: 20 });
    await settled;
    const option = page.getByRole('listbox').getByRole('option', { name: gameName, exact: true });
    await expect(option, `the seeded "${gameName}" should be in the game search results`).toBeVisible({ timeout: 10_000 });
    const optionId = String(await option.getAttribute('id'));
    const index = Number(/-option-(\d+)$/.exec(optionId)?.[1]);
    expect(Number.isInteger(index), `option id "${optionId}" should end in -option-<n>`).toBe(true);
    await expect(input).toHaveAttribute('aria-expanded', 'true');
    for (let i = 0; i <= index; i++) await input.press('ArrowDown');
    await expect(input, 'ArrowDown should highlight the target option').toHaveAttribute('aria-activedescendant', optionId);
    await input.press('Enter');
    await expect(input, 'Enter should pick the highlighted game').toHaveValue(gameName);
    await expect(page.getByRole('listbox')).toHaveCount(0);
}

/** ROK-1655: the primary action lives in the pinned footer, fully on screen with no scroll. */
async function expectPrimaryOnScreen(dialog: Locator): Promise<void> {
    const primary = dialog.getByTestId('modal-footer').getByRole('button', { name: 'Add Character', exact: true });
    await expect(primary, 'the footer primary should be fully on screen after the pick, without scrolling')
        .toBeInViewport({ ratio: 1 });
}

/** Open the modal, pick the game by keyboard and type a Name: a dirty draft. */
async function openDirtyDraft(page: Page, checkFooter = false): Promise<AddCharacter> {
    const ac = await openAddCharacter(page);
    await pickByKeyboard(page, ac.game, WOW_FOREVER);
    if (checkFooter) await expectPrimaryOnScreen(ac.dialog);
    await ac.name.fill(DRAFT_NAME);
    await expect(ac.name).toHaveValue(DRAFT_NAME);
    return ac;
}

/** Escape (from the Name input) asks; "Keep editing" returns to the untouched draft. */
async function escapeThenKeepEditing(ac: AddCharacter): Promise<void> {
    await ac.name.press('Escape');
    await expect(ac.confirm, 'Escape on a dirty form should ask before discarding').toBeVisible();
    await ac.confirm.getByRole('button', { name: 'Keep editing', exact: true }).click();
    await expect(ac.confirm, '"Keep editing" dismisses the confirm').toHaveCount(0);
    await expect(ac.dialog, '"Keep editing" returns to the Add Character modal').toBeVisible();
    await expect(ac.name, '"Keep editing" keeps the typed Name').toHaveValue(DRAFT_NAME);
    await expect(ac.game, '"Keep editing" keeps the picked game').toHaveValue(WOW_FOREVER);
}

/** Click the Add Character backdrop: a point beside the dialog, at mid-height. */
async function clickBackdrop(page: Page, dialog: Locator): Promise<void> {
    const box = await dialog.boundingBox();
    if (!box) throw new Error('the Add Character dialog should have a bounding box');
    await page.mouse.click(Math.max(1, box.x / 2), box.y + box.height / 2);
}

/** A backdrop click asks; "Discard" closes the modal and the draft does not come back. */
async function backdropThenDiscard(page: Page): Promise<void> {
    const ac = await openDirtyDraft(page);
    await clickBackdrop(page, ac.dialog);
    await expect(ac.confirm, 'a backdrop click on a dirty form should ask before discarding').toBeVisible();
    await ac.confirm.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(ac.confirm, '"Discard" dismisses the confirm').toHaveCount(0);
    await expect(ac.dialog, '"Discard" should close the Add Character modal').toHaveCount(0);
    const reopened = await openAddCharacter(page);
    await expect(reopened.game, 'the discarded game should not come back on reopen').toHaveValue('');
    await expect(reopened.name, 'the Name field only renders once a game is picked').toHaveCount(0);
}

/** An untouched form closes on Escape and never asks. */
async function cleanEscapeCloses(page: Page): Promise<void> {
    const ac = await openAddCharacter(page);
    await page.keyboard.press('Escape');
    await expect(ac.dialog, 'Escape on an untouched form should close it at once').toHaveCount(0);
    await expect(ac.confirm, 'an untouched form should never ask to discard').toHaveCount(0);
}

/** ROK-1647 on a dirty form: the first Escape closes only the Game listbox — no confirm. */
async function listboxEscapeOnDirtyForm(page: Page): Promise<void> {
    const ac = await openDirtyDraft(page);
    const q = 'World of Warcraft';
    const settled = searchSettled(page, q);
    await ac.game.fill('');
    await ac.game.pressSequentially(q, { delay: 20 });
    await settled;
    await expect(page.getByRole('listbox')).toBeVisible({ timeout: 10_000 });
    await ac.game.press('Escape');
    await expect(page.getByRole('listbox'), 'the first Escape closes the Game listbox').toHaveCount(0);
    await expect(ac.confirm, 'the Escape that closed the listbox must not ask to discard').toHaveCount(0);
    await expect(ac.dialog, 'the modal must survive the Escape that closed the listbox').toBeVisible();
    await expect(ac.game, 'Escape on an open listbox keeps the text').toHaveValue(q);
    // The typed Name is still in the draft, so the form is still dirty: × now asks.
    await ac.dialog.getByRole('button', { name: 'Close modal' }).click();
    await expect(ac.confirm, 'the draft is still dirty, so × should ask before discarding').toBeVisible();
}

test.describe('Add Character dirty close — desktop (ROK-1655)', () => {
    test.beforeEach(() => {
        test.skip(isPhoneLayout(test.info()), 'Desktop layout — the phone block below covers phones');
    });

    test('Escape on a dirty form asks; Keep editing keeps the draft', async ({ page }) => {
        await escapeThenKeepEditing(await openDirtyDraft(page));
    });

    test('backdrop click then Discard closes the modal', async ({ page }) => {
        await backdropThenDiscard(page);
    });

    test('an untouched form closes on Escape without asking', async ({ page }) => {
        await cleanEscapeCloses(page);
    });

    test('dirty form: the first Escape closes only the Game listbox', async ({ page }) => {
        await listboxEscapeOnDirtyForm(page);
    });
});

test.describe('Add Character dirty close — mobile (ROK-1655)', () => {
    test.beforeEach(() => {
        test.skip(!isPhoneLayout(test.info()), 'Phone layout — the desktop block above covers desktop');
    });

    test('pinned Add Character is on screen after the pick; Escape asks; Keep editing keeps the draft', async ({ page }) => {
        await escapeThenKeepEditing(await openDirtyDraft(page, true));
    });

    test('backdrop click then Discard closes the modal', async ({ page }) => {
        await backdropThenDiscard(page);
    });

    test('an untouched form closes on Escape without asking', async ({ page }) => {
        await cleanEscapeCloses(page);
    });

    test('dirty form: the first Escape closes only the Game listbox', async ({ page }) => {
        await listboxEscapeOnDirtyForm(page);
    });
});
