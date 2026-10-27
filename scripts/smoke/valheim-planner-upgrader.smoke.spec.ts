/**
 * ROK-1861 — Valheim 1.0.20 upgrade stations as a build step in the Planner.
 *
 * Seed: the recipes fixture with `upgrader: true` (the demo set plus a Bronze
 * cuirass made and upgraded at the "Armor upgrader", an upgrade station
 * built at the Forge). The stored list holds the cuirass at quality 3 from
 * scratch, so the plan's root row spans three quality steps. The idle plan
 * pane ("What your list needs") shows it on desktop and under the list on
 * phones. Desktop + mobile; no timing assumptions.
 */
import { test, expect } from "./base";
import { openPlanner, pageAs, planned, seedRecipes } from "./valheim-planner-fixture";

const CUIRASS = "ArmorBronzeChest";

test.describe("Valheim Planner — upgrade-station steps (ROK-1861)", () => {
  test("a q3 cuirass shows its quality steps at the upgrade station and an optional station build", async ({
    browser,
    page,
  }, testInfo) => {
    const f = await seedRecipes(testInfo, { upgrader: true });
    const owner = await pageAs(browser, page, f.ownerUserId);
    try {
      const p = owner.page;
      // Seed the stored plan once, before the app boots (not on later loads).
      await p.addInitScript(
        ([key, prefab]) => {
          if (window.sessionStorage.getItem("rok1861-seeded") !== null) return;
          window.sessionStorage.setItem("rok1861-seeded", "1");
          window.localStorage.setItem(
            key,
            JSON.stringify([
              { prefab, kind: "item", quality: 3, fromQuality: 0, amount: 1 },
            ]),
          );
        },
        [`rl.valheim.planner.${f.serverId}`, CUIRASS] as const,
      );
      await openPlanner(p, f);
      await expect(planned(p)).toHaveCount(1);

      const tree = p.getByRole("list", { name: "What your list needs" });
      const row = tree.locator(
        `[data-testid="valheim-planner-row"][data-prefab="${CUIRASS}"]`,
      );
      await expect(row).toBeVisible({ timeout: 15_000 });
      // Q3: one chip names the station, the upgrade-station flag and the level.
      await expect(
        row.getByText("Armor upgrader · Upgrade station · lvl 3", { exact: true }),
      ).toBeVisible();

      // Q4: open by default because the steps are at an upgrade station.
      const steps = row.getByTestId("valheim-planner-steps");
      await expect(
        steps.getByRole("button", { name: /3 steps/ }),
      ).toHaveAttribute("aria-expanded", "true");
      const q2 = steps.locator(
        '[data-testid="valheim-planner-step"][data-quality="2"]',
      );
      await expect(q2.getByText("Quality 2 · Armor upgrader")).toBeVisible();
      await expect(
        q2.getByText("Upgrade station · lvl 2", { exact: true }),
      ).toBeVisible();

      // Q6: the build cost is offered once, collapsed, and never added to the list.
      const build = steps.getByRole("button", {
        name: "Build Armor upgrader (optional)",
      });
      await expect(build).toHaveCount(1);
      await expect(build).toHaveAttribute("aria-expanded", "false");
      await build.click();
      await expect(build).toHaveAttribute("aria-expanded", "true");
      const cost = steps.getByTestId("valheim-planner-station-build");
      await expect(cost).toContainText("Stone 10");
      await expect(cost).toContainText("Not added to your list.");
    } finally {
      await owner.context.close();
    }
  });
});
