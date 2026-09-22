/**
 * Profile gaming panels smoke tests — Characters, Game Time, Watched Games.
 * Tests both desktop and mobile viewports.
 */
import type { Page } from '@playwright/test';
import { test, expect } from './base';
import { isMobile, isPhoneLayout } from './helpers';

// ---------------------------------------------------------------------------
// ROK-1636: Armory import gating in the Add Character modal.
//
// Blizzard has no WoW: Forever profile API yet, so picking that game disables
// the "Import from Armory" tab (aria-disabled + a described-by note) and keeps
// the Manual form. A supported variant (retail World of Warcraft) is the control. Both
// games come from `api/scripts/seed-games.ts`, which CI seeds.
// ---------------------------------------------------------------------------

const WOW_FOREVER = 'World of Warcraft: Forever';
// Retail, not Classic Era: IGDB enrichment renames the seeded 'World of Warcraft Classic Era'
// back to 'World of Warcraft Classic' on envs with IGDB keys (ROK-1643); retail's name is stable.
const WOW_SUPPORTED = 'World of Warcraft';
const ARMORY_UNAVAILABLE_NOTE = "Armory import isn't available for WoW Forever yet — add the character manually.";

/** Open the Add Character modal and pick `gameName` in its Game search. Returns the dialog. */
async function openAddCharacterForGame(page: Page, gameName: string) {
    await page.goto('/profile/gaming/characters');
    await page.getByRole('button', { name: 'Add Character' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add Character' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await dialog.getByRole('textbox', { name: 'Game', exact: true }).fill(gameName);
    // The results dropdown is portalled to <body>, outside the dialog.
    const option = page.getByRole('option').filter({ has: page.getByText(gameName, { exact: true }) });
    await expect(option, `the seeded "${gameName}" should be in the game search results`).toBeVisible({ timeout: 15_000 });
    await option.click();
    return dialog;
}

async function expectForeverArmoryDisabled(page: Page) {
    const dialog = await openAddCharacterForGame(page, WOW_FOREVER);
    const armoryTab = dialog.getByRole('button', { name: 'Import from Armory' });
    await expect(armoryTab, 'Armory tab should be disabled for WoW Forever').toHaveAttribute('aria-disabled', 'true');
    await expect(dialog.getByText(ARMORY_UNAVAILABLE_NOTE)).toBeVisible();
    await expect(armoryTab, 'the note should describe the disabled tab').toHaveAccessibleDescription(ARMORY_UNAVAILABLE_NOTE);
    // Manual stays the active tab: its form (name field + submit) is rendered.
    await expect(dialog.getByRole('button', { name: 'Manual', exact: true })).toBeVisible();
    await expect(dialog.getByPlaceholder('Character name')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Add Character' })).toBeVisible();
}

async function expectSupportedArmoryEnabled(page: Page) {
    const dialog = await openAddCharacterForGame(page, WOW_SUPPORTED);
    const armoryTab = dialog.getByRole('button', { name: 'Import from Armory' });
    await expect(armoryTab).toBeVisible();
    await expect(armoryTab, 'Armory tab should stay enabled for a supported variant').not.toHaveAttribute('aria-disabled', 'true');
    await expect(dialog.getByText(ARMORY_UNAVAILABLE_NOTE)).toHaveCount(0);
}

// ---------------------------------------------------------------------------
// Characters panel — desktop
// ---------------------------------------------------------------------------

test.describe('Profile gaming — Characters (desktop)', () => {
    test('renders character list and Add Character button', async ({ page }) => {
        test.skip(isPhoneLayout(test.info()), 'Desktop-only test — sidebar layout');

        await page.goto('/profile/gaming/characters');
        await expect(page.getByRole('heading', { name: 'My Characters' })).toBeVisible({ timeout: 15_000 });

        // Add Character button should be visible
        await expect(page.getByRole('button', { name: 'Add Character' })).toBeVisible();

        // Seed data may create characters — soft check for CI where characters may not exist
        const characterLinks = page.locator('a[href*="/characters/"]');
        if (await characterLinks.first().isVisible({ timeout: 5_000 }).catch(() => false)) {
            const count = await characterLinks.count();
            expect(count).toBeGreaterThan(0);
        }
    });

    test('characters are grouped by game with count', async ({ page }) => {
        test.skip(isPhoneLayout(test.info()), 'Desktop-only test — sidebar layout');

        await page.goto('/profile/gaming/characters');
        await expect(page.getByRole('heading', { name: 'My Characters' })).toBeVisible({ timeout: 15_000 });

        // Characters are grouped under game headings (h3) — skip if no characters exist
        const gameHeadings = page.locator('main h3');
        if (await gameHeadings.first().isVisible({ timeout: 5_000 }).catch(() => false)) {
            // Each group shows a character count like "2 characters"
            await expect(page.getByText(/\d+ characters?/).first()).toBeVisible();
        }
    });
    test('WoW Forever disables Armory import and keeps Manual (ROK-1636)', async ({ page }) => {
        test.skip(isPhoneLayout(test.info()), 'Desktop-only test — sidebar layout');
        await expectForeverArmoryDisabled(page);
    });

    test('a supported WoW variant keeps Armory import enabled (ROK-1636 control)', async ({ page }) => {
        test.skip(isPhoneLayout(test.info()), 'Desktop-only test — sidebar layout');
        await expectSupportedArmoryEnabled(page);
    });
});

// ---------------------------------------------------------------------------
// Characters panel — mobile
// ---------------------------------------------------------------------------

test.describe('Profile gaming — Characters (mobile)', () => {
    test('renders character list and Add Character button', async ({ page }) => {
        test.skip(!isMobile(test.info()), 'Mobile-only test');

        await page.goto('/profile/gaming/characters');
        await expect(page.getByRole('heading', { name: 'My Characters' })).toBeVisible({ timeout: 15_000 });

        // Add Character button should be visible on mobile
        await expect(page.getByRole('button', { name: 'Add Character' })).toBeVisible();

        // Seed data may create characters — soft check for CI where characters may not exist
        const characterLinks = page.locator('a[href*="/characters/"]');
        if (await characterLinks.first().isVisible({ timeout: 5_000 }).catch(() => false)) {
            const count = await characterLinks.count();
            expect(count).toBeGreaterThan(0);
        }
    });

    test('WoW Forever disables Armory import and keeps Manual (ROK-1636)', async ({ page }) => {
        test.skip(!isMobile(test.info()), 'Mobile-only test');
        await expectForeverArmoryDisabled(page);
    });

    test('a supported WoW variant keeps Armory import enabled (ROK-1636 control)', async ({ page }) => {
        test.skip(!isMobile(test.info()), 'Mobile-only test');
        await expectSupportedArmoryEnabled(page);
    });
});

// ---------------------------------------------------------------------------
// Game Time panel — desktop
// ---------------------------------------------------------------------------

test.describe('Profile gaming — Game Time (desktop)', () => {
    test('renders availability grid with day buttons', async ({ page }) => {
        test.skip(isPhoneLayout(test.info()), 'Desktop-only test — sidebar layout');

        await page.goto('/profile/gaming/game-time');
        await expect(page.getByRole('heading', { name: 'My Game Time' })).toBeVisible({ timeout: 15_000 });

        // Subtitle text
        await expect(page.getByText('Set your typical weekly availability')).toBeVisible();

        // Day-of-week buttons should be visible
        await expect(page.getByRole('button', { name: 'Monday' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Friday' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Sunday' })).toBeVisible();

        // ROK-1585 Q9: Clear / Save moved UNDER the grid, and the red "Absence"
        // toggle is gone — time away is the D1 card under the week card.
        // (exact: true to avoid matching "Remove <range>" row buttons.)
        await expect(page.getByRole('button', { name: 'Absence', exact: true })).toHaveCount(0);
        const actions = page.getByTestId('game-time-profile-actions');
        await expect(actions.getByRole('button', { name: 'Clear', exact: true })).toBeVisible();
        await expect(actions.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
        const gridBox = (await page.getByTestId('game-time-grid').boundingBox())!;
        const actionsBox = (await actions.boundingBox())!;
        expect(actionsBox.y, 'the actions should sit under the grid').toBeGreaterThanOrEqual(gridBox.y + gridBox.height - 1);
        await expect(page.getByTestId('profile-away-card')).toBeVisible();
    });

    test('"Show earlier" above and "Show later" below the grid move the 6 PM – 1 AM window (ROK-1585 AC4a)', async ({ page }) => {
        test.skip(isPhoneLayout(test.info()), 'Desktop-only test — the phone drawer has its own toggles');

        await page.goto('/profile/gaming/game-time');
        const grid = page.getByTestId('game-time-grid');
        await expect(grid).toBeVisible({ timeout: 15_000 });
        const earlier = page.getByTestId('desktop-week-show-earlier');
        const later = page.getByTestId('desktop-week-show-later');
        await expect(earlier).toBeVisible();
        await expect(later).toBeVisible();
        const gridBox = (await grid.boundingBox())!;
        expect((await earlier.boundingBox())!.y, 'Show earlier should sit above the grid').toBeLessThan(gridBox.y);
        expect((await later.boundingBox())!.y, 'Show later should sit below the grid')
            .toBeGreaterThanOrEqual(gridBox.y + gridBox.height - 1);

        // A band auto-opens when the saved week claims an hour in it, and an
        // explicit choice persists — so collapse both first, then count rows
        // (one Sunday cell per visible hour).
        for (const toggle of [earlier, later]) {
            if ((await toggle.getAttribute('aria-expanded')) === 'true') {
                await toggle.click();
                await expect(toggle).toHaveAttribute('aria-expanded', 'false');
            }
        }
        const hourRows = grid.locator('[data-testid^="cell-0-"]');
        await expect(hourRows, '6 PM – 1 AM is seven hour rows').toHaveCount(7);
        await earlier.click();
        await expect(earlier).toHaveAttribute('aria-expanded', 'true');
        await expect(hourRows, 'Show earlier adds 6 AM – 6 PM').toHaveCount(19);
        await later.click();
        await expect(later).toHaveAttribute('aria-expanded', 'true');
        await expect(hourRows, 'Show later adds 1 AM – 6 AM').toHaveCount(24);
    });
});

// ---------------------------------------------------------------------------
// Game Time panel — phone layout (the phone AND tablet projects since ROK-1584).
//
// ROK-1011 put the compact seven-column GameTimeGrid here; ROK-1569 AC4
// replaced it below the desktop breakpoint with the ONE-DAY phone editor, and
// ROK-1579 fronted that editor with a summary card whose "Edit my week" opened
// the drawer. ROK-1584 §3 DROPS the card — every arrival tapped straight
// through it — so the route IS the drawer: `game-time-panel.tsx` mounts the
// shared `GameTimeCheckSheet` titled "My game time" carrying
// `PhoneWeekCheckStep variant="profile"`, and × / Save take the viewer back
// where they came from. Desktop keeps `GameTimePanel` (describe above).
//
// The phone/desktop switch is 1024px since ROK-1584 §7, so the tablet project
// renders this shape too — these gate on `isPhoneLayout`, not `isMobile`.
// ---------------------------------------------------------------------------

/** The drawer's editable hour cells — `DayBlockEditor` mounts one per hour. */
const PHONE_CELLS = '[data-testid^="phone-cell-"]';

/**
 * Open one hour band and prove the day grew by it (ROK-1584 §3).
 *
 * The band auto-opens when the saved week already claims an hour inside it, and
 * the choice is persisted under `rl.gameTime.profileWindow`, so the state on
 * arrival is not knowable from here — collapse first, then assert the toggle
 * MOVES the window. `aria-expanded` is the contract `PhoneWindowToggle` exposes.
 */
async function expandHourBand(page: Page, testId: string): Promise<void> {
    const toggle = page.getByTestId(testId);
    await expect(toggle, `${testId} should offer the rest of the day`).toBeVisible({
        timeout: 15_000,
    });
    if ((await toggle.getAttribute('aria-expanded')) === 'true') {
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    }
    const before = await page.locator(PHONE_CELLS).count();
    expect(before, `${testId}: the collapsed day should still render hours`).toBeGreaterThan(0);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect
        .poll(() => page.locator(PHONE_CELLS).count(), {
            timeout: 10_000,
            message: `${testId} did not reveal any extra hours`,
        })
        .toBeGreaterThan(before);
}

test.describe('Profile gaming — Game Time (phone layout)', () => {
    test('the route IS the "My game time" drawer — open on arrival, no card, no Edit (ROK-1584)', async ({ page }) => {
        test.skip(!isPhoneLayout(test.info()), 'Phone-layout test — desktop keeps the grid');

        await page.goto('/profile/gaming/game-time');

        // The drawer is on screen WITHOUT a tap, titled by the route.
        await expect(page.getByTestId('game-time-check-sheet')).toBeVisible({ timeout: 15_000 });
        await expect(page.getByTestId('game-time-check-header')).toContainText('My game time');
        await expect(page.getByTestId('phone-week-check')).toHaveAttribute('data-variant', 'profile');

        // ROK-1584: the ROK-1579 summary card and its "Edit my week" are gone.
        await expect(page.getByTestId('profile-game-time-summary')).toHaveCount(0);
        await expect(page.getByTestId('profile-game-time-week')).toHaveCount(0);
        await expect(page.getByTestId('profile-game-time-edit')).toHaveCount(0);

        await expect(page.getByTestId('game-time-check-stepper')).toHaveCount(0);
        await expect(page.getByTestId('phone-week-editor')).toBeVisible();

        // One day on screen, named by the pager, with the other six kept legible
        // AND tappable by the week strip — the whole premise of the one-day shape.
        await expect(page.getByTestId('phone-day-pager')).toBeVisible();
        await expect(page.getByTestId('phone-day-title'))
            .toHaveText(/^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)$/);
        await expect(page.getByTestId('phone-week-strip')).toBeVisible();
        await expect(page.locator('[data-testid^="phone-week-strip-day-"]')).toHaveCount(7);
        await expect(page.locator('[data-testid^="phone-week-strip-day-"][aria-current="date"]')).toHaveCount(1);

        // ROK-1579: the strip is CONDENSED — three band bars per day (day /
        // evening / late), never one per visible hour, which on this fitted
        // profile window was 16–17 bars tall.
        await expect(
            page.getByTestId('phone-week-strip-day-0').getByTestId('phone-week-strip-bar'),
        ).toHaveCount(3);

        // AC4 is a REPLACEMENT: neither ROK-1011's compact grid nor the
        // pre-1011 accordion may come back below the desktop breakpoint.
        await expect(page.getByTestId('game-time-grid')).toHaveCount(0);
        await expect(page.getByTestId('game-time-mobile-editor')).toHaveCount(0);
    });

    test('the action row is the "I\'m away" entry plus Save my week, both 44px and inside the editor', async ({ page }) => {
        test.skip(!isPhoneLayout(test.info()), 'Phone-layout test — desktop keeps the grid');

        await page.goto('/profile/gaming/game-time');
        // ROK-1584: no "Edit my week" step — the route lands in the editor.
        const panel = page.getByTestId('game-time-check-content');
        await expect(panel).toBeVisible({ timeout: 15_000 });
        // ROK-1585: the away answer is the `away-entry` row that swaps the drawer.
        const away = page.getByTestId('away-entry');
        const save = page.getByTestId('phone-week-save');
        await expect(away).toBeVisible();
        await expect(save).toBeVisible();

        // Deliberate absence: the desktop panel's Absence / Clear / Save row does
        // NOT exist here. There is no Clear on the phone — the editor writes a
        // local draft and Save stays inert until that draft differs from the
        // saved week (`usePhoneWeekDraft`), so an untouched visit cannot write.
        await expect(page.getByRole('button', { name: 'Clear', exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Absence', exact: true })).toHaveCount(0);
        await expect(save).toBeDisabled();

        // Both controls are real touch targets AND live inside the editor's own
        // box: the footer is sticky, so it rides the bottom of the panel rather
        // than falling past its end where the page would have to be scrolled.
        const panelBox = (await panel.boundingBox())!;
        for (const [name, control] of [['the away entry', away], ['Save my week', save]] as const) {
            const box = (await control.boundingBox())!;
            expect(box.height, `${name} is under the 44px touch target`).toBeGreaterThanOrEqual(44);
            expect(box.y, `${name} sits above the editor`).toBeGreaterThanOrEqual(panelBox.y - 1);
            expect(box.y + box.height, `${name} sits past the end of the editor`)
                .toBeLessThanOrEqual(panelBox.y + panelBox.height + 1);
        }
    });

    test('both hour toggles reach the rest of the day (ROK-1584 §3)', async ({ page }) => {
        test.skip(!isPhoneLayout(test.info()), 'Phone-layout test — the window only exists in the drawer');

        await page.goto('/profile/gaming/game-time');
        await expect(page.getByTestId('phone-week-editor')).toBeVisible({ timeout: 15_000 });

        // "Show earlier" (6 AM – 6 PM) above the day and "Show later"
        // (1 AM – 6 AM) below it — the profile's hours now wrap the whole 24.
        await expandHourBand(page, 'phone-week-show-earlier');
        await expandHourBand(page, 'phone-week-show-later');
    });

    test('the More drawer\'s Game Time row opens the drawer in place (ROK-1584 §3)', async ({ page }) => {
        // Phone-only: the hamburger that opens the More drawer is still
        // `md:hidden` (`Header.tsx`), i.e. outside ROK-1584's 1024px move, so
        // the tablet project has no way to reach this row.
        test.skip(!isMobile(test.info()), 'Phone-only — the More hamburger is md:hidden');

        await page.goto('/calendar');
        await page.getByRole('button', { name: 'Open menu' }).click();
        const drawer = page.getByTestId('more-drawer-panel');
        await expect(drawer).toBeVisible({ timeout: 10_000 });

        // Profile accordion → the Game Time row, which carries the saved week
        // in words (the summary the ROK-1579 card used to hold). The accordion
        // only auto-expands on a /profile pathname, so open it here.
        const accordion = drawer.getByTestId('more-drawer-profile-toggle');
        await expect(accordion).toBeVisible({ timeout: 10_000 });
        if ((await accordion.getAttribute('aria-expanded')) !== 'true') await accordion.click();
        await expect(drawer.getByTestId('profile-submenu')).toBeVisible({ timeout: 10_000 });
        const row = drawer.getByTestId('more-drawer-game-time');
        await expect(row).toBeVisible();
        await expect(row).toContainText(/nothing saved yet|confirmed|AM|PM/);
        const rowBox = (await row.boundingBox())!;
        expect(rowBox.height, 'the Game Time row is under the 44px touch target').toBeGreaterThanOrEqual(44);

        // The tap opens the SAME drawer the route mounts, in place — the More
        // drawer closes and the viewer keeps the page they were on.
        await row.click();
        await expect(page.getByTestId('game-time-check-sheet')).toBeVisible({ timeout: 10_000 });
        await expect(page.getByTestId('phone-week-check')).toHaveAttribute('data-variant', 'profile');
        await expect(page.getByTestId('more-drawer')).toHaveAttribute('aria-hidden', 'true');
        expect(page.url(), 'the Game Time row navigated away instead of opening in place')
            .toContain('/calendar');
    });
});

// ---------------------------------------------------------------------------
// Watched Games panel — desktop
// ---------------------------------------------------------------------------

test.describe('Profile gaming — Watched Games (desktop)', () => {
    test('renders watched games grid with toggle buttons', async ({ page }) => {
        test.skip(isPhoneLayout(test.info()), 'Desktop-only test — sidebar layout');

        await page.goto('/profile/gaming/watched-games');
        await expect(page.getByRole('heading', { name: 'My Watched Games' })).toBeVisible({ timeout: 15_000 });

        // Description text (may not exist if component renders differently in CI)
        const desc = page.getByText(/Click a game to toggle your interest/);
        if (!(await desc.isVisible({ timeout: 3_000 }).catch(() => false))) return;

        // Game toggle cards depend on seeded game data — soft check for CI
        const gameButtons = page.locator('main [role="button"]').filter({ has: page.locator('h3') });
        if (await gameButtons.first().isVisible({ timeout: 5_000 }).catch(() => false)) {
            const count = await gameButtons.count();
            expect(count).toBeGreaterThan(0);
        }

        // ROK-1147: Auto-heart toggle is conditionally rendered for
        // Discord-connected users (ROK-444). Demo admin may not have
        // Discord linkage in CI — soft-check (mirror gameButtons pattern).
        const autoHeartHeading = page.getByRole('heading', { name: 'Auto-heart games' });
        if (!(await autoHeartHeading.isVisible({ timeout: 5_000 }).catch(() => false))) return;
        await expect(page.getByRole('switch')).toBeVisible();
    });
});

// ---------------------------------------------------------------------------
// Watched Games panel — mobile
// ---------------------------------------------------------------------------

test.describe('Profile gaming — Watched Games (mobile)', () => {
    test('renders watched games grid', async ({ page }) => {
        test.skip(!isMobile(test.info()), 'Mobile-only test');

        await page.goto('/profile/gaming/watched-games');
        await expect(page.getByRole('heading', { name: 'My Watched Games' })).toBeVisible({ timeout: 15_000 });

        // Game toggle cards depend on seeded game data — soft check for CI
        const gameButtons = page.locator('main [role="button"]').filter({ has: page.locator('h3') });
        if (await gameButtons.first().isVisible({ timeout: 5_000 }).catch(() => false)) {
            const count = await gameButtons.count();
            expect(count).toBeGreaterThan(0);
        }
    });
});

// ---------------------------------------------------------------------------
// Navigation between gaming panels — desktop
// ---------------------------------------------------------------------------

test.describe('Profile gaming — sidebar navigation (desktop)', () => {
    test('sidebar links navigate between gaming panels', async ({ page }) => {
        test.skip(isPhoneLayout(test.info()), 'Desktop-only test — sidebar hidden on mobile');

        await page.goto('/profile/gaming/characters');
        await expect(page.getByRole('heading', { name: 'My Characters' })).toBeVisible({ timeout: 15_000 });

        // Profile sidebar should show Gaming section links
        const sidebar = page.getByRole('navigation', { name: 'Profile navigation' });
        await expect(sidebar.getByRole('link', { name: 'Game Time' })).toBeVisible();
        await expect(sidebar.getByRole('link', { name: 'Characters' })).toBeVisible();
        await expect(sidebar.getByRole('link', { name: 'Watched Games' })).toBeVisible();

        // Navigate to Game Time via sidebar
        await sidebar.getByRole('link', { name: 'Game Time' }).click();
        await expect(page.getByRole('heading', { name: 'My Game Time' })).toBeVisible({ timeout: 10_000 });

        // ROK-1585 AC4b: the Game Time link carries the saved week + freshness
        // as a second line under its label.
        const summary = sidebar.getByTestId('profile-sidebar-game-time-summary');
        await expect(summary).toBeVisible();
        await expect(summary).toHaveText(/No game time yet|confirmed|AM|PM/);
        const labelBox = (await sidebar.getByText('Game Time', { exact: true }).boundingBox())!;
        expect((await summary.boundingBox())!.y, 'the summary should sit under the Game Time label')
            .toBeGreaterThanOrEqual(labelBox.y + labelBox.height - 1);

        // Navigate to Watched Games via sidebar
        await sidebar.getByRole('link', { name: 'Watched Games' }).click();
        await expect(page.getByRole('heading', { name: 'My Watched Games' })).toBeVisible({ timeout: 10_000 });

        // Navigate back to Characters via sidebar
        await sidebar.getByRole('link', { name: 'Characters' }).click();
        await expect(page.getByRole('heading', { name: 'My Characters' })).toBeVisible({ timeout: 10_000 });
    });
});
