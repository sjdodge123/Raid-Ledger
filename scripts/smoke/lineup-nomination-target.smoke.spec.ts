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
 *   3. ROK-1710: editing the target after creation from the operator menu's
 *      Edit modal, and the "early advance is off" copy a lineup shows once an
 *      operator revert (voting -> building) disarmed its target. Runs in both
 *      projects: on mobile the operator menu opens as a bottom sheet with the
 *      same test ids.
 */
import type { Page } from "@playwright/test";
import { test, expect } from "./base";
import {
  getAdminToken,
  createLineupOrRetry,
  apiGet,
  apiPatch,
  apiPost,
  awaitProcessing,
  cancelLineupPhaseJobs,
  waitForLineupStatus,
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
    // React drives the property on a controlled range input; the attribute
    // only happens to match on first render.
    await expect(slider).toHaveValue("75");
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

/** Open the operator menu's Edit item and return the Edit Lineup dialog. */
async function openEditModal(page: Page) {
  await page.getByTestId("lineup-operator-menu-trigger").click();
  await page.getByTestId("lineup-operator-menu-edit").click();
  const modal = page
    .locator('[role="dialog"]')
    .filter({ hasText: "Edit Lineup" });
  await expect(modal).toBeVisible({ timeout: 10_000 });
  await expect(
    modal.getByTestId("edit-lineup-target-section"),
  ).toBeVisible({ timeout: 5_000 });
  return modal;
}

/**
 * A building lineup with a 50% target that an operator reverted from voting,
 * so `nominationTargetDisarmedAt` is stamped. One nomination clears the
 * voting floor; phase jobs are cancelled so the scheduler cannot race us.
 */
async function createDisarmedLineup(
  token: string,
  title: string,
  prefix: string,
): Promise<number> {
  const games = await apiGet(token, "/admin/settings/games");
  const gameId = games?.data?.[0]?.id as number | undefined;
  if (!gameId) throw new Error("Demo data missing — need 1 configured game");
  const { id } = await createLineupOrRetry(
    token,
    { title, buildingDurationHours: 720, votingDurationHours: 720, nominationTargetPct: 50 },
    prefix,
  );
  await cancelLineupPhaseJobs(token, id);
  await apiPost(token, `/lineups/${id}/nominate`, { gameId });
  await apiPatch(token, `/lineups/${id}/status`, { status: "voting" });
  await waitForLineupStatus(token, id, "voting");
  await apiPatch(token, `/lineups/${id}/status`, { status: "building" });
  await awaitProcessing(token);
  await waitForLineupStatus(token, id, "building");
  const back = await apiGet(token, `/lineups/${id}`);
  if (back?.nominationTargetDisarmedAt == null) {
    throw new Error(`lineup ${id} reverted to building but was not disarmed`);
  }
  return id;
}

test.describe("Editing the nomination target (ROK-1710)", () => {
  let adminToken: string;
  let workerPrefix: string;

  test.beforeAll(async ({}, testInfo) => {
    adminToken = await getAdminToken();
    workerPrefix = `${makeWorkerPrefix(testInfo.workerIndex)}edit-`;
  });

  test("the creator turns a target on and the hero promises it", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    const { id } = await createLineupOrRetry(
      adminToken,
      { title: `${workerPrefix}turn-on`, buildingDurationHours: 48 },
      workerPrefix,
    );
    await page.goto(`/community-lineup/${id}`);
    await expect(page.getByText(/0 \/ 20 nominated/i).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/voting opens at/i)).toHaveCount(0);

    const modal = await openEditModal(page);
    await modal.locator('[data-testid="nomination-target-enabled"]').check();
    await expect(
      modal.locator('[data-testid="nomination-target-pct"]'),
    ).toHaveValue("75");
    await modal.getByRole("button", { name: /^Save/ }).click();
    await expect(modal).toBeHidden({ timeout: 10_000 });

    await expect(page.getByText(/voting opens at 75%/i).first()).toBeVisible({
      timeout: 10_000,
    });
    const after = await apiGet(adminToken, `/lineups/${id}`);
    expect(after?.nominationTargetPct).toBe(75);
  });

  test("a reverted lineup says early advance is off, and an edit re-arms it", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const id = await createDisarmedLineup(
      adminToken,
      `${workerPrefix}disarmed`,
      workerPrefix,
    );
    await page.goto(`/community-lineup/${id}`);
    await expect(
      page.getByText(/early advance is off — this lineup was reverted/i).first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/voting opens at/i)).toHaveCount(0);

    const modal = await openEditModal(page);
    await expect(
      modal.getByTestId("edit-lineup-target-disarmed"),
    ).toBeVisible();
    // Off then on: a deliberate touch, which lands on the 75% default.
    const toggle = modal.locator('[data-testid="nomination-target-enabled"]');
    await toggle.uncheck();
    await toggle.check();
    await modal.getByRole("button", { name: /^Save/ }).click();
    await expect(modal).toBeHidden({ timeout: 10_000 });

    await expect(page.getByText(/voting opens at 75%/i).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByText(/early advance is off — this lineup was reverted/i),
    ).toHaveCount(0);
    const after = await apiGet(adminToken, `/lineups/${id}`);
    expect(after?.nominationTargetDisarmedAt).toBeNull();
    expect(after?.nominationTargetArmed).toBe(true);
  });
});
