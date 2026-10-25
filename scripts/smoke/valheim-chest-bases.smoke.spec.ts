/**
 * ROK-1859 L5 — Valheim base clusters, chest display names and the map's
 * "Chests" layer.
 *
 * Seed: `POST /admin/test/valheim/map-fixture { worker }` (admin's claimed
 * character + a map; hub id = `guildId`), then `POST …/armory/seed-containers
 * { worker, secondBase: true }` on the SAME worker server + world: the golden
 * containers scan plus a second base (two Stone/Resin chests at x 600/610,
 * z −360) and one private chest at (5, 5) that only its owner and admins read.
 *
 * Materials: the "Base" select lists both bases; picking the far one narrows
 * the totals and the chest list, and chest names read "<Chest> N · Base near
 * x…, z…". Map: the 13th "Chests" chip (on by default) draws one pin per chest
 * the viewer may read, named "<display name> (Chest)"; Enter on a pin opens
 * its chest detail (the pin buttons overlap at fit zoom, so no pointer click).
 * Waits are poll-, response- or expect-driven only.
 */
import type { Locator, Page, TestInfo } from "@playwright/test";
import { test, expect } from "./base";
import { API_BASE, apiGet, apiPost, getAdminToken } from "./api-helpers";
import { signInContextAs } from "./browser-session";
import { isDesktop } from "./helpers";
import {
  closeFilters,
  mapApp,
  openFilters,
  responseTo,
} from "./valheim-pin-filter-helpers";

const MAP_FIXTURE = "/admin/test/valheim/map-fixture";
const CONTAINERS_FIXTURE = "/admin/test/valheim/armory/seed-containers";
const SLOTS = 16;
/** The second base's centre (chests at x 600 and 610, z −360). */
const FAR_BASE = /Base near x 605, z [−-]360/;
const CHEST_PINS = /\(Chest\)$/;

interface Fixture {
  serverId: number;
  hubId: number;
  guildPageUrl: string;
  characterId: number;
  memberUserId: number;
  adminUserId: number;
  privateChestKey: string;
}

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

/** Seeds the map character, then the two-base scan on the same server; polls the read. */
async function seedBases(testInfo: TestInfo): Promise<Fixture> {
  const token = await getAdminToken();
  await ensurePluginActive(token, "pelican");
  await ensurePluginActive(token, "valheim");
  const worker = testInfo.parallelIndex % SLOTS;
  const map = (await apiPost(token, MAP_FIXTURE, { worker })) as {
    characterId?: number;
  } | null;
  expect(
    map?.characterId,
    `map fixture seed failed: ${JSON.stringify(map)}`,
  ).toEqual(expect.any(Number));
  const body = (await apiPost(token, CONTAINERS_FIXTURE, {
    worker,
    secondBase: true,
  })) as Partial<Fixture> | null;
  expect(
    body?.hubId,
    `containers fixture seed failed: ${JSON.stringify(body)}`,
  ).toEqual(expect.any(Number));
  const f = { ...(body as Fixture), characterId: map?.characterId ?? -1 };
  await expect
    .poll(
      async () => {
        const m = (await apiGet(
          token,
          `/plugins/valheim/armory/servers/${f.serverId}/materials`,
        )) as { bases?: unknown[] } | null;
        return m?.bases?.length ?? 0;
      },
      { message: "materials never reported two bases", timeout: 15_000 },
    )
    .toBe(2);
  return f;
}

const totals = (page: Page, wide: boolean) =>
  page.getByRole(wide ? "table" : "list", { name: "Shared chest totals" });
const totalRows = (scope: Locator, wide: boolean): Locator =>
  wide ? scope.locator("tbody tr") : scope.getByRole("listitem");

async function openBaseFilter(page: Page): Promise<Locator> {
  await page
    .getByRole("button", { name: /^Filters/ })
    .first()
    .click();
  const select = page.getByLabel("Base", { exact: true });
  await expect(select).toBeVisible();
  return select;
}

test.describe("Valheim hub — Materials bases (ROK-1859)", () => {
  test("Base select lists both bases; the far one narrows totals and chests, names carry the base", async ({
    page,
  }, testInfo) => {
    const f = await seedBases(testInfo);
    const wide = isDesktop(testInfo);
    await page.goto(f.guildPageUrl);
    await expect(totals(page, wide)).toBeVisible({ timeout: 15_000 });
    const shared = totals(page, wide);
    const wood = totalRows(shared, wide).filter({ hasText: "Wood" });
    await expect(wood).toHaveCount(1);
    const chests = page.getByRole("list", { name: "Chests" });
    const allChests = await chests.getByRole("button").count();

    const select = await openBaseFilter(page);
    const labels = await select.locator("option").allTextContents();
    expect(
      labels.filter((l) => /^Base near x/.test(l)),
      `Base options: ${labels.join(" | ")}`,
    ).toHaveLength(2);
    const far = labels.find((l) => FAR_BASE.test(l));
    expect(far, `no option for the far base in: ${labels.join(" | ")}`).toBe(
      "Base near x 605, z −360 · 2 chests",
    );
    await select.selectOption({ label: far ?? "" });

    await expect(totalRows(shared, wide)).toHaveCount(2);
    await expect(
      totalRows(shared, wide).filter({ hasText: "Stone" }),
    ).toHaveCount(1);
    await expect(
      totalRows(shared, wide).filter({ hasText: "Resin" }),
    ).toHaveCount(1);
    await expect(wood).toHaveCount(0);
    if (!wide) await closeFilters(page, wide);
    const rows = chests.getByRole("button");
    await expect(rows).toHaveCount(2);
    for (const row of await rows.all())
      await expect(row).toContainText(/ \d+ · Base near x 605, z [−-]360/);
    expect(
      allChests,
      "All bases lists more chests than one base",
    ).toBeGreaterThan(2);
  });
});

test.describe("Valheim hub — Map Chests layer (ROK-1859)", () => {
  async function openMap(page: Page, f: Fixture): Promise<Locator> {
    const read = responseTo(page, `/servers/${f.serverId}/containers`);
    await page.goto(`/hubs/${f.hubId}?vc=${f.characterId}#map`);
    expect((await read).status(), "containers read for the map layer").toBe(
      200,
    );
    const map = mapApp(page);
    await expect(map).toBeVisible({ timeout: 15_000 });
    return map;
  }
  const chestPins = (map: Locator): Locator =>
    map.getByRole("button", { name: CHEST_PINS });

  test("admin: 13th Chests chip, a pin per chest, Enter opens the chest detail", async ({
    page,
  }, testInfo) => {
    const f = await seedBases(testInfo);
    const wide = isDesktop(testInfo);
    const map = await openMap(page, f);

    const panel = await openFilters(page, wide);
    const order = await panel
      .getByTestId("map-pin-filter-types")
      .locator('[data-testid^="map-pin-type-"]')
      .evaluateAll((els) =>
        els.map((e) =>
          (e.getAttribute("data-testid") ?? "").replace("map-pin-type-", ""),
        ),
      );
    expect(order.length, `chips: ${order.join(", ")}`).toBe(13);
    expect(order.indexOf("chest"), `chips: ${order.join(", ")}`).toBe(
      order.indexOf("scanned-portal") + 1,
    );
    await expect(panel.getByTestId("map-pin-type-chest")).toHaveText(/Chests/);
    await closeFilters(page, wide);

    // Every chest the admin may read is a pin, both bases among them.
    await expect
      .poll(() => chestPins(map).count(), { message: "chest pins drawn" })
      .toBeGreaterThan(4);
    const far = map.getByRole("button", {
      name: new RegExp(`${FAR_BASE.source}.*\\(Chest\\)$`),
    });
    await expect(far).toHaveCount(2);

    // Enter on a pin (they overlap at fit zoom) opens that chest's detail.
    const label = (await far.first().getAttribute("aria-label")) ?? "";
    const name = label.replace(CHEST_PINS, "").trim();
    expect(name, "pin name is the chest display name").toMatch(
      /\d+ · Base near x 605/,
    );
    await far.first().focus();
    await page.keyboard.press("Enter");
    const detail = page.getByRole("dialog", { name });
    await expect(detail).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(detail).toBeHidden();
  });
});

test.describe("Valheim hub — Map Chests layer privacy (ROK-1859)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a member gets every shared chest pin but never the private chest", async ({
    page,
    browser,
  }, testInfo) => {
    const f = await seedBases(testInfo);
    const url = `/hubs/${f.hubId}?vc=${f.characterId}#map`;
    const containersPath = `/servers/${f.serverId}/containers`;

    // Admin (a fresh context) reads the private chest too: the baseline count.
    const viewport = page.viewportSize();
    const admin = await browser.newContext({
      ...(viewport ? { viewport } : {}),
      storageState: { cookies: [], origins: [] },
    });
    let adminKeys: string[] = [];
    try {
      const adminPage = await admin.newPage();
      await signInContextAs(admin, f.adminUserId);
      const read = responseTo(adminPage, containersPath);
      await adminPage.goto(url);
      adminKeys = await keysOf(await read);
    } finally {
      await admin.close();
    }
    expect(adminKeys, "the admin's list holds the private chest").toContain(
      f.privateChestKey,
    );

    await signInContextAs(page.context(), f.memberUserId);
    const read = responseTo(page, containersPath);
    await page.goto(url);
    const memberKeys = await keysOf(await read);
    expect(
      memberKeys,
      "the member's list never has the private chest",
    ).not.toContain(f.privateChestKey);
    const map = mapApp(page);
    await expect(map).toBeVisible({ timeout: 15_000 });
    await expect(map.getByRole("button", { name: CHEST_PINS })).toHaveCount(
      memberKeys.length,
    );
    expect(memberKeys.length, "one pin fewer than the admin").toBe(
      adminKeys.length - 1,
    );
  });
});

async function keysOf(res: { json(): Promise<unknown> }): Promise<string[]> {
  const body = (await res.json()) as { containers?: { key: string }[] };
  return (body.containers ?? []).map((c) => c.key);
}
