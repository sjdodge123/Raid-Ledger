/**
 * "I'm away" panel smoke tests (ROK-1585).
 *
 * - Desktop (≥1024px): the D1 card under the week card (`profile-away-card`,
 *   `AwayPanel layout="inline"`) — add via a quick range + Undo, Remove + Undo.
 * - Phone layout (mobile AND tablet projects, 375×667 and 390×844): the drawer's
 *   `away-entry` row SWAPS the body for the stacked panel under a "‹ I'm away"
 *   header; nothing of the week shows underneath, the add button stays in the
 *   viewport, and ‹ returns to the week with the unsaved draft intact (AC5).
 * - One AC5 case under the light scheme (`data-scheme="light"`, the value
 *   `default-light` applies — `theme-helpers.ts::applyTheme`). The visual
 *   both-families verdict is a fleet test-plan step, not this file.
 *
 * Every absence a test creates carries a unique note (`reason`) so rows and API
 * records are found by THAT tag, never by position: the admin user is shared by
 * every project and worker running in parallel. `afterEach` deletes by tag.
 */
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './base';
import { isPhoneLayout } from './helpers';
import { apiDelete, apiGet, apiPost, getAdminToken } from './api-helpers';

interface AbsenceRow { id: number; startDate: string; endDate: string; reason: string | null }

const PHONE_VIEWPORTS = [
    { width: 375, height: 667 },
    { width: 390, height: 844 },
];

let token: string;
let tag: string;

test.beforeAll(async () => {
    token = await getAdminToken();
});

test.beforeEach(async ({}, testInfo) => {
    tag = `smoke-away-${testInfo.project.name}-w${testInfo.workerIndex}-${Date.now()}`;
});

test.afterEach(async () => {
    for (const row of await listAbsences()) {
        if (row.reason?.startsWith(tag)) await apiDelete(token, `/users/me/game-time/absences/${row.id}`);
    }
});

/** The admin's current + future absences, straight from the API. */
async function listAbsences(): Promise<AbsenceRow[]> {
    const res = await apiGet(token, '/users/me/game-time/absences?tzOffset=0');
    return ((res?.data ?? res) as AbsenceRow[] | null) ?? [];
}

/** Local `YYYY-MM-DD`, `days` from today. */
function isoDaysOut(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Seed a two-day absence a month out, tagged with `reason`. */
async function seedAbsence(reason: string): Promise<void> {
    await apiPost(token, '/users/me/game-time/absences', {
        startDate: isoDaysOut(30), endDate: isoDaysOut(31), reason,
    });
    await expect
        .poll(async () => (await listAbsences()).some((r) => r.reason === reason), {
            timeout: 15_000, message: `seeded absence "${reason}" never appeared in the API`,
        })
        .toBe(true);
}

/** Poll the API until an absence with this exact note does / does not exist. */
async function expectAbsenceInApi(reason: string, present: boolean): Promise<void> {
    await expect
        .poll(async () => (await listAbsences()).some((r) => r.reason === reason), {
            timeout: 15_000, message: `absence "${reason}" should ${present ? '' : 'NOT '}be in the API`,
        })
        .toBe(present);
}

/** The row carrying a given note (the meta line reads "N days · <note>"). */
function rowFor(scope: Locator, reason: string): Locator {
    return scope.getByTestId('away-row').filter({ hasText: reason });
}

/** Click Undo on the sonner toast whose text matches. */
async function undoToast(page: Page, text: RegExp): Promise<void> {
    const toast = page.locator('[data-sonner-toast]').filter({ hasText: text }).first();
    await expect(toast).toBeVisible({ timeout: 10_000 });
    await toast.getByRole('button', { name: 'Undo' }).click();
}

/** Fill the note, revealing it first. */
async function addNote(scope: Locator, reason: string): Promise<void> {
    const toggle = scope.getByTestId('away-note-toggle');
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    await scope.getByTestId('away-note').fill(reason);
}

/** Remove the seeded row, Undo brings it back — UI and API both. */
async function removeAndUndo(page: Page, scope: Locator, reason: string): Promise<void> {
    const row = rowFor(scope, reason);
    await expect(row).toHaveCount(1, { timeout: 15_000 });
    await row.getByTestId('away-row-remove').click();
    await expect(row).toHaveCount(0, { timeout: 10_000 });
    await expectAbsenceInApi(reason, false);
    await undoToast(page, /Removed /);
    await expect(row).toHaveCount(1, { timeout: 10_000 });
    await expectAbsenceInApi(reason, true);
}

// ---------------------------------------------------------------------------
// Desktop — D1 card under the week
// ---------------------------------------------------------------------------

test.describe('Game Time away card (desktop, ROK-1585 AC4c)', () => {
    test('Next week + note adds a row with an Undo toast; Remove + Undo on a seeded row', async ({ page }) => {
        test.skip(isPhoneLayout(test.info()), 'Desktop-only — the phone gets the drawer swap');
        const seeded = `${tag}-seed`;
        await seedAbsence(seeded);

        await page.goto('/profile/gaming/game-time');
        const card = page.getByTestId('profile-away-card');
        await expect(card).toBeVisible({ timeout: 15_000 });
        await card.scrollIntoViewIfNeeded();
        const panel = card.getByTestId('away-panel');
        await expect(panel).toHaveAttribute('data-layout', 'inline');
        await expect(panel.getByRole('heading', { name: /I'm away/ })).toContainText(/\d+ upcoming/);

        await removeAndUndo(page, panel, seeded);

        // ONE add line: chips · From · To · note · submit.
        const added = `${tag}-add`;
        await expect(panel.getByTestId('away-add-line')).toBeVisible();
        await panel.getByTestId('absence-pick-next-week').click();
        await expect(panel.getByTestId('absence-pick-next-week')).toHaveAttribute('aria-pressed', 'true');
        await addNote(panel, added);
        const submit = panel.getByTestId('absence-submit');
        await expect(submit).toHaveText('Add absence · 7 days');
        await submit.click();

        await expect(rowFor(panel, added)).toHaveCount(1, { timeout: 10_000 });
        await expectAbsenceInApi(added, true);
        // The form resets after an add.
        await expect(submit).toBeDisabled();
        await undoToast(page, /Away /);
        await expect(rowFor(panel, added)).toHaveCount(0, { timeout: 10_000 });
        await expectAbsenceInApi(added, false);
    });
});

// ---------------------------------------------------------------------------
// Phone layout — the drawer swap (A)
// ---------------------------------------------------------------------------

/** Make the week draft dirty: tap a free hour on a day with no block. */
async function dirtyTheWeek(page: Page): Promise<void> {
    await expect(page.getByTestId('block-editor-layer')).toBeAttached({ timeout: 10_000 });
    for (let day = 0; day < 7; day++) {
        const pick = page.getByTestId(`phone-week-strip-day-${day}`);
        await pick.click();
        await expect(pick).toHaveAttribute('aria-current', 'date');
        if ((await page.locator('[data-testid^="slot-block-"]').count()) === 0) break;
    }
    await expect
        .poll(async () => (await page.locator('[data-testid^="slot-day-target-"]').first().boundingBox())?.height ?? 0,
            { timeout: 10_000, message: 'the block layer never measured a row height' })
        .toBeGreaterThan(0);
    const cell = page.locator('[data-testid^="phone-cell-"]').first();
    await cell.scrollIntoViewIfNeeded();
    await cell.click({ force: true });
    await expect(page.getByTestId('selected-block-inspector')).toBeVisible();
    await expect(page.getByTestId('phone-week-save')).toBeEnabled();
}

/** Swap to the away view and prove nothing of the week shows under it. */
async function swapToAway(page: Page): Promise<Locator> {
    const entry = page.getByTestId('away-entry');
    await expect(entry).toBeVisible({ timeout: 15_000 });
    await entry.click();
    const panel = page.getByTestId('away-panel');
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await expect(panel).toHaveAttribute('data-layout', 'stacked');
    await expect(page.getByTestId('game-time-check-header')).toContainText("I'm away");
    await expect(page.getByTestId('away-back')).toBeVisible();
    for (const id of ['phone-week-view', 'phone-week-editor', 'phone-week-strip', 'phone-week-save', 'away-entry']) {
        await expect(page.getByTestId(id), `${id} still renders under the away panel`).toBeHidden();
    }
    // Hidden, not merely covered: a node under the panel would still have a box.
    expect(await page.getByTestId('phone-week-view').boundingBox(), 'the week view has a box under the panel').toBeNull();
    const submit = page.getByTestId('absence-submit');
    await expect(submit).toBeInViewport({ ratio: 1 });
    const viewport = page.viewportSize()!;
    const box = (await submit.boundingBox())!;
    expect(box.y + box.height, '"Add absence" falls past the bottom of the screen').toBeLessThanOrEqual(viewport.height);
    expect(box.height, '"Add absence" is under the 44px touch target').toBeGreaterThanOrEqual(44);
    return panel;
}

/** ‹ back to the week: the footer is on screen and the draft survived. */
async function backToWeek(page: Page): Promise<void> {
    await page.getByTestId('away-back').click();
    await expect(page.getByTestId('away-panel')).toHaveCount(0);
    await expect(page.getByTestId('phone-week-editor')).toBeVisible();
    const save = page.getByTestId('phone-week-save');
    await expect(save).toBeInViewport({ ratio: 1 });
    await expect(save, 'the unsaved week edit was lost across the swap').toBeEnabled();
}

async function openPhoneGameTime(page: Page): Promise<void> {
    await page.goto('/profile/gaming/game-time');
    await expect(page.getByTestId('game-time-check-sheet')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('phone-week-editor')).toBeVisible();
}

test.describe('Game Time away panel (phone layout, ROK-1585 AC5)', () => {
    test('the entry row swaps the drawer, nothing overlaps, ‹ keeps the draft — 375×667 and 390×844', async ({ page }) => {
        test.skip(!isPhoneLayout(test.info()), 'Phone-layout — desktop gets the D1 card');
        for (const size of PHONE_VIEWPORTS) {
            await page.setViewportSize(size);
            await openPhoneGameTime(page);
            await dirtyTheWeek(page);
            await swapToAway(page);
            await backToWeek(page);
        }
    });

    test('add (preset + note) with Undo, and Remove with Undo, update the list without a reload', async ({ page }) => {
        test.skip(!isPhoneLayout(test.info()), 'Phone-layout — desktop gets the D1 card');
        const seeded = `${tag}-seed`;
        await seedAbsence(seeded);
        await openPhoneGameTime(page);
        const panel = await swapToAway(page);

        await removeAndUndo(page, panel, seeded);

        const added = `${tag}-add`;
        await panel.getByTestId('absence-pick-weekend').click();
        await addNote(panel, added);
        const submit = page.getByTestId('absence-submit');
        await expect(submit).toHaveText('Add absence · 2 days');
        await submit.click();
        await expect(rowFor(panel, added)).toHaveCount(1, { timeout: 10_000 });
        await expectAbsenceInApi(added, true);
        // A4: adding keeps the viewer on the away view with the form reset.
        await expect(panel).toBeVisible();
        await expect(submit).toBeDisabled();
        await undoToast(page, /Away /);
        await expect(rowFor(panel, added)).toHaveCount(0, { timeout: 10_000 });
        await expectAbsenceInApi(added, false);
    });

    test('light scheme: the swap still covers the week and keeps "Add absence" on screen', async ({ page }) => {
        test.skip(!isPhoneLayout(test.info()), 'Phone-layout — desktop gets the D1 card');
        await page.setViewportSize(PHONE_VIEWPORTS[0]);
        await openPhoneGameTime(page);
        // Precedent: events.smoke.spec.ts — the attribute `default-light` sets.
        await page.evaluate(() => document.documentElement.setAttribute('data-scheme', 'light'));
        await dirtyTheWeek(page);
        await swapToAway(page);
        await backToWeek(page);
        expect(
            await page.evaluate(() => document.documentElement.getAttribute('data-scheme')),
            'the light scheme was reset mid-test — the case proved nothing about light',
        ).toBe('light');
    });
});
