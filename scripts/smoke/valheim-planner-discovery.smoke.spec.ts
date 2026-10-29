/**
 * ROK-1862 — the Valheim hub Planner's "not yet discovered" filter (desktop +
 * mobile).
 *
 * Seed + locators: `./valheim-planner-fixture`. The recipes fixture gives the
 * owner's claimed character every recipe in the demo set EXCEPT Bronze sword
 * (`SwordBronze`); the member has no claimed character on the server.
 *
 * Covers: the owner sees the neutral "Not discovered yet" chip on the Bronze
 * sword row (and none on Club) with the filter off; turning "Hide
 * undiscovered" on (inline panel ≥1024px, Filters FAB + BottomSheet below)
 * hides Bronze sword from search while Bronze stays; a member's switch is
 * disabled with the claim hint. Waits are web-first assertions (rows render
 * once the catalogue query lands) — never sleeps.
 */
import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./base";
import { isDesktop } from "./helpers";
import {
  craftRows,
  craftWindow,
  openPlanner,
  pageAs,
  searchBox,
  seedRecipes,
} from "./valheim-planner-fixture";

const CHIP = "Not discovered yet";
const SWITCH = "Hide undiscovered";
const NO_CHARACTER_HINT =
  "Claim your character on this server to use this filter.";

/** Search, then return the row for `prefab` (found by its OWN data-prefab). */
async function searchRow(page: Page, query: string, prefab: string) {
  await searchBox(page).fill(query);
  return craftRows(craftWindow(page), prefab);
}

/** Open the Planner funnel and return the "Hide undiscovered" switch. */
async function openFilters(page: Page): Promise<Locator> {
  await page
    .getByRole("button", { name: /^Filters/ })
    .first()
    .click();
  const toggle = page.getByRole("switch", { name: SWITCH });
  await expect(toggle).toBeVisible();
  return toggle;
}

/** Close the phone sheet; the desktop panel is inline and may stay open. */
async function closeFilters(page: Page, wide: boolean, toggle: Locator) {
  if (wide) return;
  await page.keyboard.press("Escape");
  await expect(toggle).toBeHidden();
}

test.describe("Valheim hub — Planner discovery filter (ROK-1862)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("owner: chip on Bronze sword, Hide undiscovered removes it from search", async ({
    page,
    browser,
  }, testInfo) => {
    const f = await seedRecipes(testInfo);
    const wide = isDesktop(testInfo);
    const owner = await pageAs(browser, page, f.ownerUserId);
    try {
      const p = owner.page;
      await openPlanner(p, f);

      const club = await searchRow(p, "Club", "Club");
      await expect(club).toHaveAttribute("data-discovered", "true", {
        timeout: 15_000,
      });
      await expect(club.getByText(CHIP)).toHaveCount(0);

      const sword = await searchRow(p, "Bronze sword", "SwordBronze");
      await expect(sword).toHaveAttribute("data-discovered", "false");
      await expect(sword.getByText(CHIP)).toBeVisible();

      const toggle = await openFilters(p);
      await expect(toggle).toBeEnabled();
      await expect(toggle).toHaveAttribute("aria-checked", "false");
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-checked", "true");
      await closeFilters(p, wide, toggle);

      await searchBox(p).fill("Bronze");
      await expect(craftRows(craftWindow(p), "Bronze")).toBeVisible();
      await expect(craftRows(craftWindow(p), "SwordBronze")).toHaveCount(0);
      await expect(p.getByText(CHIP)).toHaveCount(0);
    } finally {
      await owner.context.close();
    }
  });

  test("member without a claimed character: switch disabled with the hint", async ({
    page,
    browser,
  }, testInfo) => {
    const f = await seedRecipes(testInfo);
    const wide = isDesktop(testInfo);
    const member = await pageAs(browser, page, f.memberUserId);
    try {
      const p = member.page;
      await openPlanner(p, f);

      const sword = await searchRow(p, "Bronze sword", "SwordBronze");
      await expect(sword).toBeVisible({ timeout: 15_000 });
      await expect(sword).not.toHaveAttribute("data-discovered", /.+/);
      await expect(sword.getByText(CHIP)).toHaveCount(0);

      const toggle = await openFilters(p);
      await expect(toggle).toBeDisabled();
      await expect(toggle).toHaveAttribute("aria-checked", "false");
      await expect(toggle).toHaveAccessibleDescription(NO_CHARACTER_HINT);
      await expect(p.getByText(NO_CHARACTER_HINT)).toBeVisible();
      await closeFilters(p, wide, toggle);
    } finally {
      await member.context.close();
    }
  });
});
