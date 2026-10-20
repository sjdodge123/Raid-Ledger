/**
 * ROK-1853 L5 — the Valheim hub Materials tab.
 *
 * Seed: `POST /admin/test/valheim/armory/seed-containers { worker }` (DEMO_MODE)
 * upserts THIS worker's Valheim Pelican row + hub, imports the golden
 * `containers-basic` + `containers-private` fixtures through the real importer
 * (6 shared chests incl. a cart and an unreadable one, 1 private chest), and
 * claims the private chest's builder for a seeded owner. Wood = 50 + 7 in
 * chests + 99 on the cart → 156 with carts, 57 without.
 *
 * Totals render as a table ≥1024px and a list below it (both captioned
 * "Shared chest totals"); filters sit in an inline panel ≥1024px and the
 * Filters FAB + BottomSheet below. No pixel or timing assumptions.
 */
import type { Locator, Page, TestInfo } from "@playwright/test";
import { test, expect } from "./base";
import { API_BASE, apiGet, apiPost, getAdminToken } from "./api-helpers";
import { signInContextAs } from "./browser-session";
import { isDesktop } from "./helpers";

const FIXTURE = "/admin/test/valheim/armory/seed-containers";
const WORLD_UID = "1234567890123";
const SLOTS = 16;

interface ContainersFixture {
  serverId: number;
  hubId: number;
  guildPageUrl: string;
  memberUserId: number;
  ownerUserId: number;
  adminUserId: number;
  privateChestKey: string;
  sharedChestKey: string;
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
  const install = await fetch(
    `${API_BASE}/admin/plugins/${pluginId}/install`,
    init,
  );
  if (install.ok) return;
  const activate = await fetch(
    `${API_BASE}/admin/plugins/${pluginId}/activate`,
    init,
  );
  if (!activate.ok)
    throw new Error(
      `failed to enable ${pluginId}: install ${install.status}, activate ${activate.status}`,
    );
}

async function seedContainers(testInfo: TestInfo): Promise<ContainersFixture> {
  const token = await getAdminToken();
  await ensurePluginActive(token, "pelican");
  await ensurePluginActive(token, "valheim");
  const body = (await apiPost(token, FIXTURE, {
    worker: testInfo.parallelIndex % SLOTS,
  })) as Partial<ContainersFixture> | null;
  expect(
    body?.hubId,
    `containers fixture seed failed: ${JSON.stringify(body)}`,
  ).toEqual(expect.any(Number));
  const f = body as ContainersFixture;
  // The seed commits before it answers; poll anyway so a lagging read replica
  // or cache can never hand the page an empty scan.
  await expect
    .poll(
      async () => {
        const m = (await apiGet(
          token,
          `/plugins/valheim/armory/servers/${f.serverId}/materials`,
        )) as { worldUid?: string | null } | null;
        return m?.worldUid ?? null;
      },
      { message: "materials never reported the seeded world", timeout: 15_000 },
    )
    .toBe(WORLD_UID);
  return f;
}

function totals(page: Page, wide: boolean, caption = "Shared chest totals") {
  return page.getByRole(wide ? "table" : "list", { name: caption });
}

function totalRows(scope: Locator, wide: boolean): Locator {
  return wide ? scope.locator("tbody tr") : scope.getByRole("listitem");
}

async function openMaterials(page: Page, f: ContainersFixture, wide: boolean) {
  await page.goto(f.guildPageUrl);
  await expect(totals(page, wide)).toBeVisible({ timeout: 15_000 });
}

/** Flip "Include carts and ships" (inline panel ≥1024px, BottomSheet below). */
async function toggleVehicles(page: Page, wide: boolean) {
  await page
    .getByRole("button", { name: /^Filters/ })
    .first()
    .click();
  const toggle = page.getByRole("switch", { name: "Include carts and ships" });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  if (wide) return;
  await page.keyboard.press("Escape");
  await expect(toggle).toBeHidden();
}

const personalHeading = (page: Page) =>
  page.getByRole("heading", { name: "Personal chests" });

test.describe("Valheim hub — Materials tab (ROK-1853)", () => {
  test("admin: totals, search, vehicles switch, chest drill-down, omitted private", async ({
    page,
  }, testInfo) => {
    const f = await seedContainers(testInfo);
    const wide = isDesktop(testInfo);
    await openMaterials(page, f, wide);
    const shared = totals(page, wide);

    // Totals rows carry catalogue names (Wood is catalogued).
    const wood = totalRows(shared, wide).filter({ hasText: "Wood" });
    await expect(wood).toHaveCount(1);
    await expect(wood).toContainText("156");
    expect(await totalRows(shared, wide).count()).toBeGreaterThan(3);

    // Search narrows to the one matching row, then clears.
    const search = page.getByLabel("Search materials");
    await search.fill("Stone");
    await expect(totalRows(shared, wide)).toHaveCount(1);
    await expect(totalRows(shared, wide)).toContainText("20");
    await search.fill("");
    await expect(wood).toHaveCount(1);

    // The cart's 99 Wood drops out with vehicles off.
    await toggleVehicles(page, wide);
    await expect(wood).toContainText("57");
    await expect(wood).not.toContainText("156");

    // Chest list shows coordinates; a chest opens its stacks.
    const chests = page.getByRole("list", { name: "Chests" });
    const chest = chests.getByRole("button").filter({ hasText: "x −12, z 48" });
    await expect(chest).toHaveCount(1);
    await chest.click();
    const contents = page.getByRole("list", { name: "Chest contents" });
    await expect(contents).toBeVisible();
    await expect(contents.getByRole("listitem")).toHaveCount(2);
    await page.keyboard.press("Escape");
    await expect(contents).toBeHidden();

    // Admins see every private chest plus the mod's omitted count.
    await expect(personalHeading(page)).toBeVisible();
    await expect(page.getByText(/1 personal chest not scanned/)).toBeVisible();
  });
});

test.describe("Valheim hub — Materials personal section per viewer (ROK-1853)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("owner sees their 1 private chest; a member sees no personal section", async ({
    page,
  }, testInfo) => {
    const f = await seedContainers(testInfo);
    const wide = isDesktop(testInfo);

    await signInContextAs(page.context(), f.ownerUserId);
    await openMaterials(page, f, wide);
    await expect(personalHeading(page)).toBeVisible();
    const personal = totals(page, wide, "Personal chest totals");
    await expect(totalRows(personal, wide)).toHaveCount(1);
    await expect(totalRows(personal, wide)).toContainText("999");
    await expect(page.getByText(/^1 chest$/)).toBeVisible();
    // The admin-only omittedPrivate line; the shared warnings block may say "was not scanned".
    await expect(page.getByText(/personal chests? not scanned/)).toHaveCount(0);

    await page.context().clearCookies();
    await signInContextAs(page.context(), f.memberUserId);
    await openMaterials(page, f, wide);
    await expect(totalRows(totals(page, wide), wide).first()).toBeVisible();
    await expect(personalHeading(page)).toHaveCount(0);
  });
});
