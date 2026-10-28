/**
 * ROK-1860 — the Valheim hub Planner source picker (desktop + mobile).
 *
 * Seed + locators: `./valheim-planner-fixture`. The recipes fixture gives
 * Bronze two forge recipes: `Recipe_Bronze` (Copper 2 + Tin 1, Forge lvl 1,
 * the default "Best guess") and `Recipe_Bronze5` (Copper 8 + Tin 3 → 5 Bronze,
 * Forge lvl 2); one public chest holds 40 Copper and no Tin.
 *
 * Covers: on the list's plan the Bronze row's "+1 other ways" is a dialog
 * button; it opens "How to make Bronze" (a Modal ≥1024px, a BottomSheet below
 * — both `role="dialog"`); picking the Forge · lvl 2 way re-plans (Copper 8,
 * Tin 3 → more Tin ore to gather) and focus returns to the chip; the pick is
 * kept per browser and shows selected after a reload; "Use the default"
 * restores the original plan; Esc closes the picker and focus returns to the
 * chip. Waits are web-first assertions — never sleeps.
 */
import type { Page } from "@playwright/test";
import { test, expect } from "./base";
import { apiGet, getAdminToken } from "./api-helpers";
import { isDesktop } from "./helpers";
import {
  type RecipesFixture,
  addToList,
  openPlanner,
  pageAs,
  planned,
  recipesPath,
  seedRecipes,
  showPlanPane,
} from "./valheim-planner-fixture";

const PLAN_TREE = "What your list needs";
const PICKER = "How to make Bronze";
const BRONZE5_SOURCES = "Bronze:r:Recipe_Bronze5";

interface PlanLeaf {
  prefab: string;
  need: number;
}

/** The plan's shopping-list need for `prefab`, read as the admin. */
async function leafNeed(f: RecipesFixture, prefab: string, sources?: string) {
  const query =
    sources === undefined
      ? "targets=Bronze:1:1"
      : `targets=Bronze:1:1&sources=${encodeURIComponent(sources)}`;
  const plan = (await apiGet(
    await getAdminToken(),
    recipesPath(f, `/plan?${query}`),
  )) as { shoppingList?: PlanLeaf[] } | null;
  return plan?.shoppingList?.find((l) => l.prefab === prefab)?.need ?? 0;
}

const planTree = (page: Page) => page.getByRole("list", { name: PLAN_TREE });

/** Rows by their OWN `data-prefab` (a `has:` filter would match ancestors). */
const treeRow = (page: Page, prefab: string) =>
  planTree(page).locator(
    `[data-testid="valheim-planner-row"][data-prefab="${prefab}"]`,
  );

/** The Bronze row's "+N other ways" button (the first, if Bronze recurs). */
const bronzeChip = (page: Page) =>
  planTree(page)
    .getByRole("button", { name: /^Choose how to make Bronze \(/ })
    .first();

const tinOreGather = (page: Page) =>
  page
    .getByRole("table", { name: "What to gather" })
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: "Tin ore", exact: true }) });

async function openPicker(page: Page) {
  await bronzeChip(page).click();
  const dialog = page.getByRole("dialog", { name: PICKER });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("valheim-source-picker")).toBeVisible();
  return dialog;
}

/** Pick a way; the picker closes on the pick and focus returns to the chip (AC9). */
async function pickWay(page: Page, name: RegExp) {
  const dialog = await openPicker(page);
  await dialog.getByRole("radio", { name }).click();
  await expect(page.getByRole("dialog", { name: PICKER })).toHaveCount(0);
  await expect(bronzeChip(page)).toBeFocused();
}

test.describe("Valheim hub — Planner source picker (ROK-1860)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("member: pick Bronze's 5-bar recipe, it re-plans, survives reload, Use the default restores", async ({
    page,
    browser,
  }, testInfo) => {
    const f = await seedRecipes(testInfo);
    const wide = isDesktop(testInfo);
    const [tinOreDefault, tinOrePicked] = await Promise.all([
      leafNeed(f, "TinOre"),
      leafNeed(f, "TinOre", BRONZE5_SOURCES),
    ]);
    expect(
      tinOrePicked,
      "Recipe_Bronze5 (Tin 3) must need more Tin ore than Recipe_Bronze (Tin 1)",
    ).toBeGreaterThan(tinOreDefault);
    const member = await pageAs(browser, page, f.memberUserId);
    try {
      const p = member.page;
      await openPlanner(p, f);
      await addToList(p, wide, "Bronze", "Bronze");
      await expect(planned(p)).toHaveCount(1);
      await showPlanPane(p, wide);

      // Default plan: Copper 2 + Tin 1; the chip is a dialog button.
      await expect(treeRow(p, "Copper")).toContainText(/Need 2\b/);
      await expect(treeRow(p, "Tin")).toContainText(/Need 1\b/);
      await expect(bronzeChip(p)).toHaveAttribute("aria-haspopup", "dialog");
      const before = await tinOreGather(p).innerText();

      const dialog = await openPicker(p);
      await expect(
        dialog.getByRole("radio", { name: /Use the default/ }),
      ).toBeChecked();
      await expect(dialog.getByText("Best guess")).toBeVisible();
      await p.keyboard.press("Escape");
      await expect(p.getByRole("dialog", { name: PICKER })).toHaveCount(0);

      await pickWay(p, /Forge · lvl 2/);
      await expect(treeRow(p, "Copper")).toContainText(/Need 8\b/);
      await expect(treeRow(p, "Tin")).toContainText(/Need 3\b/);
      await expect(tinOreGather(p)).not.toHaveText(before);
      await expect(tinOreGather(p)).toContainText(String(tinOrePicked));

      // Kept per browser: a reload restores the pick, shown selected.
      await p.reload();
      await expect(planned(p)).toHaveCount(1);
      await expect(treeRow(p, "Copper")).toContainText(/Need 8\b/);
      const again = await openPicker(p);
      await expect(
        again.getByRole("radio", { name: /Forge · lvl 2/ }),
      ).toBeChecked();
      await p.keyboard.press("Escape");
      await expect(p.getByRole("dialog", { name: PICKER })).toHaveCount(0);

      // "Use the default" restores the original plan.
      await pickWay(p, /Use the default/);
      await expect(treeRow(p, "Copper")).toContainText(/Need 2\b/);
      await expect(treeRow(p, "Tin")).toContainText(/Need 1\b/);
      await expect(tinOreGather(p)).toHaveText(before);
    } finally {
      await member.context.close();
    }
  });

  test("Esc closes the picker and focus returns to the chip", async ({
    page,
    browser,
  }, testInfo) => {
    const f = await seedRecipes(testInfo);
    const wide = isDesktop(testInfo);
    const member = await pageAs(browser, page, f.memberUserId);
    try {
      const p = member.page;
      await openPlanner(p, f);
      await addToList(p, wide, "Bronze", "Bronze");
      await showPlanPane(p, wide);

      await openPicker(p);
      await p.keyboard.press("Escape");
      await expect(p.getByRole("dialog", { name: PICKER })).toHaveCount(0);
      await expect(bronzeChip(p)).toBeFocused();
    } finally {
      await member.context.close();
    }
  });
});
