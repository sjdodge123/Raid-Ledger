/**
 * ROK-1659 — the /games filter set lives behind ONE Filters entry.
 *
 *   ≥1024px (desktop project)   the toolbar funnel `filter-panel-trigger`
 *                               opens the inline `filter-panel` under it.
 *   <1024px (mobile + tablet)   the Filters FAB `filter-fab` opens the same
 *                               controls in the BottomSheet (`dialog` "Filters").
 *
 * Only one opener renders per viewport, and both are named "Filters". The
 * controls exist in exactly one copy either way, but neither closed surface is
 * a usable place to read them: the collapsed inline panel is `inert` +
 * `aria-hidden` (so role queries do not see into it), and the closed sheet is
 * translated off-screen behind `pointer-events-none`. Every helper here
 * therefore works on the OPEN surface — `openGamesFilters` returns it.
 *
 * The controls (`web/src/pages/games/games-filter-fields.tsx`):
 *   LFG      `switch` "Players are looking" (`aria-checked`) — never disabled
 *   Players  segmented `radio` group Any / 2 / 3 / 4 / 5+ (sr-only native radios)
 *   Owners   `checkbox` "Owned by N+ members"
 *   Co-op    `coop-filter-group`, rendered only while Co-Optimus data exists
 */
import { expect, type Locator, type Page } from '@playwright/test';

/** `DESKTOP_MQ` (`web/src/lib/breakpoints.ts`) — mirrored, not imported. */
const DESKTOP_MIN_WIDTH = 1024;

/** True where the toolbar funnel + inline panel render (1024px and up). */
export function hasFilterFunnel(page: Page): boolean {
    return (page.viewportSize()?.width ?? 0) >= DESKTOP_MIN_WIDTH;
}

/** The one Filters opener this viewport renders. */
export function filtersOpener(page: Page): Locator {
    return hasFilterFunnel(page)
        ? page.getByTestId('filter-panel-trigger')
        : page.getByTestId('filter-fab');
}

/** The filter surface: the inline panel at 1024px and up, the sheet below. */
export function filtersSurface(page: Page): Locator {
    return hasFilterFunnel(page)
        ? page.getByTestId('filter-panel')
        : page.getByRole('dialog', { name: 'Filters' });
}

/** Open the Filters entry from closed and return the open surface. */
export async function openGamesFilters(page: Page): Promise<Locator> {
    const opener = filtersOpener(page);
    const width = page.viewportSize()?.width ?? 0;
    await expect(
        opener,
        `the ${hasFilterFunnel(page) ? 'toolbar funnel' : 'Filters FAB'} is the /games filter opener at ${width}px`,
    ).toBeVisible({ timeout: 20_000 });
    await expect(opener).toHaveAccessibleName('Filters');
    await expect(opener).toHaveAttribute('aria-expanded', 'false');
    await opener.click();
    await expect(opener).toHaveAttribute('aria-expanded', 'true');
    const surface = filtersSurface(page);
    await expect(surface).toBeVisible({ timeout: 10_000 });
    return surface;
}

/**
 * Close the open surface (Escape: the BottomSheet's own handler below 1024px,
 * `FilterPanel`'s desktop handler above) so the grid under it is clickable.
 */
export async function closeGamesFilters(page: Page): Promise<void> {
    await page.keyboard.press('Escape');
    await expect(filtersOpener(page)).toHaveAttribute('aria-expanded', 'false');
}

/** The `lfg=1` switch. */
export function lfgSwitch(surface: Locator): Locator {
    return surface.getByRole('switch', { name: 'Players are looking' });
}

/** A player-count segment by its visible label: `Any`, `2`, `3`, `4`, `5+`. */
export function playersRadio(surface: Locator, label: string): Locator {
    return surface.getByRole('radio', { name: label, exact: true });
}

/**
 * Pick a player-count segment. The native radio is `sr-only`, so the click
 * goes to its `<label>` — the segment the user actually taps.
 */
export async function pickPlayers(surface: Locator, label: string): Promise<void> {
    await playersRadio(surface, label).locator('xpath=..').click();
}

/** The "Owned by N+ members" checkbox. */
export function ownersCheckbox(surface: Locator): Locator {
    return surface.getByRole('checkbox', { name: /^Owned by \d+\+ members$/ });
}
