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
 * Deep links (D13): a row's count + pin opens `?pins=death&vc=<characterId>#map`
 * (ROK-2029: its name opens `/valheim/characters/<id>`); the card's
 * "Show all" opens `?pins=death&players=all#map` (every player's Death pins on
 * the world, each named "<label> · <character>" — ROK-1943 D14). ROK-1943
 * retired the Layers "Death pins only" switch: the Map pin filter (Filters
 * funnel ≥1024px, Filters FAB + sheet below) now owns the type filter, and the
 * cross-player layer is `GET …/servers/:id/pins`. Waits are response- or
 * expect-driven only.
 */
import type { Page } from "@playwright/test";
import { test, expect } from "./base";
import { API_BASE } from "./api-helpers";
import { signInContextAs } from "./browser-session";
import { isDesktop } from "./helpers";
import {
  type Fixture,
  closeFilters,
  mapApp,
  openFilters,
  pinNames,
  pins,
  playerPinName,
  responseTo,
  seedDeathsFixture as seed,
  serverPinsPath,
} from "./valheim-pin-filter-helpers";

const deathsList = (page: Page) =>
  page.getByRole("list", { name: "Deaths by player" });
const deathWord = (n: number) => `${n} ${n === 1 ? "death" : "deaths"}`;

/** Full load of the hub Overview, settled on the Deaths read. */
async function openOverview(page: Page, f: Fixture): Promise<void> {
  const deaths = responseTo(page, `/servers/${f.serverId}/deaths`);
  await page.goto(`/hubs/${f.guildId}`);
  const res = await deaths;
  expect(res.status(), `deaths read answered ${res.status()}`).toBe(200);
}

test.describe("Valheim hub — Deaths card + death pins (ROK-1930)", () => {
  test("member: bars sorted desc, the name opens the character page, the count opens their Death pins, the switch clears them", async ({
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

    // ROK-2029: the name opens the character page …
    await rows
      .nth(0)
      .getByRole("link", { name: `Open ${top.name}'s character page` })
      .click();
    await expect(page).toHaveURL(new RegExp(`/valheim/characters/${top.id}$`));
    await expect(
      page.getByRole("heading", { level: 1, name: top.name }),
    ).toBeVisible({ timeout: 15_000 });
    await page.goBack();
    await expect(deathsList(page)).toBeVisible({ timeout: 15_000 });

    // … and the separate count + pin link opens their Death pins on the Map tab.
    await rows
      .nth(0)
      .getByRole("link", {
        name: `Show ${top.name}'s ${deathWord(top.deaths)} on the map`,
      })
      .click();
    await expect(page).toHaveURL(/[?&]pins=death(&|#|$)/);
    await expect(page).toHaveURL(new RegExp(`[?&]vc=${top.id}(&|#|$)`));
    await expect(page).toHaveURL(/#map$/);
    const map = mapApp(page);
    await expect(map).toBeVisible({ timeout: 15_000 });
    await expect(pins(map)).toHaveCount(top.deathPinLabels.length);
    for (const label of top.deathPinLabels) {
      await expect(
        map.getByRole("button", { name: `${label} (Death)`, exact: true }),
      ).toHaveCount(1);
    }

    // The bar's `pins=death` is the Death chip in the Map pin filter; Clear all
    // (ROK-1943) is the panel's way back to every pin — the retired switch's job.
    const panel = await openFilters(page, wide);
    const death = panel.getByTestId("map-pin-type-death");
    await expect(death).toHaveAttribute("aria-pressed", "true");
    await panel.getByRole("button", { name: "Clear all", exact: true }).click();
    await expect(death).toHaveAttribute("aria-pressed", "false");
    await closeFilters(page, wide);
    await expect(page).not.toHaveURL(/[?&]pins=/);
    await expect(page).toHaveURL(new RegExp(`[?&]vc=${top.id}(&|#|$)`));
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

    const layer = responseTo(page, serverPinsPath(f.serverId));
    await page.getByTestId("valheim-deaths-show-all").click();
    const res = await layer;
    expect(res.status(), `server-pins read answered ${res.status()}`).toBe(200);
    // Everyone (no `players`), Death chip → the raw `types=Death` (D4).
    const query = new URL(res.url()).searchParams;
    expect(query.get("types"), "Show all asks for Death pins only").toBe(
      "Death",
    );
    expect(query.has("players"), "Show all asks for every player").toBe(false);
    await expect(page).toHaveURL(/[?&]pins=death(&|#|$)/);
    await expect(page).toHaveURL(/[?&]players=all(&|#|$)/);
    await expect(page).not.toHaveURL(/[?&]vc=/);
    const map = mapApp(page);
    await expect(map).toBeVisible({ timeout: 15_000 });
    const total = top.deathPinLabels.length + second.deathPinLabels.length;
    await expect(pins(map)).toHaveCount(total);
    expect(await pinNames(map)).toEqual(
      [
        ...top.deathPinLabels.map((l) => playerPinName(l, top.name, "Death")),
        ...second.deathPinLabels.map((l) =>
          playerPinName(l, second.name, "Death"),
        ),
      ].sort(),
    );
  });

  test("visitor: no Deaths card on the Overview, and the deaths read is a 404", async ({
    page,
  }, testInfo) => {
    const f = await seed(testInfo.parallelIndex);
    await signInContextAs(page.context(), f.users.visitor.id);
    // Both registered BEFORE navigation: the boot refresh mints the visitor's
    // token; the hub page read is what the Overview cards gate on.
    const refresh = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        new URL(r.url()).pathname.endsWith("/auth/refresh"),
      { timeout: 15_000 },
    );
    const hubRead = responseTo(page, `/guilds/${f.guildId}`);
    await page.goto(`/hubs/${f.guildId}`);
    const hub = await hubRead;
    expect(hub.status(), `hub page read answered ${hub.status()}`).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 15_000,
    });
    await expect(deathsList(page)).toHaveCount(0);
    await expect(page.getByTestId("valheim-deaths-show-all")).toHaveCount(0);

    // D6: the card is hidden client-side, so prove the server refuses too.
    const boot = await refresh;
    const jwt = ((await boot.json()) as { access_token?: unknown })
      .access_token;
    expect(typeof jwt, "visitor boot refresh returned an access_token").toBe(
      "string",
    );
    const direct = await page
      .context()
      .request.get(
        `${API_BASE}/plugins/valheim/armory/servers/${f.serverId}/deaths`,
        { headers: { Authorization: `Bearer ${String(jwt)}` } },
      );
    expect(direct.status(), "visitor deaths read (D6)").toBe(404);
  });
});
