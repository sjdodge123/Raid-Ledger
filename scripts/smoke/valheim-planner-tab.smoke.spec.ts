/**
 * ROK-1854 L5 — the Valheim hub Planner tab.
 *
 * Seed: `POST /admin/test/valheim/recipes-fixture { worker }` (DEMO_MODE)
 * runs the ROK-1853 containers seed for THIS worker (Pelican row + hub, owner
 * and member viewers), then imports through the real importers the golden
 * `recipes-vanilla` set extended with a Bronze chain (Bronze ← Copper 2 + Tin
 * 1; Copper/Tin smelted from ore with Coal fuel; Coal from a kiln), the
 * catalogue names, and one more public chest holding 40 Copper and no Tin.
 *
 * The picker is a Combobox; the tree is a list labelled "What <name> needs"
 * (a picked target) or "What your list needs" (the plan); the shopping list
 * keeps its targets in localStorage per server. No pixel or timing assumptions.
 */
import type { Browser, Page, TestInfo } from "@playwright/test";
import { test, expect } from "./base";
import { API_BASE, apiGet, apiPost, getAdminToken } from "./api-helpers";
import { signInContextAs } from "./browser-session";
import { isDesktop } from "./helpers";

const FIXTURE = "/admin/test/valheim/recipes-fixture";
const SLOTS = 16;
const CHAIN = ["Copper", "Tin", "Copper ore", "Tin ore", "Coal"];

interface RecipesFixture {
  serverId: number;
  hubId: number;
  guildId: number;
  guildPageUrl: string;
  memberUserId: number;
  ownerUserId: number;
}

interface PlanLeaf {
  prefab: string;
  need: number;
  have: number;
  short: number;
}

/** Install-or-activate through the admin plugin API (valheim-map-tab pattern). */
async function ensurePluginActive(token: string, pluginId: string) {
  const init = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  };
  const base = `${API_BASE}/admin/plugins/${pluginId}`;
  const install = await fetch(`${base}/install`, init);
  if (install.ok) return;
  const activate = await fetch(`${base}/activate`, init);
  if (!activate.ok)
    throw new Error(
      `failed to enable ${pluginId}: install ${install.status}, activate ${activate.status}`,
    );
}

const recipesPath = (f: RecipesFixture, rest = "") =>
  `/plugins/valheim/armory/servers/${f.serverId}/recipes${rest}`;

async function seedRecipes(testInfo: TestInfo): Promise<RecipesFixture> {
  const token = await getAdminToken();
  await ensurePluginActive(token, "pelican");
  await ensurePluginActive(token, "valheim");
  const body = (await apiPost(token, FIXTURE, {
    worker: testInfo.parallelIndex % SLOTS,
  })) as Partial<RecipesFixture> | null;
  expect(
    body?.guildId,
    `recipes fixture seed failed: ${JSON.stringify(body)}`,
  ).toEqual(expect.any(Number));
  const f = body as RecipesFixture;
  // The seed commits before it answers; poll anyway so a lagging read can
  // never hand the page an empty catalogue.
  await expect
    .poll(
      async () => {
        const c = (await apiGet(token, recipesPath(f))) as {
          entries?: { name: string }[];
        } | null;
        return (c?.entries ?? []).some((e) => e.name === "Bronze");
      },
      { message: "the catalogue never listed Bronze", timeout: 15_000 },
    )
    .toBe(true);
  return f;
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

/** A fresh, signed-in context for `userId` at this project's viewport. */
async function pageAs(browser: Browser, page: Page, userId: number) {
  const viewport = page.viewportSize();
  const context = await browser.newContext({
    ...(viewport ? { viewport } : {}),
    storageState: { cookies: [], origins: [] },
  });
  await signInContextAs(context, userId);
  return { context, page: await context.newPage() };
}

async function openPlanner(page: Page, f: RecipesFixture) {
  await page.goto(f.guildPageUrl);
  await expect(picker(page)).toBeVisible({ timeout: 15_000 });
}

const picker = (page: Page) =>
  page.getByRole("combobox", { name: "Search an item or piece" });

const tree = (page: Page, name: string) =>
  page.getByRole("list", { name: `What ${name} needs` });

const row = (page: Page, list: string, name: string) =>
  tree(page, list)
    .getByTestId("valheim-planner-row")
    .filter({
      has: page.getByTestId("valheim-planner-row-name").getByText(name, {
        exact: true,
      }),
    });

async function pick(page: Page, query: string, option: string) {
  await picker(page).fill(query);
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function addToList(page: Page, query: string, option: string) {
  await pick(page, query, option);
  await page.getByRole("button", { name: "Add to list" }).click();
}

const planned = (page: Page) =>
  page.getByRole("list", { name: "Planned items" }).getByRole("listitem");

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
    const member = await pageAs(browser, page, f.memberUserId);
    try {
      const p = member.page;
      await openPlanner(p, f);

      // Searching "Bronze" opens its full craft tree (no stock netting yet).
      await pick(p, "Bronze", "Bronze");
      for (const name of CHAIN)
        await expect(row(p, "Bronze", name)).toHaveCount(1);

      // On the list, the plan nets against chests: Copper is covered by 40.
      await p.getByRole("button", { name: "Add to list" }).click();
      await expect(planned(p)).toHaveCount(1);
      await expect(row(p, "your list", "Copper")).toContainText("Have 40");
      await expect(row(p, "your list", "Tin")).toContainText("Short 1");

      // A second target: the shopping list sums both targets' leaves.
      await addToList(p, "Bronze sword", "Bronze sword");
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
