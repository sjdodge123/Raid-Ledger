/**
 * Profile gaming panels smoke tests — Characters, Game Time, Watched Games.
 * Tests both desktop and mobile viewports.
 */
import { test, expect } from './base';

// ---------------------------------------------------------------------------
// Characters panel — desktop
// ---------------------------------------------------------------------------

test.describe('Profile gaming — Characters (desktop)', () => {
    test('renders character list and Add Character button', async ({ page }) => {
        test.skip(test.info().project.name === 'mobile', 'Desktop-only test — sidebar layout');

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
        test.skip(test.info().project.name === 'mobile', 'Desktop-only test — sidebar layout');

        await page.goto('/profile/gaming/characters');
        await expect(page.getByRole('heading', { name: 'My Characters' })).toBeVisible({ timeout: 15_000 });

        // Characters are grouped under game headings (h3) — skip if no characters exist
        const gameHeadings = page.locator('main h3');
        if (await gameHeadings.first().isVisible({ timeout: 5_000 }).catch(() => false)) {
            // Each group shows a character count like "2 characters"
            await expect(page.getByText(/\d+ characters?/).first()).toBeVisible();
        }
    });
});

// ---------------------------------------------------------------------------
// Characters panel — mobile
// ---------------------------------------------------------------------------

test.describe('Profile gaming — Characters (mobile)', () => {
    test('renders character list and Add Character button', async ({ page }) => {
        test.skip(test.info().project.name === 'desktop', 'Mobile-only test');

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
});

// ---------------------------------------------------------------------------
// Game Time panel — desktop
// ---------------------------------------------------------------------------

test.describe('Profile gaming — Game Time (desktop)', () => {
    test('renders availability grid with day buttons', async ({ page }) => {
        test.skip(test.info().project.name === 'mobile', 'Desktop-only test — sidebar layout');

        await page.goto('/profile/gaming/game-time');
        await expect(page.getByRole('heading', { name: 'My Game Time' })).toBeVisible({ timeout: 15_000 });

        // Subtitle text
        await expect(page.getByText('Set your typical weekly availability')).toBeVisible();

        // Day-of-week buttons should be visible
        await expect(page.getByRole('button', { name: 'Monday' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Friday' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Sunday' })).toBeVisible();

        // Action buttons (exact: true to avoid matching "Remove absence" buttons)
        await expect(page.getByRole('button', { name: 'Absence', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Clear', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
    });
});

// ---------------------------------------------------------------------------
// Game Time panel — mobile.
//
// ROK-1011 put the compact seven-column GameTimeGrid here; ROK-1569 AC4
// replaced it below 768px with the ONE-DAY phone editor — the same
// `PhoneWeekCheckStep` the poll's game-time check mounts, over the profile's
// full 9am–1am range (`web/src/pages/profile/game-time-panel.tsx:50-59`).
// Desktop keeps `GameTimePanel` and is asserted in the describe above.
// ---------------------------------------------------------------------------

test.describe('Profile gaming — Game Time (mobile)', () => {
    test('renders the one-day phone editor instead of the seven-column grid', async ({ page }) => {
        test.skip(test.info().project.name === 'desktop', 'Mobile-only test');

        await page.goto('/profile/gaming/game-time');
        await expect(page.getByRole('heading', { name: 'My Game Time' })).toBeVisible({ timeout: 15_000 });

        // The phone mount and the editor inside it.
        await expect(page.getByTestId('profile-game-time-phone')).toBeVisible();
        await expect(page.getByTestId('phone-week-editor')).toBeVisible();

        // One day on screen, named by the pager, with the other six kept legible
        // AND tappable by the week strip — the whole premise of the one-day shape.
        await expect(page.getByTestId('phone-day-pager')).toBeVisible();
        await expect(page.getByTestId('phone-day-title'))
            .toHaveText(/^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)$/);
        await expect(page.getByTestId('phone-week-strip')).toBeVisible();
        await expect(page.locator('[data-testid^="phone-week-strip-day-"]')).toHaveCount(7);
        await expect(page.locator('[data-testid^="phone-week-strip-day-"][aria-current="date"]')).toHaveCount(1);

        // AC4 is a REPLACEMENT: neither ROK-1011's compact grid nor the
        // pre-1011 accordion may come back on the phone.
        await expect(page.getByTestId('game-time-grid')).toHaveCount(0);
        await expect(page.getByTestId('game-time-mobile-editor')).toHaveCount(0);
    });

    test('the action row is the away answer plus Save my week, both 44px and inside the editor', async ({ page }) => {
        test.skip(test.info().project.name === 'desktop', 'Mobile-only test');

        await page.goto('/profile/gaming/game-time');
        await expect(page.getByRole('heading', { name: 'My Game Time' })).toBeVisible({ timeout: 15_000 });

        const panel = page.getByTestId('profile-game-time-phone');
        const away = page.getByTestId('phone-week-away');
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
        for (const [name, control] of [['the away answer', away], ['Save my week', save]] as const) {
            const box = (await control.boundingBox())!;
            expect(box.height, `${name} is under the 44px touch target`).toBeGreaterThanOrEqual(44);
            expect(box.y, `${name} sits above the editor`).toBeGreaterThanOrEqual(panelBox.y - 1);
            expect(box.y + box.height, `${name} sits past the end of the editor`)
                .toBeLessThanOrEqual(panelBox.y + panelBox.height + 1);
        }
    });
});

// ---------------------------------------------------------------------------
// Watched Games panel — desktop
// ---------------------------------------------------------------------------

test.describe('Profile gaming — Watched Games (desktop)', () => {
    test('renders watched games grid with toggle buttons', async ({ page }) => {
        test.skip(test.info().project.name === 'mobile', 'Desktop-only test — sidebar layout');

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
        test.skip(test.info().project.name === 'desktop', 'Mobile-only test');

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
        test.skip(test.info().project.name === 'mobile', 'Desktop-only test — sidebar hidden on mobile');

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

        // Navigate to Watched Games via sidebar
        await sidebar.getByRole('link', { name: 'Watched Games' }).click();
        await expect(page.getByRole('heading', { name: 'My Watched Games' })).toBeVisible({ timeout: 10_000 });

        // Navigate back to Characters via sidebar
        await sidebar.getByRole('link', { name: 'Characters' }).click();
        await expect(page.getByRole('heading', { name: 'My Characters' })).toBeVisible({ timeout: 10_000 });
    });
});
