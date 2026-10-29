/**
 * ROK-1959 D-7 — the hub Gallery's "Saves" chip, desktop AND mobile projects.
 *
 * Seed: the ROK-1930 `POST /admin/test/valheim/deaths-fixture { worker }` gives
 * THIS worker its own server hub + member; `POST /admin/test/hub-media/seed
 * { guildId, count: 3 }` adds Discord pictures (death · screenshot · image) and
 * `{ guildId, source: 'bg3-save', uploadedBy, count: 2 }` (DEMO_MODE, ROK-1959
 * L4) adds two game-save pictures owned by the member. Save pictures list only
 * while the `bg3` plugin is active (its media gate fails closed), so the spec
 * enables it first. Batches accumulate across runs: counts are read from the
 * API, never assumed. Waits are response- or expect-driven only.
 */
import type { Locator, Page, TestInfo } from "@playwright/test";
import { test, expect } from "./base";
import { API_BASE, apiGet, apiPost, getAdminToken, pollForCondition } from "./api-helpers";
import { signInContextAs } from "./browser-session";
import { isDesktop } from "./helpers";
import { type Fixture, responseTo, seedDeathsFixture } from "./valheim-pin-filter-helpers";

interface ListBody {
  total: number;
  items: { kind: string }[];
}

/** Install-or-activate through the admin plugin API (valheim-pin-filter-helpers pattern). */
async function ensurePluginActive(token: string, pluginId: string): Promise<void> {
  const init = { method: "POST", headers: { Authorization: `Bearer ${token}` } };
  const install = await fetch(`${API_BASE}/admin/plugins/${pluginId}/install`, init);
  if (install.ok) return;
  const activate = await fetch(`${API_BASE}/admin/plugins/${pluginId}/activate`, init);
  if (!activate.ok) throw new Error(`failed to enable ${pluginId}: install ${install.status}, activate ${activate.status}`);
}

/** Server hub + Discord pictures + two save pictures, the saves confirmed through `?kind=save`. */
async function seed(testInfo: TestInfo): Promise<{ f: Fixture; saves: number }> {
  const f = await seedDeathsFixture(testInfo.parallelIndex);
  const token = await getAdminToken();
  await ensurePluginActive(token, "bg3");
  const discord = (await apiPost(token, "/admin/test/hub-media/seed", { guildId: f.guildId, count: 3 })) as { ids?: number[] };
  expect(discord.ids, `discord seed: ${JSON.stringify(discord)}`).toHaveLength(3);
  const saves = (await apiPost(token, "/admin/test/hub-media/seed", {
    guildId: f.guildId,
    source: "bg3-save",
    uploadedBy: f.users.member.id,
    count: 2,
  })) as { ids?: number[] };
  expect(saves.ids, `save seed: ${JSON.stringify(saves)}`).toHaveLength(2);
  const listed = await pollForCondition(
    async () => {
      const body = (await apiGet(token, `/hubs/${f.guildId}/media?kind=save&limit=1`)) as ListBody | null;
      return body !== null && body.total >= 2 ? body : null;
    },
    { description: "seeded save pictures listed", timeoutMs: 15_000 },
  );
  return { f, saves: listed.total };
}

const card = (page: Page): Locator => page.locator("#hub-widget-core-gallery");
const dialog = (page: Page): Locator => page.getByRole("dialog", { name: "Gallery" });

async function openOverview(page: Page, f: Fixture): Promise<void> {
  const media = responseTo(page, `/hubs/${f.guildId}/media`);
  await page.goto(`/hubs/${f.guildId}`);
  expect((await media).status()).toBe(200);
  await expect(card(page)).toBeVisible({ timeout: 15_000 });
}

async function tileKinds(tiles: Locator): Promise<(string | null)[]> {
  return tiles.evaluateAll((els) => els.map((e) => e.getAttribute("data-kind")));
}

test.describe("Hub Gallery — Saves chip (ROK-1959)", () => {
  test("member: the Saves chip sits after Screenshots and narrows the strip to save pictures", async ({ page }, testInfo) => {
    const { f, saves } = await seed(testInfo);
    await signInContextAs(page.context(), f.users.member.id);
    await openOverview(page, f);

    const chips = card(page).getByRole("group", { name: "Show pictures" }).getByRole("button");
    await expect(chips).toHaveText(["All", "Deaths", "Screenshots", "Saves"]);
    const savesChip = card(page).getByTestId("hub-gallery-chip-save");
    await expect(savesChip).toHaveAttribute("aria-pressed", "false");

    const savePage = page.waitForResponse(
      (r) => r.request().method() === "GET" && new URL(r.url()).searchParams.get("kind") === "save",
      { timeout: 15_000 },
    );
    await savesChip.click();
    expect((await savePage).status(), "the Saves chip asks for kind=save").toBe(200);
    await expect(savesChip).toHaveAttribute("aria-pressed", "true");

    const tiles = card(page).getByTestId("hub-gallery-tile");
    await expect(tiles).toHaveCount(Math.min(saves, isDesktop(testInfo) ? 8 : 6));
    const kinds = await tileKinds(tiles);
    expect(kinds.every((k) => k === "save"), `strip kinds ${kinds.join(",")}`).toBe(true);
    await expect(tiles.first()).toHaveAccessibleName(/^Save — /);
  });

  test("member: a save picture opens in the viewer with the Game save source", async ({ page }, testInfo) => {
    const { f, saves } = await seed(testInfo);
    await signInContextAs(page.context(), f.users.member.id);
    await openOverview(page, f);

    await card(page).getByTestId("hub-gallery-chip-save").click();
    await expect(card(page).getByTestId("hub-gallery-tile").first()).toHaveAttribute("data-kind", "save");
    await card(page).getByTestId("hub-gallery-tile").first().click();
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).getByText(`1 of ${saves}`, { exact: true })).toBeVisible();
    await expect(page.getByTestId("hub-gallery-caption")).toContainText("Game save");
  });
});
