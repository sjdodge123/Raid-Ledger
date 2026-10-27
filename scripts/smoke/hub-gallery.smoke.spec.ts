/**
 * ROK-1942 — the hub Overview "Gallery" card and its one dialog (lightbox +
 * See-all grid), desktop AND mobile projects.
 *
 * Seed: the ROK-1930 `POST /admin/test/valheim/deaths-fixture { worker }` gives
 * THIS worker its own Valheim server hub, a member and a non-member visitor;
 * `POST /admin/test/hub-media/seed { guildId, count }` (DEMO_MODE, ROK-1942 L2)
 * then adds a fresh batch of generated pictures cycling death → screenshot →
 * image. Batches accumulate across runs, so counts are read from the API, never
 * assumed. The seed is polled through the list route before the browser opens.
 * Waits are response- or expect-driven only.
 */
import type { Locator, Page, TestInfo } from "@playwright/test";
import { test, expect } from "./base";
import { apiGet, apiPost, getAdminToken, pollForCondition } from "./api-helpers";
import { signInContextAs } from "./browser-session";
import { isDesktop } from "./helpers";
import {
  type Fixture,
  responseTo,
  seedDeathsFixture,
} from "./valheim-pin-filter-helpers";

const SEED_COUNT = 14;

interface ListBody {
  total: number;
  items: { kind: string }[];
}

/** Server hub + ≥ SEED_COUNT pictures, confirmed through the list route. */
async function seed(testInfo: TestInfo): Promise<{ f: Fixture; total: number; deaths: number }> {
  const f = await seedDeathsFixture(testInfo.parallelIndex);
  const token = await getAdminToken();
  const res = (await apiPost(token, "/admin/test/hub-media/seed", {
    guildId: f.guildId,
    count: SEED_COUNT,
  })) as { ids?: number[] };
  expect(res.ids, `hub-media seed: ${JSON.stringify(res)}`).toHaveLength(SEED_COUNT);
  const all = await pollForCondition(
    async () => {
      const body = (await apiGet(token, `/hubs/${f.guildId}/media?limit=1`)) as ListBody | null;
      return body !== null && body.total >= SEED_COUNT ? body : null;
    },
    { description: "seeded pictures listed", timeoutMs: 15_000 },
  );
  const deaths = (await apiGet(token, `/hubs/${f.guildId}/media?kind=death&limit=1`)) as ListBody;
  return { f, total: all.total, deaths: deaths.total };
}

const card = (page: Page): Locator => page.locator("#hub-widget-core-gallery");
const dialog = (page: Page): Locator => page.getByRole("dialog", { name: "Gallery" });
const viewer = (page: Page): Locator => page.getByTestId("hub-gallery-viewer");

async function openOverview(page: Page, f: Fixture): Promise<void> {
  const media = responseTo(page, `/hubs/${f.guildId}/media`);
  await page.goto(`/hubs/${f.guildId}`);
  expect((await media).status()).toBe(200);
  await expect(card(page)).toBeVisible({ timeout: 15_000 });
}

async function boxOf(l: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const b = await l.boundingBox();
  if (b === null) throw new Error("element has no bounding box");
  return b;
}

test.describe("Hub Gallery — card, lightbox, filter, See all (ROK-1942)", () => {
  test("member: tile → lightbox, ←/→ and Next walk the set, Escape returns focus to the tile", async ({ page }, testInfo) => {
    const { f, total } = await seed(testInfo);
    await signInContextAs(page.context(), f.users.member.id);
    await openOverview(page, f);

    const tiles = card(page).getByTestId("hub-gallery-tile");
    await expect(tiles).toHaveCount(isDesktop(testInfo) ? 8 : 6);
    await tiles.nth(1).click();
    await expect(dialog(page)).toBeVisible();
    await expect(viewer(page).getByText(`2 of ${total}`, { exact: true })).toBeVisible();

    await page.keyboard.press("ArrowRight");
    await expect(viewer(page).getByText(`3 of ${total}`, { exact: true })).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(viewer(page).getByText(`1 of ${total}`, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Previous picture" })).toBeDisabled();
    await page.getByRole("button", { name: "Next picture" }).click();
    await expect(viewer(page).getByText(`2 of ${total}`, { exact: true })).toBeVisible();
    await expect(page.getByTestId("hub-gallery-caption")).toContainText(/Death|Screenshot|Picture/);
    // Prev/Next sit on either side of the picture, vertically centred together, fully on-screen and apart.
    const [prev, next, frame] = await Promise.all([
      boxOf(page.getByRole("button", { name: "Previous picture" })),
      boxOf(page.getByRole("button", { name: "Next picture" })),
      boxOf(viewer(page)),
    ]);
    expect(prev.x + prev.width, "Prev ends before Next starts").toBeLessThan(next.x);
    expect(Math.abs(prev.y - next.y), "Prev and Next share a row").toBeLessThan(2);
    expect(next.x + next.width, "Next stays inside the viewer").toBeLessThanOrEqual(frame.x + frame.width + 1);
    expect(prev.x, "Prev stays inside the viewer").toBeGreaterThanOrEqual(frame.x - 1);
    expect(next.x + next.width, "Next stays on-screen").toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
    // A member never gets the editor / staff actions.
    await expect(dialog(page).getByRole("button", { name: "Hide" })).toHaveCount(0);
    await expect(dialog(page).getByRole("button", { name: "Remove" })).toHaveCount(0);

    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
    await expect(tiles.nth(1)).toBeFocused();
  });

  test("member: See all → grid, the Deaths chip narrows it and Prev/Next stay inside it", async ({ page }, testInfo) => {
    const { f, total, deaths } = await seed(testInfo);
    await signInContextAs(page.context(), f.users.member.id);
    await openOverview(page, f);

    await card(page).getByTestId("hub-gallery-see-all").click();
    const grid = dialog(page).getByTestId("hub-gallery-grid");
    await expect(grid).toBeVisible();
    await expect(dialog(page).getByText(`${total} pictures`, { exact: true })).toBeVisible();

    const deathsPage = responseTo(page, `/hubs/${f.guildId}/media`);
    await dialog(page).getByTestId("hub-gallery-chip-death").click();
    await deathsPage;
    await expect(dialog(page).getByText(`${deaths} pictures`, { exact: true })).toBeVisible();
    const gridTiles = grid.getByTestId("hub-gallery-tile");
    await expect(gridTiles.first()).toHaveAttribute("data-kind", "death");
    const kinds = await gridTiles.evaluateAll((els) => els.map((e) => e.getAttribute("data-kind")));
    expect(kinds.every((k) => k === "death"), `grid kinds ${kinds.join(",")}`).toBe(true);

    await gridTiles.first().click();
    await expect(viewer(page).getByText(`1 of ${deaths}`, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Next picture" }).click();
    await expect(viewer(page).getByText(`2 of ${deaths}`, { exact: true })).toBeVisible();
    await expect(page.getByTestId("hub-gallery-caption")).toContainText(/^Death/);

    await dialog(page).getByRole("button", { name: "Back to all" }).click();
    await expect(grid).toBeVisible();
    await dialog(page).getByRole("button", { name: /close/i }).first().click();
    await expect(dialog(page)).toHaveCount(0);
    // The dialog's chip is the card's chip too (operator ruling 2026-10-24).
    await expect(card(page).getByTestId("hub-gallery-chip-death")).toHaveAttribute("aria-pressed", "true");
  });

  test("visitor: no Gallery card", async ({ page }, testInfo) => {
    const { f } = await seed(testInfo);
    await signInContextAs(page.context(), f.users.visitor.id);
    const hubRead = responseTo(page, `/guilds/${f.guildId}`);
    await page.goto(`/hubs/${f.guildId}`);
    expect((await hubRead).status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 15_000 });
    await expect(card(page)).toHaveCount(0);
  });
});
