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
import { gunzipSync } from "node:zlib";
import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./base";
import { API_BASE, apiPost, getAdminToken } from "./api-helpers";
import { isDesktop } from "./helpers";
import { at } from "./defined";

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

const MAP_API = (c: number, m: number): string =>
  `${API_BASE}/plugins/valheim/armory/characters/${c}/maps/${m}`;

/** One stored fog layer, inflated (bit `py·n + px`, LSB-first, `py = 0` = south). */
async function fetchFogBits(
  token: string,
  f: MapFixture,
  layer: "personal" | "shared",
): Promise<Uint8Array> {
  const res = await fetch(
    `${MAP_API(f.characterId, f.mapId)}/fog?layer=${layer}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  expect(res.status, `fog layer ${layer} must be readable`).toBe(200);
  return gunzipSync(Buffer.from(await res.arrayBuffer()));
}

const bitSet = (bits: Uint8Array, i: number): boolean =>
  ((at(bits, i >> 3) >> (i & 7)) & 1) === 1;

/** First texel (px, py) matching `want` in the union of both layers. */
function findTexel(
  n: number,
  a: Uint8Array,
  b: Uint8Array,
  want: boolean,
): { px: number; py: number } | null {
  for (let i = 0; i < n * n; i++) {
    if ((bitSet(a, i) || bitSet(b, i)) === want)
      return { px: i % n, py: Math.floor(i / n) };
  }
  return null;
}

/** RGBA of one PNG pixel, decoded in the page (createImageBitmap + canvas). */
function pngPixel(page: Page, b64: string, x: number, y: number) {
  return page.evaluate(
    async ([data, px, py]) => {
      const bytes = Uint8Array.from(atob(data as string), (c) =>
        c.charCodeAt(0),
      );
      const bmp = await createImageBitmap(
        new Blob([bytes], { type: "image/png" }),
      );
      const cv = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = cv.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("no 2d context");
      ctx.drawImage(bmp, 0, 0);
      return Array.from(
        ctx.getImageData(px as number, py as number, 1, 1).data,
      );
    },
    [b64, x, y] as const,
  );
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
      `/hubs/${fixture.guildId}?vc=${fixture.characterId}&vm=${fixture.mapId}#map`,
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

  test("ROK-1949: the base map is masked server-side and unexplored fog is opaque", async ({
    page,
  }, testInfo) => {
    const fixture = await seedMap(testInfo.parallelIndex);
    expect(
      fixture.guildId,
      "map-fixture must return the hub id",
    ).not.toBeNull();
    const baseMap = page.waitForResponse(
      (r) => r.url().includes("/base-map") && r.status() === 200,
    );
    await page.goto(
      `/hubs/${fixture.guildId}?vc=${fixture.characterId}&vm=${fixture.mapId}#map`,
    );
    const res = await baseMap;
    expect(
      res.headers()["etag"] ?? "",
      "base-map ETag must be the masked m1- format, not the unmasked sha256",
    ).toMatch(/^"m1-[0-9a-f]{40}"$/);
    // Re-fetch the same URL ourselves: the page's response body can be empty when
    // the browser revalidates a cached copy (the tablet project reruns the page).
    const token = await getAdminToken();
    const direct = await fetch(res.url(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(direct.status, "base-map re-fetch must return the masked bytes").toBe(200);
    expect(
      direct.headers.get("etag") ?? "",
      "re-fetched base-map ETag must be the masked m1- format",
    ).toMatch(/^"m1-[0-9a-f]{40}"$/);
    const png = Buffer.from(await direct.arrayBuffer());
    expect(png.length, "base-map body must be a PNG").toBeGreaterThan(33);
    const n = png.readUInt32BE(16); // IHDR width of a square texture
    const personal = await fetchFogBits(token, fixture, "personal");
    const shared = await fetchFogBits(token, fixture, "shared");
    expect(personal.length, "personal bitset is ⌈n²/8⌉ bytes").toBe(
      Math.ceil((n * n) / 8),
    );
    const dark = findTexel(n, personal, shared, false);
    const lit = findTexel(n, personal, shared, true);
    expect(dark, "fixture must leave some texel unexplored").not.toBeNull();
    expect(lit, "fixture must explore some texel").not.toBeNull();
    const b64 = png.toString("base64");
    // PNG row 0 = north, bitset py 0 = south.
    const { px: dx, py: dy } = dark ?? { px: 0, py: 0 };
    const { px: lx, py: ly } = lit ?? { px: 0, py: 0 };
    expect(
      await pngPixel(page, b64, dx, n - 1 - dy),
      `base-map pixel (${dx},${n - 1 - dy}) is unexplored and must be rgba(0,0,0,0)`,
    ).toEqual([0, 0, 0, 0]);
    expect(
      (await pngPixel(page, b64, lx, n - 1 - ly))[3],
      `base-map pixel (${lx},${n - 1 - ly}) is explored and must keep its terrain (alpha 255)`,
    ).toBe(255);

    await expect(page.getByTestId("map-fog-pending")).toBeHidden({
      timeout: 15_000,
    });
    const fogAlpha = await page
      .getByRole("application", { name: "Valheim map" })
      .locator("canvas")
      .evaluate(
        (cv, [x, y]) =>
          (cv as HTMLCanvasElement)
            .getContext("2d")
            ?.getImageData(x as number, y as number, 1, 1).data[3],
        [dx, n - 1 - dy],
      );
    expect(
      fogAlpha,
      "unexplored fog canvas alpha must be fully opaque (255)",
    ).toBe(255);
  });
});
