/**
 * ROK-1444 — nomination-target smoke tests.
 *
 * Covers the two operator-facing surfaces the feature adds:
 *   1. The "open voting early" control under "More options" in the create
 *      modal — including that it is OFF by default, since null (deadline-only)
 *      is the behaviour every existing lineup relies on.
 *   2. The published nomination cap on the nominating page. The cap is the
 *      denominator the target is measured against and it moves (+5 per extra
 *      nominator), so it must be visible rather than implicit.
 */
import { test, expect } from "./base";
import {
  getAdminToken,
  createLineupOrRetry,
} from "./api-helpers";

const FILE_PREFIX = "nomination-target";

function makeWorkerPrefix(workerIndex: number): string {
  return `smoke-${FILE_PREFIX}-w${workerIndex}-`;
}

test.describe("Nomination target control (create modal)", () => {
  test("is off by default, exposing no slider", async ({ page }) => {
    test.setTimeout(60_000);

    await page.goto("/games?test=open-lineup-modal");
    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 15_000 });
    await modal.getByText(/more options/i).click();

    const toggle = modal.locator('[data-testid="nomination-target-enabled"]');
    await expect(toggle).toBeVisible({ timeout: 5_000 });
    // Default OFF preserves today's deadline-only advancement exactly.
    await expect(toggle).not.toBeChecked();
    await expect(
      modal.locator('[data-testid="nomination-target-pct"]'),
    ).toHaveCount(0);
  });

  test("reveals a 25-100 step-5 slider once switched on", async ({ page }) => {
    test.setTimeout(60_000);

    await page.goto("/games?test=open-lineup-modal");
    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 15_000 });
    await modal.getByText(/more options/i).click();

    await modal.locator('[data-testid="nomination-target-enabled"]').check();

    const slider = modal.locator('[data-testid="nomination-target-pct"]');
    await expect(slider).toBeVisible({ timeout: 5_000 });
    await expect(slider).toHaveAttribute("min", "25");
    await expect(slider).toHaveAttribute("max", "100");
    await expect(slider).toHaveAttribute("step", "5");
    await expect(slider).toHaveAttribute("value", "75");
  });
});

test.describe("Published nomination cap", () => {
  let adminToken: string;
  let workerPrefix: string;

  test.beforeAll(async ({}, testInfo) => {
    adminToken = await getAdminToken();
    // createLineupOrRetry resets this prefix itself on a 409 collision.
    workerPrefix = makeWorkerPrefix(testInfo.workerIndex);
  });

  test("shows the cap denominator and the early-advance target", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    const { id } = await createLineupOrRetry(
      adminToken,
      {
        title: `${workerPrefix}cap-display`,
        buildingDurationHours: 48,
        nominationTargetPct: 50,
      },
      workerPrefix,
    );

    await page.goto(`/community-lineup/${id}`);
    await expect(page.locator("body")).not.toHaveText(/something went wrong/i, {
      timeout: 10_000,
    });

    // Base cap with zero nominators is 20 — published, not implied.
    await expect(page.getByText(/0 \/ 20 nominated/i).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/voting opens at 50%/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("omits the target copy for a deadline-only lineup", async ({ page }) => {
    test.setTimeout(90_000);

    const { id } = await createLineupOrRetry(
      adminToken,
      {
        title: `${workerPrefix}no-target`,
        buildingDurationHours: 48,
      },
      workerPrefix,
    );

    await page.goto(`/community-lineup/${id}`);
    await expect(page.getByText(/0 \/ 20 nominated/i).first()).toBeVisible({
      timeout: 15_000,
    });
    // No target configured -> no early-advance promise in the copy.
    await expect(page.getByText(/voting opens at/i)).toHaveCount(0);
  });
});
