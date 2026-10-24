/**
 * ROK-1948 — the Valheim hub Planner's spoiler protection (desktop + mobile).
 *
 * Seed + locators: `./valheim-planner-fixture`, with the `spoilers` preset:
 * - `early`: every character on the server knows only Workbench + Club +
 *   Cultivator (Bronze 5 + Wood 5 at the Workbench). The Forge, Bronze and
 *   both swords are hidden from everyone, staff included.
 * - `none`: every discovery list is empty, so protection is off and the full
 *   catalogue shows with a muted note.
 * - `all` (default): an unclaimed scout knows everything; ROK-1862's chip on
 *   the owner's undiscovered Bronze sword still shows.
 *
 * Waits are web-first assertions and `expect.poll` — never sleeps.
 */
import type { Page } from "@playwright/test";
import { test, expect } from "./base";
import { isDesktop } from "./helpers";
import {
  addToList,
  craftRows,
  craftWindow,
  openPlanner,
  pageAs,
  pageAsAdmin,
  planned,
  searchBox,
  seedRecipes,
  showPlanPane,
  stationSwitcher,
} from "./valheim-planner-fixture";

const PROTECTED = "Showing only what someone on this server has discovered.";
const OFF_NO_DATA =
  "Spoiler protection is off — no character on this server has shared what they've discovered yet (RL Valheim Link 0.4.2+).";
const UNDISCOVERED = "Needs something nobody on the server has found yet.";
const PLAN_FOOTER =
  "Part of this plan needs something nobody on the server has found yet.";
const HIDDEN_TARGET = "Hidden item: nobody on the server has found it yet";
const CHIP = "Not discovered yet";

const statusLine = (page: Page) => page.getByTestId("valheim-planner-spoilers");

/** Search, then return the row for `prefab` (found by its OWN data-prefab). */
async function searchRow(page: Page, query: string, prefab: string) {
  await searchBox(page).fill(query);
  return craftRows(craftWindow(page), prefab);
}

/** Under `early`: only the Workbench, and no hidden name reachable by search. */
async function expectEarlyCatalogue(page: Page) {
  await expect(statusLine(page)).toHaveText(PROTECTED);
  const switcher = stationSwitcher(page);
  await expect(
    switcher.getByRole("radio", { name: "Workbench" }),
  ).toBeVisible();
  await expect(
    switcher.getByRole("radio", { name: "Forge" }),
    "no Forge chip while nobody has found the Forge",
  ).toHaveCount(0);
  // Positive control: search does render rows for a visible recipe.
  await expect(await searchRow(page, "cult", "Cultivator")).toBeVisible();
  for (const term of ["bronze", "forge", "sword"]) {
    await searchBox(page).fill(term);
    await expect(
      craftRows(craftWindow(page)),
      `'${term}' matches nothing under protection`,
    ).toHaveCount(0);
  }
  await searchBox(page).fill("");
}

test.describe("Valheim hub — Planner spoiler protection (ROK-1948)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("early: the Forge, Bronze and Bronze sword are hidden for a member AND the site admin", async ({
    page,
    browser,
  }, testInfo) => {
    const f = await seedRecipes(testInfo, { spoilers: "early" });
    for (const open of [
      () => pageAs(browser, page, f.memberUserId),
      () => pageAsAdmin(browser, page),
    ]) {
      const viewer = await open();
      try {
        await openPlanner(viewer.page, f);
        await expectEarlyCatalogue(viewer.page);
      } finally {
        await viewer.context.close();
      }
    }
  });

  test("early: planning Cultivator shows the generic undiscovered line, never Bronze's name", async ({
    page,
    browser,
  }, testInfo) => {
    const f = await seedRecipes(testInfo, { spoilers: "early" });
    const wide = isDesktop(testInfo);
    const member = await pageAs(browser, page, f.memberUserId);
    try {
      const p = member.page;
      await openPlanner(p, f);
      await addToList(p, wide, "cult", "Cultivator");
      await expect(planned(p)).toHaveCount(1);
      await expect(planned(p).first()).toContainText("Cultivator");

      await showPlanPane(p, wide);
      const tree = p.getByRole("list", { name: "What your list needs" });
      await expect(
        tree.locator(
          '[data-testid="valheim-planner-row"][data-prefab="Cultivator"]',
        ),
      ).toBeVisible();
      await expect(
        tree.getByTestId("valheim-planner-row-undiscovered"),
      ).toContainText(UNDISCOVERED);
      await expect(
        tree,
        "the tree never names the withheld ingredient",
      ).not.toContainText(/Bronze/i);
      await expect(
        tree.locator('[data-prefab="Bronze"]'),
        "no withheld prefab in the DOM",
      ).toHaveCount(0);
      await expect(p.getByText(PLAN_FOOTER)).toBeVisible();
    } finally {
      await member.context.close();
    }
  });

  test("early: a stored Bronze sword target renders as a hidden item with Remove", async ({
    page,
    browser,
  }, testInfo) => {
    const f = await seedRecipes(testInfo, { spoilers: "early" });
    const member = await pageAs(browser, page, f.memberUserId);
    try {
      const p = member.page;
      // Seed the stored plan once, before the app boots (not on later loads).
      await p.addInitScript((key) => {
        if (window.sessionStorage.getItem("rok1948-seeded") !== null) return;
        window.sessionStorage.setItem("rok1948-seeded", "1");
        window.localStorage.setItem(
          key,
          JSON.stringify([
            {
              prefab: "SwordBronze",
              kind: "item",
              quality: 1,
              fromQuality: 0,
              amount: 1,
            },
          ]),
        );
      }, `rl.valheim.planner.${f.serverId}`);
      await openPlanner(p, f);

      const hidden = planned(p).filter({ hasText: HIDDEN_TARGET });
      await expect(hidden).toHaveCount(1);
      await expect(
        p.locator("body"),
        "no Bronze text anywhere",
      ).not.toContainText(/Bronze/i);
      await hidden.getByRole("button", { name: "Remove hidden item" }).click();
      await expect(p.getByText(HIDDEN_TARGET)).toHaveCount(0);
    } finally {
      await member.context.close();
    }
  });

  test("none: protection is off — Bronze sword and the Forge are listed with the muted off note", async ({
    page,
    browser,
  }, testInfo) => {
    const f = await seedRecipes(testInfo, { spoilers: "none" });
    const member = await pageAs(browser, page, f.memberUserId);
    try {
      const p = member.page;
      await openPlanner(p, f);
      await expect(statusLine(p)).toHaveText(OFF_NO_DATA);
      await expect(p.getByText(PROTECTED)).toHaveCount(0);
      await expect(
        stationSwitcher(p).getByRole("radio", { name: "Forge" }),
      ).toBeVisible();
      await expect(
        await searchRow(p, "Bronze sword", "SwordBronze"),
      ).toBeVisible();
    } finally {
      await member.context.close();
    }
  });

  test("all: ROK-1862's chip still marks the owner's undiscovered Bronze sword", async ({
    page,
    browser,
  }, testInfo) => {
    const f = await seedRecipes(testInfo, { spoilers: "all" });
    const owner = await pageAs(browser, page, f.ownerUserId);
    try {
      const p = owner.page;
      await openPlanner(p, f);
      await expect(statusLine(p)).toHaveText(PROTECTED);
      const sword = await searchRow(p, "Bronze sword", "SwordBronze");
      await expect(sword).toHaveAttribute("data-discovered", "false", {
        timeout: 15_000,
      });
      await expect(sword.getByText(CHIP)).toBeVisible();
      const club = await searchRow(p, "Club", "Club");
      await expect(club).toHaveAttribute("data-discovered", "true");
      await expect(club.getByText(CHIP)).toHaveCount(0);
    } finally {
      await owner.context.close();
    }
  });
});
