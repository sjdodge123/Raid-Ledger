/**
 * ROK-1854 / ROK-1899 — shared seed + locators for the Valheim hub Planner
 * smoke specs (`valheim-planner-tab`, `valheim-planner-window`).
 *
 * Seed: `POST /admin/test/valheim/recipes-fixture { worker }` (DEMO_MODE)
 * runs the ROK-1853 containers seed for THIS worker (Pelican row + hub, owner
 * and member viewers), then imports through the real importers the golden
 * `recipes-vanilla` set extended with a Bronze chain (Bronze ← Copper 2 + Tin
 * 1 at the Forge; SwordBronze ← Bronze 8 + Wood 2 + Leather scraps 3, upgrades
 * to q4; Club ← Wood 6 at the Workbench, upgrades to q3), the catalogue names,
 * and one more public chest holding 40 Copper and no Tin. The public chests
 * hold plenty of Wood, so Club is the affordable row and the Bronze rows are
 * short.
 *
 * The Planner tab (ROK-1899) is a crafting window: a station switcher, a
 * CRAFT | UPGRADE switch, a search box narrowing the recipe list, and a detail
 * pane (≥1024px) or BottomSheet (phones) for the selected row. Rows are found
 * by their OWN `data-prefab`: their accessible name gains a station suffix
 * while searching. No pixel or timing assumptions.
 */
import type { Browser, Locator, Page, TestInfo } from "@playwright/test";
import { expect } from "./base";
import { API_BASE, apiGet, apiPost, getAdminToken } from "./api-helpers";
import { signInContextAs } from "./browser-session";

const FIXTURE = "/admin/test/valheim/recipes-fixture";
const SLOTS = 16;

export interface RecipesFixture {
  serverId: number;
  hubId: number;
  guildId: number;
  guildPageUrl: string;
  memberUserId: number;
  ownerUserId: number;
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

export const recipesPath = (f: RecipesFixture, rest = "") =>
  `/plugins/valheim/armory/servers/${f.serverId}/recipes${rest}`;

/** Seed this worker's recipes fixture and wait until its catalogue lists Bronze. */
export async function seedRecipes(testInfo: TestInfo): Promise<RecipesFixture> {
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

/** A fresh, signed-in context for `userId` at this project's viewport. */
export async function pageAs(browser: Browser, page: Page, userId: number) {
  const viewport = page.viewportSize();
  const context = await browser.newContext({
    ...(viewport ? { viewport } : {}),
    storageState: { cookies: [], origins: [] },
  });
  await signInContextAs(context, userId);
  return { context, page: await context.newPage() };
}

export const craftWindow = (page: Page) =>
  page.getByRole("region", { name: "Crafting window" });

export const searchBox = (page: Page) =>
  page.getByRole("searchbox", { name: "Search an item or piece" });

export const stationSwitcher = (page: Page) =>
  page.getByRole("radiogroup", { name: "Crafting station" });

export async function openPlanner(page: Page, f: RecipesFixture) {
  // `/hubs/:id` is canonical (ROK-1891); the seed's guildPageUrl still uses the legacy redirect.
  await page.goto(`/hubs/${f.hubId}#planner`);
  await expect(craftWindow(page)).toBeVisible({ timeout: 15_000 });
  await expect(searchBox(page)).toBeVisible();
}

/** Every recipe-list row, or the one for `prefab`. */
export const craftRows = (scope: Page | Locator, prefab?: string) =>
  scope.locator(
    prefab === undefined
      ? '[data-testid="valheim-craft-row"]'
      : `[data-testid="valheim-craft-row"][data-prefab="${prefab}"]`,
  );

/** The listed rows' prefabs, in display order. */
export const rowPrefabs = (list: Locator) =>
  craftRows(list).evaluateAll((els) =>
    els.map((e) => e.getAttribute("data-prefab") ?? ""),
  );

/**
 * Choose a segmented radio (station or mode) and confirm it took. The native
 * radio is `sr-only` and its label's content sits on top of it, so the click
 * goes to the enclosing `<label>` — the segment the user actually taps (the
 * same pattern as `games-filters.ts::pickPlayers`).
 */
export async function chooseRadio(group: Locator, name: string | RegExp) {
  const radio = group.getByRole("radio", { name });
  await radio.locator("xpath=ancestor::label[1]").click();
  await expect(radio).toBeChecked();
}

export async function chooseMode(page: Page, mode: "CRAFT" | "UPGRADE") {
  await chooseRadio(craftWindow(page), mode === "CRAFT" ? /^CRAFT/ : /UPGRADE/);
}

/** Search, then select the row for `prefab` (on phones this opens the sheet). */
export async function pickRow(page: Page, query: string, prefab: string) {
  await searchBox(page).fill(query);
  const row = craftRows(craftWindow(page), prefab);
  await row.click();
  await expect(row).toHaveAttribute("aria-pressed", "true");
  // Picking never writes into the search box (spec §3.1.4).
  await expect(searchBox(page)).toHaveValue(query);
}

/** Where the selection's detail lives: the pane (≥1024px) or the sheet. */
export const detailScope = (page: Page, wide: boolean) =>
  wide
    ? page.getByRole("region", { name: "Recipe detail" })
    : page.getByRole("dialog");

/** Press the detail's "Add to list"; on phones a successful add closes the sheet. */
export async function addSelected(page: Page, wide: boolean) {
  await detailScope(page, wide)
    .getByRole("button", { name: "Add to list" })
    .click();
  if (!wide) await expect(page.getByRole("dialog")).toHaveCount(0);
}

export async function addToList(
  page: Page,
  wide: boolean,
  query: string,
  prefab: string,
) {
  await pickRow(page, query, prefab);
  await addSelected(page, wide);
}

/** Open the selection's "Full breakdown" (open on desktop, collapsed in the sheet). */
export async function openBreakdown(page: Page, wide: boolean) {
  const details = detailScope(page, wide)
    .locator("details")
    .filter({ hasText: "Full breakdown" });
  const open = await details.evaluate((d) => (d as HTMLDetailsElement).open);
  if (!open) await details.getByText("Full breakdown").click();
  await expect(details).toHaveAttribute("open", "");
}

/**
 * Show the idle column (the plan's "What your list needs" tree). Phones always
 * show it under the list; on desktop a selection replaces it, and the pane's
 * "Back to your list" clears the selection. Call it with a row selected.
 */
export async function showPlanPane(page: Page, wide: boolean) {
  if (!wide) return;
  const pane = page.getByRole("region", { name: "Recipe detail" });
  await pane.getByRole("button", { name: "Back to your list" }).click();
  await expect(pane).toHaveCount(0);
}

export const planned = (page: Page) =>
  page.getByRole("list", { name: "Planned items" }).getByRole("listitem");
