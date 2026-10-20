/**
 * ROK-1837 T9 — the Valheim Map tab on a game-server hub.
 *
 * Seed: `POST /admin/test/valheim/map-fixture { worker }` (DEMO_MODE, ROK-1837
 * L3) upserts THIS worker's Valheim-mapped Pelican row + hub, a claimed
 * character for the admin, and a map from `map-shared-layer.json` (3 personal
 * pins + 1 cartography-table pin, personal + shared fog) with a generated base
 * map. The slot is the worker's `parallelIndex`, so projects never share a row.
 *
 * The hub id comes back as `guildId`. It is null until the ROK-1831 hub seam
 * lands; the test then SKIPS with that reason rather than guessing a URL. It
 * also needs the Map tab registered on Valheim hubs (`register.ts`, after
 * ROK-1831) — until then `#map` has no panel and the test fails at the map.
 *
 * Determinism: no pixel positions anywhere. Zoom is read from the texture
 * stack's `data-zoom` (scale, 2dp): Fit first to pin the baseline, Zoom in must
 * change it, Fit must restore it. Pins are counted by role inside the map
 * application (the zoom/layer controls sit outside it). Phones and tablets
 * (<1024px) reach the switches through the "Layers" BottomSheet.
 */
import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./base";
import { API_BASE, apiPost, getAdminToken } from "./api-helpers";
import { isDesktop } from "./helpers";

const FIXTURE = "/admin/test/valheim/map-fixture";
const SHARED = "Show cartography table";

interface MapFixture {
  characterId: number;
  mapId: number;
  pelicanServerId: number;
  guildId: number | null;
}

/** Install-or-activate through the admin plugin API (pelican-quick-play-switch pattern). */
async function ensurePluginActive(
  token: string,
  pluginId: string,
): Promise<void> {
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
      `failed to enable the ${pluginId} plugin: install ${install.status}, activate ${activate.status}`,
    );
}

async function seedMap(worker: number): Promise<MapFixture> {
  const token = await getAdminToken();
  await ensurePluginActive(token, "pelican");
  await ensurePluginActive(token, "valheim");
  const body = (await apiPost(token, FIXTURE, {
    worker,
  })) as Partial<MapFixture>;
  expect(
    body.characterId,
    `map fixture seed failed: ${JSON.stringify(body)}`,
  ).toEqual(expect.any(Number));
  expect(body.mapId, "map fixture returned no mapId").toEqual(
    expect.any(Number),
  );
  return {
    characterId: body.characterId ?? -1,
    mapId: body.mapId ?? -1,
    pelicanServerId: body.pelicanServerId ?? -1,
    guildId: typeof body.guildId === "number" ? body.guildId : null,
  };
}

/** Pins are the only buttons inside the map application. */
function pins(map: Locator): Locator {
  return map.getByRole("button");
}

/** Open the switches: inline ≥1024px, the Layers sheet below it. Returns their scope. */
async function openLayers(page: Page, wide: boolean): Promise<Locator> {
  if (wide) return page.locator("body");
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Layers" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("switch", { name: SHARED })).toBeVisible();
  return sheet;
}

async function closeLayers(page: Page, wide: boolean): Promise<void> {
  if (wide) return;
  const sheet = page.getByRole("dialog", { name: "Layers" });
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toBeHidden();
}

test.describe("Valheim hub — Map tab (ROK-1837)", () => {
  test("renders the map, zooms and fits, and the shared layer adds the cartography pin", async ({
    page,
  }, testInfo) => {
    const fixture = await seedMap(testInfo.parallelIndex);
    expect(
      fixture.guildId,
      "map-fixture must return the fixture server's hub id",
    ).not.toBeNull();
    const wide = isDesktop(testInfo);

    await page.goto(
      `/guilds/${fixture.guildId}?vc=${fixture.characterId}&vm=${fixture.mapId}#map`,
    );
    const map = page.getByRole("application", { name: "Valheim map" });
    await expect(map).toBeVisible({ timeout: 15_000 });
    await expect(map.locator("img")).toBeVisible();

    // AC3: 3 personal pins, each named "<label> (<type>[, checked])".
    await expect(pins(map)).toHaveCount(3);
    for (const pin of await pins(map).all()) {
      await expect(pin).toHaveAccessibleName(/\(.+\)$/);
    }

    // Zoom: compare data-zoom before/after, never pixels.
    const stack = map.locator("[data-zoom]");
    const zoomIn = page.getByRole("button", { name: "Zoom in" });
    const fit = page.getByRole("button", { name: "Fit map" });
    await expect(zoomIn).toBeEnabled();
    await fit.click();
    const fitted = await stack.getAttribute("data-zoom");
    expect(fitted, "texture stack has no data-zoom").not.toBeNull();
    await zoomIn.click();
    await expect(stack).not.toHaveAttribute("data-zoom", fitted ?? "");
    await page.getByRole("button", { name: "Zoom out" }).click();
    await fit.click();
    await expect(stack).toHaveAttribute("data-zoom", fitted ?? "");

    // AC2: the shared switch adds the cartography-table pin.
    const scope = await openLayers(page, wide);
    const shared = scope.getByRole("switch", { name: SHARED });
    await expect(shared).toHaveAttribute("aria-checked", "false");
    await shared.click();
    await expect(shared).toHaveAttribute("aria-checked", "true");
    await closeLayers(page, wide);
    await expect(pins(map)).toHaveCount(4);
    // The shared pin's name carries the prototype's ", cartography table" suffix.
    await expect(
      map.getByRole("button", {
        name: /\(.+, cartography table(, checked)?\)$/,
      }),
    ).toHaveCount(1);
  });
});
