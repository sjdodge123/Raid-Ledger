/**
 * ROK-2147 — character-page assertions for the guild addons card with the
 * character's installed addons, against the DEMO_MODE seed-guild option
 * `withInstalledAddons: true` (`api/src/admin/demo-test-guild-installed-addons.helpers.ts`).
 *
 * What the seed writes on the `member` role's character: LedgerLink +
 * WeakAuras (+ 7 unrecommended folders) — no Details. Against the
 * `withContent` recommendations (Details — Required, folder `Details`;
 * WeakAuras — optional, folder `WeakAuras`) and the default LedgerLink pin
 * (Required, folder `LedgerLink`) the owner and the guild's officers see:
 * LedgerLink + WeakAuras Installed, Details Missing on a highlighted row, and
 * "Also installed (7)" capped at 5 with "Show all 7". Everyone who cannot open
 * the guild sees no card at all.
 */
import type { Locator, Page } from '@playwright/test';
import { expect } from './base';

/** The folders the seed stores that no recommendation claims, loaded first then by name (title ?? name shown). */
const ALSO_INSTALLED_COLLAPSED = [/^Auctionator/, /^Bagnon/, /^Deadly Boss Mods/, /^OmniCC/, /^Questie/];
const ALSO_INSTALLED_EXPANDED = [...ALSO_INSTALLED_COLLAPSED, /^ClassicCastbars.*not loaded/, /^Leatrix Plus.*not loaded/];

export const SEEDED_INSTALLED_COUNT = 9;

function recommendationRow(card: Locator, name: string): Locator {
    return card.getByRole('list', { name: 'Addons your guild recommends' }).locator(':scope > li').filter({ hasText: name });
}

/** Throws unless seed-guild reported the installed-addons row the assertions below rely on. */
export function assertInstalledSeed(body: { installedAddons?: { characterId?: string; names?: string[] } }): void {
    if (body.installedAddons?.names?.length !== SEEDED_INSTALLED_COUNT) {
        throw new Error(`seed-guild withInstalledAddons: ${JSON.stringify(body.installedAddons)}`);
    }
}

/** Owner / officer view: per-recommendation state, the highlighted missing Required row, the source line. */
async function expectRecommendationStates(card: Locator, requiredAddon: string, optionalAddon: string): Promise<void> {
    for (const name of ['LedgerLink', optionalAddon]) {
        const row = recommendationRow(card, name);
        await expect(row, `${name} is in the seeded export`).toHaveAttribute('data-install-state', 'installed');
        await expect(row).toContainText('Installed');
    }
    const missing = recommendationRow(card, requiredAddon);
    await expect(missing, `${requiredAddon} (folder Details) is not in the seeded export`).toHaveAttribute('data-install-state', 'missing');
    await expect(missing, 'a missing Required row is highlighted').toHaveClass(/border-l-warning/);
    await expect(missing).toContainText('Missing');
    await expect(missing, 'the Required pill stays').toContainText('Required');
    await expect(card.getByTestId('character-installed-source')).toContainText('via addon');
}

/** "Also installed (7)": 5 rows, then all 7 after "Show all 7"; matched folders are not repeated. */
async function expectAlsoInstalled(card: Locator): Promise<void> {
    const also = card.getByTestId('character-also-installed');
    await expect(also.getByRole('heading', { name: 'Also installed (7)' })).toBeVisible();
    const rows = also.getByRole('list', { name: 'Other installed addons' }).locator(':scope > li');
    await expect(rows, 'capped at 5 rows').toHaveText(ALSO_INSTALLED_COLLAPSED);
    await also.getByRole('button', { name: 'Show all 7' }).click();
    await expect(rows, 'Show all lists every unmatched folder, not-loaded last').toHaveText(ALSO_INSTALLED_EXPANDED);
    await expect(also, 'a matched folder is not repeated under Also installed').not.toContainText('WeakAuras');
}

/** The card as the character's owner or a guild officer sees it. */
export async function expectInstalledAddonsCard(page: Page, requiredAddon: string, optionalAddon: string): Promise<void> {
    const card = page.getByTestId('character-guild-addons');
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expectRecommendationStates(card, requiredAddon, optionalAddon);
    await expectAlsoInstalled(card);
}

/**
 * A viewer who cannot open the character's guild: the guild lookup answers
 * `viewerCanOpen: false`, the page renders, and no addons card appears.
 */
export async function expectNoGuildAddonsCard(page: Page, characterId: string): Promise<void> {
    const lookup = page.waitForResponse(
        (r) => new URL(r.url()).pathname.endsWith(`/guilds/by-character/${characterId}`),
        { timeout: 15_000 },
    );
    await page.goto(`/characters/${characterId}`);
    const body = (await (await lookup).json()) as { data?: { viewerCanOpen?: boolean } | null };
    expect(body.data?.viewerCanOpen, 'the outsider cannot open the member\'s guild').toBe(false);
    await expect(page.getByRole('heading', { level: 1 }).first(), 'the character page rendered').toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('character-guild-addons')).toHaveCount(0);
    await expect(page.getByTestId('character-also-installed')).toHaveCount(0);
}
