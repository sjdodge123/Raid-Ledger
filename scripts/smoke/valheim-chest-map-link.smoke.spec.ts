/**
 * ROK-1889 — a Materials chest row's "Map" link opens the hub Map tab on that
 * chest: `#map?x=…&z=…&focus=chest:<prefab>@<x>,<z>&item=<prefab>`, resolved
 * server-side through the Materials visibility rules (a hidden chest reads as
 * missing). Seeds through the ROK-1853 containers fixture; Back returns to the
 * Materials tab. The fixture uploads no character map, so this asserts the
 * focus line above the map; the on-map marker + centring are vitest-covered
 * (`chest-focus.test.ts`, `map-viewport.centre.test.ts`).
 */
import type { Page, TestInfo } from "@playwright/test";
import { test, expect } from "./base";
import { API_BASE, apiGet, apiPost, getAdminToken } from "./api-helpers";
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

/** Select the Wood totals row (the name cell ≥1024px, the whole row below). */
async function drillIntoWood(page: Page, wide: boolean) {
  const caption = "Shared chest totals";
  const shared = page.getByRole(wide ? "table" : "list", { name: caption });
  await expect(shared).toBeVisible({ timeout: 15_000 });
  const rows = wide ? shared.locator("tbody tr") : shared.getByRole("listitem");
  await rows.filter({ hasText: "Wood" }).getByRole("button").first().click();
  await expect(page.getByTestId("valheim-chests-holding")).toBeVisible();
}

test.describe("Valheim hub — chest → Map link (ROK-1889)", () => {
  test("a chest row's Map link opens the Map tab focused on that chest; Back returns", async ({
    page,
  }, testInfo: TestInfo) => {
    const f = await seedContainers(testInfo);
    const wide = isDesktop(testInfo);
    await page.goto(f.guildPageUrl);
    await drillIntoWood(page, wide);

    const link = page.getByTestId("valheim-chest-map-link").first();
    const box = await link.boundingBox();
    expect(
      box?.height ?? 0,
      "the Map link is a 44px tap target",
    ).toBeGreaterThanOrEqual(44);
    await link.click();

    await expect(page).toHaveURL(/#map\?.*focus=chest%3A[A-Za-z0-9_]+%40/);
    expect(page.url()).toContain("item=Wood");
    // The link names the chest's height so a stacked chest resolves to itself.
    expect(page.url()).toMatch(/[?&]y=-?\d+\.\d(&|$)/);
    const focus = page.getByTestId("valheim-chest-focus");
    await expect(focus).toContainText(/\d+\/\d+ slots · Wood ×\d+/);

    await page.goBack();
    // The open item rides in the hash, so Back restores the drilled-in view.
    await expect(page).toHaveURL(/#materials\?item=Wood$/);
    await expect(page.getByTestId("valheim-chests-holding")).toBeVisible();
  });

  test("a focus link to a chest that is not there reads as missing", async ({
    page,
  }, testInfo: TestInfo) => {
    const f = await seedContainers(testInfo);
    const base = f.guildPageUrl.split("#")[0] ?? f.guildPageUrl;
    await page.goto(
      `${base}#map?x=9999.0&z=9999.0&focus=chest%3Apiece_chest%409999.0%2C9999.0`,
    );
    await expect(page.getByTestId("valheim-chest-focus")).toContainText(
      "That chest is not on the map",
    );
    await expect(page.getByTestId("valheim-chest-marker")).toHaveCount(0);
  });
});
