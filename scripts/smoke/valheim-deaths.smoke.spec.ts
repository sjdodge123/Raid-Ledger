/**
 * ROK-1930 — the Valheim hub Overview "Deaths" card and the Map tab's death
 * pin filter it deep-links into.
 *
 * Seed: `POST /admin/test/valheim/deaths-fixture { worker }` (DEMO_MODE,
 * ROK-1930 L5) resets THIS worker's own server hub to two characters with a
 * map each on one world — `top` (5 deaths; Death pins "Day 12" + "Day 31", a
 * "Camp" pin and a shared cartography-table pin) and `second` (3 deaths; one
 * Death pin) — plus a name-only player (1 death, no character → not a link),
 * a hub member and a signed-in non-member visitor. The slot is the worker's
 * `parallelIndex`, so projects never share a server.
 *
 * Deep links (D13): a bar opens `?pins=death&vc=<characterId>#map`; the card's
 * "Show all" opens `?pins=death#map` (every player's Death pins on the world,
 * each named after its character). Phones (<1024px) reach the switches through
 * the "Layers" BottomSheet. Waits are response- or expect-driven only.
 */
import type { Locator, Page, Response } from "@playwright/test";
import { test, expect } from "./base";
import { API_BASE, apiPost, getAdminToken } from "./api-helpers";
import { signInContextAs } from "./browser-session";
import { isDesktop } from "./helpers";

const FIXTURE = "/admin/test/valheim/deaths-fixture";
const DEATHS_ONLY = "Death pins only";

interface FixtureCharacter {
  id: number;
  name: string;
  mapId: number;
  deaths: number;
  deathPinLabels: string[];
}

interface Fixture {
  serverId: number;
  guildId: number;
  worldUid: string;
  users: { member: { id: number }; visitor: { id: number } };
  characters: { top: FixtureCharacter; second: FixtureCharacter };
  unlinked: { name: string; deaths: number };
}

/** Install-or-activate through the admin plugin API (valheim-map-tab pattern). */
async function ensurePluginActive(
  token: string,
  pluginId: string,
): Promise<void> {
  const init = {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
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

async function seed(worker: number): Promise<Fixture> {
  const token = await getAdminToken();
  await ensurePluginActive(token, "pelican");
  await ensurePluginActive(token, "valheim");
  const body = (await apiPost(token, FIXTURE, { worker })) as Partial<Fixture>;
  expect(
    body.guildId,
    `deaths fixture seed failed: ${JSON.stringify(body)}`,
  ).toEqual(expect.any(Number));
  return body as Fixture;
}

/** Resolves with the first response whose path ends with `suffix` (register BEFORE the action). */
function responseTo(page: Page, suffix: string): Promise<Response> {
  return page.waitForResponse(
    (r) => new URL(r.url()).pathname.endsWith(suffix),
    { timeout: 15_000 },
  );
}

const deathsList = (page: Page) =>
  page.getByRole("list", { name: "Deaths by player" });
const mapApp = (page: Page) =>
  page.getByRole("application", { name: "Valheim map" });
/** Pins are the only buttons inside the map application. */
const pins = (map: Locator) => map.getByRole("button");
const deathWord = (n: number) => `${n} ${n === 1 ? "death" : "deaths"}`;

/** Full load of the hub Overview, settled on the Deaths read. */
async function openOverview(page: Page, f: Fixture): Promise<void> {
  const deaths = responseTo(page, `/servers/${f.serverId}/deaths`);
  await page.goto(`/hubs/${f.guildId}`);
  const res = await deaths;
  expect(res.status(), `deaths read answered ${res.status()}`).toBe(200);
}

/** The switches: inline ≥1024px, the Layers sheet below it. Returns their scope. */
async function openLayers(page: Page, wide: boolean): Promise<Locator> {
  if (wide) return page.locator("body");
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Layers" });
  await expect(sheet).toBeVisible();
  return sheet;
}

async function closeLayers(page: Page, wide: boolean): Promise<void> {
  if (wide) return;
  const sheet = page.getByRole("dialog", { name: "Layers" });
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toBeHidden();
}

/** The pins' accessible names, sorted (order on the map is not meaningful). */
async function pinNames(map: Locator): Promise<string[]> {
  const names = await pins(map).evaluateAll((els) =>
    els.map((e) => e.getAttribute("aria-label") ?? e.textContent ?? ""),
  );
  return names.map((n) => n.trim()).sort();
}

test.describe("Valheim hub — Deaths card + death pins (ROK-1930)", () => {
  test("member: bars sorted desc, a bar opens that character's Death pins, the switch clears them", async ({
    page,
  }, testInfo) => {
    const f = await seed(testInfo.parallelIndex);
    const { top, second } = f.characters;
    const wide = isDesktop(testInfo);
    await signInContextAs(page.context(), f.users.member.id);
    await openOverview(page, f);

    const rows = deathsList(page).getByTestId("valheim-deaths-row");
    await expect(rows).toHaveCount(3);
    await expect(rows).toHaveText([
      new RegExp(`${top.name}\\s*${top.deaths}`),
      new RegExp(`${second.name}\\s*${second.deaths}`),
      new RegExp(`${f.unlinked.name}\\s*${f.unlinked.deaths}`),
    ]);
    await expect(page.getByTestId("valheim-deaths-since")).toHaveText(
      /^Counted since \S/,
    );
    // The name-only player has no character → plain text, not a link.
    await expect(rows.nth(2).getByRole("link")).toHaveCount(0);

    await page
      .getByRole("link", {
        name: `${top.name}, ${deathWord(top.deaths)} — show on map`,
      })
      .click();
    await expect(page).toHaveURL(/[?&]pins=death(&|#|$)/);
    await expect(page).toHaveURL(new RegExp(`[?&]vc=${top.id}(&|#|$)`));
    await expect(page).toHaveURL(/#map$/);
    const map = mapApp(page);
    await expect(map).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText("Showing this character's death pins"),
    ).toBeVisible();
    await expect(pins(map)).toHaveCount(top.deathPinLabels.length);
    for (const label of top.deathPinLabels) {
      await expect(
        map.getByRole("button", { name: `${label} (Death)`, exact: true }),
      ).toHaveCount(1);
    }

    const scope = await openLayers(page, wide);
    const deathsOnly = scope.getByRole("switch", { name: DEATHS_ONLY });
    await expect(deathsOnly).toHaveAttribute("aria-checked", "true");
    await deathsOnly.click();
    await expect(deathsOnly).toHaveAttribute("aria-checked", "false");
    await closeLayers(page, wide);
    await expect(page).not.toHaveURL(/[?&]pins=death/);
    // Every personal pin is back (2 Death + Camp); the shared one waits on its own layer.
    await expect(pins(map)).toHaveCount(top.deathPinLabels.length + 1);
    await expect(map.getByRole("button", { name: /^Camp \(/ })).toHaveCount(1);
  });

  test("member: Show all draws every player's Death pins on the world", async ({
    page,
  }, testInfo) => {
    const f = await seed(testInfo.parallelIndex);
    const { top, second } = f.characters;
    await signInContextAs(page.context(), f.users.member.id);
    await openOverview(page, f);
    await expect(deathsList(page)).toBeVisible();

    const layer = responseTo(page, `/servers/${f.serverId}/deaths/pins`);
    await page.getByTestId("valheim-deaths-show-all").click();
    const res = await layer;
    expect(res.status(), `death-pins read answered ${res.status()}`).toBe(200);
    await expect(page).toHaveURL(/[?&]pins=death(&|#|$)/);
    await expect(page).not.toHaveURL(/[?&]vc=/);
    const map = mapApp(page);
    await expect(map).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText("Showing every player's death pins"),
    ).toBeVisible();
    const total = top.deathPinLabels.length + second.deathPinLabels.length;
    await expect(pins(map)).toHaveCount(total);
    expect(await pinNames(map)).toEqual(
      [
        ...top.deathPinLabels.map(() => `${top.name} (Death)`),
        ...second.deathPinLabels.map(() => `${second.name} (Death)`),
      ].sort(),
    );
  });

  test("visitor: no Deaths card on the Overview", async ({
    page,
  }, testInfo) => {
    const f = await seed(testInfo.parallelIndex);
    await signInContextAs(page.context(), f.users.visitor.id);
    const statuses: number[] = [];
    page.on("response", (r) => {
      if (new URL(r.url()).pathname.endsWith(`/servers/${f.serverId}/deaths`))
        statuses.push(r.status());
    });
    await page.goto(`/hubs/${f.guildId}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 15_000,
    });
    await page.waitForLoadState("networkidle");
    await expect(deathsList(page)).toHaveCount(0);
    await expect(page.getByTestId("valheim-deaths-show-all")).toHaveCount(0);
    // If the page asked at all, the server refused it (D6: visitors get 404).
    expect(statuses.every((s) => s === 404)).toBe(true);
  });
});
