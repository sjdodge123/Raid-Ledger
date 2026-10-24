/**
 * ROK-1946 — the Valheim Map's scanned-portal layer (spec "Playwright (lane
 * D)"). Portals are server data (ValheimLink scans), drawn by the one
 * `PinLayer` as `"<tag | Unnamed portal> (Scanned portal)"` buttons. The
 * "Scanned portals" chip (right after "Portal", URL `pins=scanned-portal`)
 * and the label search apply to them; "Whose pins" and Hide crossed-out pins
 * never do, and a hub visitor sees them too.
 *
 * Seed: the ROK-1930 deaths fixture (`valheim-pin-filter-helpers.ts` header)
 * plus 5 portals on its world: "home" ×2, "swamp", "" (→ "Unnamed portal")
 * and a stone "ashlands". Waits are poll-, response- or expect-driven only.
 */
import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./base";
import { apiGet, getAdminToken } from "./api-helpers";
import { signInContextAs } from "./browser-session";
import { isDesktop } from "./helpers";
import {
  type Fixture,
  closeFilters,
  mapApp,
  openFilters,
  pins,
  responseTo,
  scannedPortals,
  seedDeathsFixture,
} from "./valheim-pin-filter-helpers";

const PORTAL_COUNT = 5;
const portalsPath = (f: Fixture): string => `/servers/${f.serverId}/portals`;
const portalNamed = (map: Locator, label: string): Locator =>
  map.getByRole("button", { name: `${label} (Scanned portal)`, exact: true });

/** Seeds the fixture and polls the portals read until all 5 are served. */
async function seedWithPortals(worker: number): Promise<Fixture> {
  const f = await seedDeathsFixture(worker);
  expect(f.portals.count, "fixture portal count").toBe(PORTAL_COUNT);
  const token = await getAdminToken();
  await expect
    .poll(
      async () => {
        const body = (await apiGet(
          token,
          `/plugins/valheim/armory${portalsPath(f)}`,
        )) as { portals?: unknown[] } | null;
        return body?.portals?.length ?? -1;
      },
      { message: "portals read after the fixture seed", timeout: 15_000 },
    )
    .toBe(PORTAL_COUNT);
  return f;
}

/** Opens `/hubs/<guild>?<query>#map` and waits for the portals read + the map. */
async function openMap(
  page: Page,
  f: Fixture,
  query: string,
): Promise<Locator> {
  const read = responseTo(page, portalsPath(f));
  await page.goto(`/hubs/${f.guildId}?${query}#map`);
  const res = await read;
  expect(res.status(), `portals read answered ${res.status()}`).toBe(200);
  const map = mapApp(page);
  await expect(map).toBeVisible({ timeout: 15_000 });
  return map;
}

/** The type chips' ids in panel order (`map-pin-type-<id>`). */
async function chipOrder(panel: Locator): Promise<string[]> {
  return panel
    .getByTestId("map-pin-filter-types")
    .locator('[data-testid^="map-pin-type-"]')
    .evaluateAll((els) =>
      els.map((e) =>
        (e.getAttribute("data-testid") ?? "").replace("map-pin-type-", ""),
      ),
    );
}

test.describe("Valheim Map — scanned portals (ROK-1946)", () => {
  test("member: 5 portals beside the hand-placed pins, one Unnamed portal", async ({
    page,
  }, testInfo) => {
    const f = await seedWithPortals(testInfo.parallelIndex);
    const { top } = f.characters;
    await signInContextAs(page.context(), f.users.member.id);
    const map = await openMap(page, f, `vc=${top.id}`);
    await expect(scannedPortals(map)).toHaveCount(PORTAL_COUNT);
    await expect(portalNamed(map, "Unnamed portal")).toHaveCount(1);
    await expect(portalNamed(map, "home")).toHaveCount(2);
    await expect(portalNamed(map, "ashlands")).toHaveCount(1);
    // This character's own pins still render: 2 Death + Camp.
    await expect(pins(map)).toHaveCount(top.deathPinLabels.length + 1);
    await expect(map.getByRole("button", { name: /^Camp \(/ })).toHaveCount(1);
  });

  test("chip: Scanned portals sits after Portal; only it → only portals, kept on reload", async ({
    page,
  }, testInfo) => {
    const f = await seedWithPortals(testInfo.parallelIndex);
    const wide = isDesktop(testInfo);
    await signInContextAs(page.context(), f.users.member.id);
    const map = await openMap(page, f, `vc=${f.characters.top.id}`);
    const panel = await openFilters(page, wide);
    const order = await chipOrder(panel);
    expect(
      order.indexOf("scanned-portal"),
      `chip order ${order.join(", ")}: Scanned portals right after Portal`,
    ).toBe(order.indexOf("portal") + 1);
    const chip = panel.getByTestId("map-pin-type-scanned-portal");
    await expect(chip).toHaveText(/Scanned portals/);
    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveURL(/[?&]pins=scanned-portal(&|#|$)/);
    await expect(pins(map)).toHaveCount(0);
    await expect(scannedPortals(map)).toHaveCount(PORTAL_COUNT);
    await closeFilters(page, wide);

    const read = responseTo(page, portalsPath(f));
    await page.reload();
    expect((await read).status(), "portals read after reload").toBe(200);
    await expect(map).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/[?&]pins=scanned-portal(&|#|$)/);
    await expect(pins(map)).toHaveCount(0);
    await expect(scannedPortals(map)).toHaveCount(PORTAL_COUNT);
  });

  test("search: swamp → one portal; unnamed → the empty-tag portal", async ({
    page,
  }, testInfo) => {
    const f = await seedWithPortals(testInfo.parallelIndex);
    const wide = isDesktop(testInfo);
    const vc = `vc=${f.characters.top.id}`;
    await signInContextAs(page.context(), f.users.member.id);
    const map = await openMap(page, f, vc);
    const panel = await openFilters(page, wide);
    await panel
      .getByRole("searchbox", { name: "Search pin labels" })
      .fill("swamp");
    await expect(page).toHaveURL(/[?&]q=swamp(&|#|$)/);
    await expect(scannedPortals(map)).toHaveCount(1);
    await expect(portalNamed(map, "swamp")).toHaveCount(1);
    await closeFilters(page, wide);

    const unnamed = await openMap(page, f, `${vc}&q=unnamed`);
    await expect(scannedPortals(unnamed)).toHaveCount(1);
    await expect(portalNamed(unnamed, "Unnamed portal")).toHaveCount(1);
    await expect(pins(unnamed)).toHaveCount(0);
  });

  test("visitor: portals visible; Everyone shows the member hint, portals stay", async ({
    page,
  }, testInfo) => {
    const f = await seedWithPortals(testInfo.parallelIndex);
    const vc = `vc=${f.characters.top.id}`;
    await signInContextAs(page.context(), f.users.visitor.id);
    const map = await openMap(page, f, vc);
    await expect(scannedPortals(map)).toHaveCount(PORTAL_COUNT);

    const everyone = await openMap(page, f, `${vc}&players=all`);
    await expect(page.getByTestId("map-pin-filter")).toContainText(
      "Other players' pins are visible to hub members.",
    );
    await expect(pins(everyone)).toHaveCount(0);
    await expect(scannedPortals(everyone)).toHaveCount(PORTAL_COUNT);
  });

  test("hide crossed-out on: all 5 portals still drawn", async ({
    page,
  }, testInfo) => {
    const f = await seedWithPortals(testInfo.parallelIndex);
    await signInContextAs(page.context(), f.users.member.id);
    const map = await openMap(
      page,
      f,
      `vc=${f.characters.top.id}&crossed=hide`,
    );
    await expect(page).toHaveURL(/[?&]crossed=hide(&|#|$)/);
    await expect(scannedPortals(map)).toHaveCount(PORTAL_COUNT);
  });
});
