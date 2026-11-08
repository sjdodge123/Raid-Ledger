/**
 * ROK-2128 — pick the Add Character method ("Manual" / "Import from Armory" /
 * "Guild roster") explicitly, so a WoW spec does not depend on which method the
 * dialog opened on.
 *
 * Why: the dialog opens on "Guild roster" when the user owns no character of
 * that game and any visible Forever guild has an unlinked member (spec FLAG 9).
 * Guild/hub specs seed such guilds with `POST /admin/test/wow/seed-guild` and
 * leave them behind, so the opening method depends on spec order.
 */
import type { Locator, Page } from '@playwright/test';
import { expect } from './base';

export type AddCharacterMethod = 'Manual' | 'Import from Armory' | 'Guild roster';

const CANDIDATES_PATH = /\/plugins\/wow\/roster-claim\/candidates$/;

/**
 * Resolve when the browser has the roster-claim candidates for the picked game —
 * the read that decides whether the dialog defaults to "Guild roster".
 * Arm it BEFORE picking WoW: Forever, await it after (first open on a fresh page only:
 * the query is cached for 30s, so a reopen in the same page sends no request).
 */
export function rosterCandidatesSettled(page: Page): Promise<unknown> {
    return page.waitForResponse(
        (r) => r.request().method() === 'GET' && CANDIDATES_PATH.test(new URL(r.url()).pathname) && r.ok(),
        { timeout: 20_000 },
    );
}

/** The method button inside the dialog's "Add character by" group (not a same-named link elsewhere). */
export function addMethodButton(dialog: Locator, method: AddCharacterMethod): Locator {
    return dialog.getByRole('group', { name: 'Add character by' }).getByRole('button', { name: method, exact: true });
}

/**
 * Click `method` until it is the pressed one. Retrying covers a default that lands
 * a render after the click (the tab defaults are applied in effects when a query resolves).
 */
export async function selectAddMethod(dialog: Locator, method: AddCharacterMethod): Promise<Locator> {
    const button = addMethodButton(dialog, method);
    await expect(async () => {
        await button.click();
        await expect(button).toHaveAttribute('aria-pressed', 'true', { timeout: 1_000 });
    }, `the "${method}" method should become the pressed one`).toPass({ timeout: 15_000 });
    return button;
}
