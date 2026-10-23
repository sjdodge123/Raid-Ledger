/**
 * ROK-1854 L5 — the Valheim hub Planner tab: the requirement tree, the plan
 * netted against chests, the shopping list and the personal-chests switch.
 *
 * Seed + locators: `./valheim-planner-fixture` (the recipes fixture: a Bronze
 * chain and one public chest holding 40 Copper and no Tin). ROK-1899 replaced
 * the target combobox with the crafting window, so targets are picked from
 * the recipe list (search → row) and added from the detail pane / sheet; the
 * tree is a list labelled "What <name>  needs" (the selection's "Full
 * breakdown") or "What your list needs" (the plan, in the idle column). The
 * shopping list keeps its targets in localStorage per server.
 */
import type { Page } from "@playwright/test";
import { test, expect } from "./base";
import { apiGet, getAdminToken } from "./api-helpers";
import { isDesktop } from "./helpers";
import {
  type RecipesFixture,
  addSelected,
  addToList,
  openBreakdown,
  openPlanner,
  pageAs,
  pickRow,
  planned,
  recipesPath,
  seedRecipes,
  showPlanPane,
} from "./valheim-planner-fixture";

/** Prefabs that appear exactly once in the Bronze tree. Coal does not:
 * it fuels both smelts (and each Coal fuel row has its kiln child). */
const UNIQUE = ["Copper", "Tin", "CopperOre", "TinOre"];

interface PlanLeaf {
  prefab: string;
  need: number;
  have: number;
  short: number;
}

/** The plan's shopping list for `targets`, read as the admin. */
async function planLeaves(f: RecipesFixture, targets: string) {
  const token = await getAdminToken();
  const plan = (await apiGet(
    token,
    recipesPath(f, `/plan?targets=${targets}`),
  )) as { shoppingList?: PlanLeaf[] } | null;
  return plan?.shoppingList ?? [];
}

const leafNeed = (leaves: PlanLeaf[], prefab: string) =>
  leaves.find((l) => l.prefab === prefab)?.need ?? 0;

const tree = (page: Page, name: string) =>
  page.getByRole("list", { name: `What ${name} needs` });

/** Rows by their OWN `data-prefab` — a `has:` filter would also match every
 * ancestor row whose subtree contains a matching name. */
const row = (page: Page, list: string, prefab: string) =>
  tree(page, list).locator(
    `[data-testid="valheim-planner-row"][data-prefab="${prefab}"]`,
  );

const gatherRow = (page: Page, name: string) =>
  page
    .getByRole("table", { name: "What to gather" })
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name, exact: true }) });

test.describe("Valheim hub — Planner tab (ROK-1854)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("member: Bronze tree, plan netted against chests, list sums and survives reload", async ({
    page,
    browser,
  }, testInfo) => {
    const f = await seedRecipes(testInfo);
    const wide = isDesktop(testInfo);
    const member = await pageAs(browser, page, f.memberUserId);
    try {
      const p = member.page;
      await openPlanner(p, f);

      // Searching "Bronze" and picking its row shows its full craft tree in
      // the "Full breakdown" (no stock netting yet).
      await pickRow(p, "Bronze", "Bronze");
      await openBreakdown(p, wide);
      for (const prefab of UNIQUE)
        await expect(row(p, "Bronze", prefab)).toHaveCount(1);
      await expect(row(p, "Bronze", "Coal").first()).toBeVisible();

      // On the list, the plan nets against chests: the 40 Copper in the
      // chests cover the 2 needed (have = the stock available).
      await addSelected(p, wide);
      await expect(planned(p)).toHaveCount(1);
      await showPlanPane(p, wide);
      await expect(row(p, "your list", "Copper")).toContainText("Have 40");
      await expect(row(p, "your list", "Tin")).toContainText("Short 1");

      // A second target: the shopping list sums both targets' leaves.
      await addToList(p, wide, "Bronze sword", "SwordBronze");
      await expect(planned(p)).toHaveCount(2);
      const [bronze, sword, both] = await Promise.all([
        planLeaves(f, "Bronze:1:1"),
        planLeaves(f, "SwordBronze:1:1"),
        planLeaves(f, "Bronze:1:1,SwordBronze:1:1"),
      ]);
      const tinOre = leafNeed(both, "TinOre");
      expect(tinOre, "combined Tin ore need = the sum of each target").toBe(
        leafNeed(bronze, "TinOre") + leafNeed(sword, "TinOre"),
      );
      expect(tinOre).toBeGreaterThan(leafNeed(bronze, "TinOre"));
      await expect(gatherRow(p, "Tin ore")).toContainText(String(tinOre));
      await expect(gatherRow(p, "Leather scraps")).toContainText("3");

      // The list is kept per browser: a reload restores both targets.
      await p.reload();
      await expect(planned(p)).toHaveCount(2);
      await expect(planned(p).filter({ hasText: "Bronze sword" })).toHaveCount(
        1,
      );
      await expect(gatherRow(p, "Tin ore")).toContainText(String(tinOre));
    } finally {
      await member.context.close();
    }
  });

  test("owner sees the personal-chests switch; a member does not", async ({
    page,
    browser,
  }, testInfo) => {
    const f = await seedRecipes(testInfo);
    const wide = isDesktop(testInfo);
    for (const [userId, count] of [
      [f.ownerUserId, 1],
      [f.memberUserId, 0],
    ] as const) {
      const viewer = await pageAs(browser, page, userId);
      try {
        await openPlanner(viewer.page, f);
        await viewer.page
          .getByRole("button", { name: /^Filters/ })
          .first()
          .click();
        const personal = viewer.page.getByRole("switch", {
          name: "Include my personal chests",
        });
        const vehicles = viewer.page.getByRole("switch", {
          name: "Include carts and ships",
        });
        await expect(vehicles).toBeVisible();
        await expect(personal).toHaveCount(count);
        if (!wide) await viewer.page.keyboard.press("Escape");
      } finally {
        await viewer.context.close();
      }
    }
  });
});
