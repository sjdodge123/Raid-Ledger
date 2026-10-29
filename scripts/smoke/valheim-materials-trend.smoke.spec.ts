/**
 * ROK-2014 — the Valheim Materials tab's play-day trend chip.
 *
 * Seed: `POST /admin/test/valheim/armory/seed-containers { worker, trendDays: 3 }`
 * (DEMO_MODE) imports the golden containers scan (fixed `capturedAt`
 * 2026-10-17, so play days Oct 17 / 16 / 14 / 11) and writes three earlier
 * play days through the real day repository. Known deltas, newest first:
 * shared Wood +20 / +15 / +10 = +45 without carts, +85 with the cart's +40;
 * Stone −10 on Oct 17 (net drop → danger); BlackMetal +60 on Oct 14; the
 * private chest's Coins +100 on Oct 16 (owner + admins only). SwordIron never
 * moves → no chip. The default fixture is ONE base holding every chest, so
 * the per-base trend under the Base filter equals the shared one.
 *
 * Runs as the default (admin) session. Waits are poll- or expect-driven only.
 */
import type { Locator, Page, TestInfo } from "@playwright/test";
import { test, expect } from "./base";
import { API_BASE, apiGet, apiPost, getAdminToken } from "./api-helpers";
import { isDesktop } from "./helpers";

const FIXTURE = "/admin/test/valheim/armory/seed-containers";
const SLOTS = 16;

interface TrendFixture {
  serverId: number;
  hubId: number;
  guildPageUrl: string;
}

interface MaterialsRead {
  shared?: { trend?: { days?: unknown[] } };
  bases?: { key: string }[];
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

/** Seeds the scan + 3 prior play days, then polls the read until the trend is there; returns the base key. */
async function seedTrend(
  testInfo: TestInfo,
): Promise<{ f: TrendFixture; baseKey: string }> {
  const token = await getAdminToken();
  await ensurePluginActive(token, "pelican");
  await ensurePluginActive(token, "valheim");
  const body = (await apiPost(token, FIXTURE, {
    worker: testInfo.parallelIndex % SLOTS,
    trendDays: 3,
  })) as Partial<TrendFixture> | null;
  expect(
    body?.hubId,
    `containers fixture seed failed: ${JSON.stringify(body)}`,
  ).toEqual(expect.any(Number));
  const f = body as TrendFixture;
  let read: MaterialsRead | null = null;
  await expect
    .poll(
      async () => {
        read = (await apiGet(
          token,
          `/plugins/valheim/armory/servers/${f.serverId}/materials`,
        )) as MaterialsRead | null;
        return read?.shared?.trend?.days?.length ?? 0;
      },
      { message: "materials never reported 3 trend days", timeout: 15_000 },
    )
    .toBe(3);
  const baseKey = (read as MaterialsRead | null)?.bases?.[0]?.key;
  expect(baseKey, "the seeded scan forms one base").toEqual(expect.any(String));
  return { f, baseKey: baseKey ?? "" };
}

function totals(page: Page, wide: boolean, caption = "Shared chest totals") {
  return page.getByRole(wide ? "table" : "list", { name: caption });
}

function totalRows(scope: Locator, wide: boolean): Locator {
  return wide ? scope.locator("tbody tr") : scope.getByRole("listitem");
}

const chip = (row: Locator, name: RegExp): Locator =>
  row.getByRole("button", { name });

/** Flip "Include carts and ships" off (inline panel ≥1024px, BottomSheet below). */
async function vehiclesOff(page: Page, wide: boolean) {
  await page
    .getByRole("button", { name: /^Filters/ })
    .first()
    .click();
  const toggle = page.getByRole("switch", { name: "Include carts and ships" });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  if (wide) return;
  await page.keyboard.press("Escape");
  await expect(toggle).toBeHidden();
}

test.describe("Valheim hub — Materials trend chip (ROK-2014)", () => {
  test("item rows show the 3-day net change; drop is danger; tap opens the per-day line; Base filter keeps it", async ({
    page,
  }, testInfo) => {
    const { f, baseKey } = await seedTrend(testInfo);
    const wide = isDesktop(testInfo);
    await page.goto(f.guildPageUrl);
    const shared = totals(page, wide);
    await expect(shared).toBeVisible({ timeout: 15_000 });
    const wood = totalRows(shared, wide).filter({ hasText: "Wood" });
    await expect(wood).toHaveCount(1);

    // Carts on (default): Wood +85; Stone's net drop reads danger.
    await expect(chip(wood, /^\+85 over 3 days/)).toBeVisible();
    const stone = totalRows(shared, wide).filter({ hasText: "Stone" });
    const drop = chip(stone, /^−10 over 3 days/);
    await expect(drop).toBeVisible();
    await expect(drop).toHaveAttribute("data-tone", "danger");
    // Wood, Stone, BlackMetal move; SwordIron (and anything else) has no chip.
    await expect(shared.getByTestId("materials-trend")).toHaveCount(3);
    expect(await totalRows(shared, wide).count()).toBeGreaterThan(3);

    // Carts off: the cart's +40 drops out → +45; tap shows the per-day line.
    await vehiclesOff(page, wide);
    const woodChip = chip(wood, /^\+45 over 3 days/);
    await expect(woodChip).toBeVisible();
    const detail = wood.getByText("Oct 17 +20 · Oct 16 +15 · Oct 14 +10", {
      exact: true,
    });
    await expect(detail).toBeHidden();
    await woodChip.click();
    await expect(woodChip).toHaveAttribute("aria-expanded", "true");
    await expect(detail).toBeVisible();

    // Admin reads the private chest: Coins +100 in the personal section.
    const personal = totals(page, wide, "Personal chest totals");
    await expect(
      chip(totalRows(personal, wide), /^\+100 over 3 days/),
    ).toBeVisible();

    // Under the Base filter the item rows carry that base's own trend.
    // A hash-only goto keeps the SPA (and carts off); reload for a fresh tab.
    await page.goto(`${f.guildPageUrl}?base=${baseKey}`);
    await page.reload();
    await expect(shared).toBeVisible({ timeout: 15_000 });
    await expect(chip(wood, /^\+85 over 3 days/)).toBeVisible();
    await expect(shared.getByTestId("materials-trend")).toHaveCount(3);
  });
});
