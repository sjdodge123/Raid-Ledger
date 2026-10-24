/**
 * ROK-1943 — the Valheim Map tab's pin filter (spec S25/S26): Pin types chips,
 * Whose pins (This character / Everyone / Choose players), label search and
 * Hide crossed-out pins, all held in the URL (`pins` / `players` / `q` /
 * `crossed`) next to the map selection (`vc`). The entry is the §4.1 funnel +
 * inline panel ≥1024px and the Filters FAB + BottomSheet below
 * (`openFilters`), so both projects drive the same controls.
 *
 * Seed: the ROK-1930 deaths fixture (`valheim-pin-filter-helpers.ts` header).
 * It has no crossed-out pin, so the cross-player read is passed through with
 * the second character's "Copper" pin marked `checked` — the real response,
 * one flag flipped, to give Hide crossed-out pins a pin to drop.
 * Waits are response- or expect-driven only.
 */
import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./base";
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
  seedDeathsFixture,
  serverPinsPath,
} from "./valheim-pin-filter-helpers";

/** The fixture pin the pass-through route marks crossed out. */
const CROSSED_LABEL = "Copper";
const EMPTY_TEXT = "No pins match these filters.";

/** Marks the `CROSSED_LABEL` pin `checked` on every cross-player read. */
async function markCopperCrossed(page: Page, f: Fixture): Promise<void> {
  const path = serverPinsPath(f.serverId);
  await page.route(
    (url) => url.pathname.endsWith(path),
    async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as {
        pins: Array<{ label: string; checked: boolean }>;
      };
      for (const pin of body.pins)
        if (pin.label === CROSSED_LABEL) pin.checked = true;
      await route.fulfill({ response, json: body });
    },
  );
}

/** The cross-player read's query (`types`, `players`) after `action`. */
async function serverPinsQuery(
  page: Page,
  f: Fixture,
  action: () => Promise<unknown>,
): Promise<URLSearchParams> {
  const read = responseTo(page, serverPinsPath(f.serverId));
  await action();
  const res = await read;
  expect(res.status(), `server-pins read answered ${res.status()}`).toBe(200);
  return new URL(res.url()).searchParams;
}

const summary = (page: Page): Locator => page.getByTestId("map-pin-filter");
const badge = (page: Page): Locator => page.getByTestId("filter-count-badge");

test.describe("Valheim Map — pin filter (ROK-1943)", () => {
  test("member: type chip, Everyone, label search, hide crossed-out, reload, Clear filters", async ({
    page,
  }, testInfo) => {
    const f = await seedDeathsFixture(testInfo.parallelIndex);
    const { top, second } = f.characters;
    const wide = isDesktop(testInfo);
    await markCopperCrossed(page, f);
    await signInContextAs(page.context(), f.users.member.id);
    await page.goto(`/hubs/${f.guildId}?vc=${top.id}#map`);
    const map = mapApp(page);
    await expect(map).toBeVisible({ timeout: 15_000 });
    // This character, no filter: 2 Death + Camp (the shared pin is its own layer).
    await expect(pins(map)).toHaveCount(top.deathPinLabels.length + 1);
    await expect(badge(page)).toHaveCount(0);

    // Pin types: the Death chip → `pins=death`, only Death pins drawn.
    const panel = await openFilters(page, wide);
    const death = panel.getByTestId("map-pin-type-death");
    await death.click();
    await expect(death).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveURL(/[?&]pins=death(&|#|$)/);
    await expect(pins(map)).toHaveCount(top.deathPinLabels.length);
    expect(await pinNames(map)).toEqual(
      top.deathPinLabels.map((l) => `${l} (Death)`).sort(),
    );

    // Whose pins → Everyone: one cross-player read, every player's Death pins.
    const everyone = await serverPinsQuery(page, f, () =>
      panel.getByText("Everyone", { exact: true }).click(),
    );
    expect(everyone.get("types"), "Death chip → types=Death").toBe("Death");
    expect(everyone.has("players"), "Everyone sends no players").toBe(false);
    await expect(panel.getByRole("radio", { name: "Everyone" })).toBeChecked();
    await expect(page).toHaveURL(/[?&]players=all(&|#|$)/);
    await expect(pins(map)).toHaveCount(
      top.deathPinLabels.length + second.deathPinLabels.length,
    );
    expect(await pinNames(map)).toEqual(
      [
        ...top.deathPinLabels.map((l) => playerPinName(l, top.name, "Death")),
        ...second.deathPinLabels.map((l) =>
          playerPinName(l, second.name, "Death"),
        ),
      ].sort(),
    );

    // All types: the read drops `types`; the second character's Home pin appears.
    const allTypes = await serverPinsQuery(page, f, () =>
      panel.getByRole("button", { name: "All types", exact: true }).click(),
    );
    expect(allTypes.has("types"), "All types sends no types").toBe(false);
    await expect(death).toHaveAttribute("aria-pressed", "false");
    await expect(page).not.toHaveURL(/[?&]pins=/);
    const copper = map.getByRole("button", {
      name: playerPinName(CROSSED_LABEL, second.name, "Home, checked"),
      exact: true,
    });
    await expect(copper).toHaveCount(1);
    // Own, non-shared pins of both characters: top 2 Death + Camp, second Death + Copper.
    await expect(pins(map)).toHaveCount(
      top.deathPinLabels.length + 1 + second.deathPinLabels.length + 1,
    );

    // Label search (case-insensitive, debounced into `q`) narrows to Copper.
    await panel
      .getByRole("searchbox", { name: "Search pin labels" })
      .fill("COPPER");
    await expect(page).toHaveURL(/[?&]q=COPPER(&|#|$)/);
    await expect(pins(map)).toHaveCount(1);
    await expect(copper).toHaveCount(1);

    // Hide crossed-out pins drops the checked Copper → the empty state.
    const crossed = panel.getByRole("checkbox", {
      name: "Hide crossed-out pins",
    });
    await crossed.check();
    await expect(crossed).toBeChecked();
    await expect(page).toHaveURL(/[?&]crossed=hide(&|#|$)/);
    await expect(pins(map)).toHaveCount(0);
    await expect(summary(page)).toContainText(EMPTY_TEXT);
    await closeFilters(page, wide);
    // Three non-default sections: Whose pins, Search labels, Hide crossed-out.
    await expect(badge(page)).toHaveText("3");

    // Reload: the URL carries every filter.
    await serverPinsQuery(page, f, () => page.reload());
    await expect(map).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/[?&]players=all(&|#|$)/);
    await expect(page).toHaveURL(/[?&]q=COPPER(&|#|$)/);
    await expect(page).toHaveURL(/[?&]crossed=hide(&|#|$)/);
    await expect(pins(map)).toHaveCount(0);
    await expect(summary(page)).toContainText(EMPTY_TEXT);
    await expect(badge(page)).toHaveText("3");

    // Clear filters (empty state): back to this character, every own pin; `vc` kept.
    await summary(page)
      .getByRole("button", { name: "Clear filters", exact: true })
      .click();
    await expect(page).not.toHaveURL(/[?&](pins|players|q|crossed)=/);
    await expect(page).toHaveURL(new RegExp(`[?&]vc=${top.id}(&|#|$)`));
    await expect(pins(map)).toHaveCount(top.deathPinLabels.length + 1);
    await expect(summary(page)).not.toContainText(EMPTY_TEXT);
    await expect(badge(page)).toHaveCount(0);
  });

  test("legacy ?pins=death#map lands on every player's Death pins", async ({
    page,
  }, testInfo) => {
    const f = await seedDeathsFixture(testInfo.parallelIndex);
    const { top, second } = f.characters;
    const wide = isDesktop(testInfo);
    await signInContextAs(page.context(), f.users.member.id);

    // Legacy link (no `vc`, no `players`) → Everyone, Death chip (S13/S26).
    const query = await serverPinsQuery(page, f, () =>
      page.goto(`/hubs/${f.guildId}?pins=death#map`),
    );
    expect(query.get("types"), "legacy pins=death → types=Death").toBe("Death");
    expect(query.has("players"), "legacy pins=death → every player").toBe(
      false,
    );
    const map = mapApp(page);
    await expect(map).toBeVisible({ timeout: 15_000 });
    await expect(pins(map)).toHaveCount(
      top.deathPinLabels.length + second.deathPinLabels.length,
    );
    expect(await pinNames(map)).toEqual(
      [
        ...top.deathPinLabels.map((l) => playerPinName(l, top.name, "Death")),
        ...second.deathPinLabels.map((l) =>
          playerPinName(l, second.name, "Death"),
        ),
      ].sort(),
    );

    const panel = await openFilters(page, wide);
    await expect(panel.getByTestId("map-pin-type-death")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(panel.getByRole("radio", { name: "Everyone" })).toBeChecked();
    await closeFilters(page, wide);
  });
});
