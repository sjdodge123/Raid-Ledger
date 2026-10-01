/**
 * Open StartLineupModal through the `?test=open-lineup-modal` hook (ROK-1167)
 * and reveal one field behind its "More options" disclosure (ROK-1302).
 *
 * Imported by `community-lineup.smoke.spec.ts` and
 * `lineup-votes-per-player.smoke.spec.ts`. This file is deliberately not named
 * `*helpers`, so `scripts/smoke/scope-specs.sh` does not treat it as a shared
 * surface: a diff that changes it alongside an unrelated spec scopes to that
 * spec only. Run both importers by name when changing it.
 *
 * The open is retried as a whole, not asserted once, because two things go
 * wrong on a shared env and both are fixed by starting over:
 *
 * - Under shared-env load the `?test=open-lineup-modal` modal sometimes never
 *   opens at all (TDB:462, TDB:515).
 * - `StartLineupModal` sits at a different child index in
 *   `web/src/components/lineups/LineupBanner.tsx`'s no-banner branch than in
 *   its banner branch. When a sibling worker changes what `/lineups/banner`
 *   returns (creates or archives a lineup) while this page is open, the banner
 *   flips branch, React remounts the modal, and the expanded "More options"
 *   section collapses — the field that was just revealed disappears.
 *
 * Re-navigating is the recovery: each attempt reloads `/games`, re-opens the
 * modal and re-expands the section. Every action and assertion in an attempt
 * carries its own timeout, so a stuck attempt (the modal remounted between the
 * click and the scroll, leaving the field attached but without layout) throws
 * and the next attempt starts, instead of one action waiting out the whole
 * budget. Every assertion is the same one the specs made inline before; only
 * the window is retried (the ROK-1533 pattern). The 45s budget fits inside the
 * callers' `test.setTimeout(60_000)`.
 */
import { expect, type Locator, type Page } from '@playwright/test';

/** The opened dialog and the revealed field, both visible on return. */
export interface StartLineupModalField {
    modal: Locator;
    field: Locator;
}

/** Per-action bound inside one attempt; well under the 45s overall budget. */
const ATTEMPT_ACTION_TIMEOUT_MS = 5_000;

/**
 * Navigate to `/games?test=open-lineup-modal`, expand "More options" and
 * scroll the `data-testid={testId}` control into view.
 *
 * @param page - The test's page (an operator/admin session).
 * @param testId - `data-testid` of a control inside the "More options" section.
 * @param extra - Optional checks on the opened modal that need the section
 *   expanded (e.g. label visibility). They run inside the retried window, so a
 *   remount that collapses the section re-runs the whole attempt rather than
 *   failing a check made after this function returned.
 * @returns The modal and the field locators, asserted visible.
 */
export async function revealStartLineupModalField(
    page: Page,
    testId: string,
    extra?: (modal: Locator) => Promise<void>,
): Promise<StartLineupModalField> {
    const modal = page.locator('[role="dialog"]');
    const field = modal.locator(`[data-testid="${testId}"]`);
    await expect(async () => {
        await page.goto('/games?test=open-lineup-modal');
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, {
            timeout: 10_000,
        });
        await expect(modal).toBeVisible({ timeout: 15_000 });
        await modal.getByText(/more options/i).click({ timeout: ATTEMPT_ACTION_TIMEOUT_MS });
        await field.scrollIntoViewIfNeeded({ timeout: ATTEMPT_ACTION_TIMEOUT_MS });
        await expect(field).toBeVisible({ timeout: ATTEMPT_ACTION_TIMEOUT_MS });
        if (extra) await extra(modal);
    }).toPass({ timeout: 45_000, intervals: [1_000] });
    return { modal, field };
}
