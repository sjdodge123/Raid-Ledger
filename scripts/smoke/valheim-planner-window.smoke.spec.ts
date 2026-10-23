/**
 * ROK-1899 — the Valheim hub Planner's crafting window (desktop + mobile).
 *
 * Seed + locators: `./valheim-planner-fixture`. The recipes fixture puts Club
 * (Wood 6; upgrades q2 Wood 3, q3 Wood 6) at the Workbench and Bronze (Copper
 * 2 + Tin 1), Bronze sword (Bronze 8 + …; upgrades to q4) and Iron sword at
 * the Forge. The public chests hold plenty of Wood and 40 Copper but no Tin,
 * so Club is affordable and every Bronze row is short ("need 1 more Tin").
 *
 * Covers: the station switcher, search narrowing across stations, affordable
 * rows first and short rows greyed, the selection's slots with have/need,
 * "Add to list" landing in the shopping list, an UPGRADE step adding a
 * "q1→2" target, and the phone BottomSheet. Waits are web-first assertions
 * and `expect.poll` (rows re-rank once the stock query lands) — never sleeps.
 */
import type { Page } from "@playwright/test";
import { test, expect } from "./base";
import { isDesktop } from "./helpers";
import {
  addSelected,
  chooseMode,
  chooseRadio,
  craftRows,
  craftWindow,
  detailScope,
  openPlanner,
  pageAs,
  pickRow,
  planned,
  rowPrefabs,
  searchBox,
  seedRecipes,
  stationSwitcher,
} from "./valheim-planner-fixture";

const recipeList = (page: Page, name: string) =>
  craftWindow(page).getByRole("list", { name });

const slot = (page: Page, wide: boolean, name: string | RegExp) =>
  detailScope(page, wide).getByRole("listitem", { name });

/** The selection's title: the pane's accent heading, or the sheet's name. */
async function expectTitle(page: Page, wide: boolean, title: string) {
  if (wide)
    await expect(
      detailScope(page, wide).getByRole("heading", { name: title }),
    ).toBeVisible();
  else await expect(page.getByRole("dialog", { name: title })).toBeVisible();
}

test.describe("Valheim hub — Planner crafting window (ROK-1899)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("station switch shows only that station's rows; search narrows across stations", async ({
    page,
    browser,
  }, testInfo) => {
    const f = await seedRecipes(testInfo);
    const member = await pageAs(browser, page, f.memberUserId);
    try {
      const p = member.page;
      await openPlanner(p, f);
      const switcher = stationSwitcher(p);

      await chooseRadio(switcher, "Workbench");
      await expect
        .poll(() => rowPrefabs(recipeList(p, "Workbench recipes")), {
          message: "the Workbench lists only Club",
        })
        .toEqual(["Club"]);
      await expect(craftWindow(p)).toContainText("max 5");

      await chooseRadio(switcher, "Forge");
      const forge = recipeList(p, "Forge recipes");
      await expect
        .poll(() => rowPrefabs(forge), { message: "the Forge rows" })
        .toEqual(expect.arrayContaining(["Bronze", "SwordBronze"]));
      await expect(craftRows(forge, "Club")).toHaveCount(0);
      await expect(craftWindow(p)).toContainText("max 7");

      // Search spans every station of the mode; the switcher shows no
      // selection and each row names its station.
      await searchBox(p).fill("bro");
      const matches = recipeList(p, "Matches from every station");
      await expect
        .poll(async () => (await rowPrefabs(matches)).sort(), {
          message: "'bro' matches the two Bronze rows only",
        })
        .toEqual(["Bronze", "SwordBronze"]);
      await expect(craftRows(matches, "Bronze")).toContainText("Forge");
      await expect(switcher.getByRole("radio", { checked: true })).toHaveCount(
        0,
      );

      // Clearing the search restores the last station.
      await searchBox(p).fill("");
      await expect(recipeList(p, "Forge recipes")).toBeVisible();
      await expect(
        switcher.getByRole("radio", { name: "Forge" }),
      ).toBeChecked();
    } finally {
      await member.context.close();
    }
  });

  test("affordable rows sort first, short rows grey; a selection shows have/need slots and adds to the list", async ({
    page,
    browser,
  }, testInfo) => {
    const f = await seedRecipes(testInfo);
    const wide = isDesktop(testInfo);
    const member = await pageAs(browser, page, f.memberUserId);
    try {
      const p = member.page;
      await openPlanner(p, f);

      // "b" matches Club (Workbench, affordable) and both Bronze rows (Forge,
      // short): affordable first, then short, each alphabetical.
      await searchBox(p).fill("b");
      const matches = recipeList(p, "Matches from every station");
      await expect
        .poll(() => rowPrefabs(matches), {
          message: "affordable Club first, then the short Bronze rows",
        })
        .toEqual(["Club", "Bronze", "SwordBronze"]);
      const club = craftRows(matches, "Club");
      const bronze = craftRows(matches, "Bronze");
      await expect(club).toHaveAttribute("data-afford", "can");
      await expect(club).not.toContainText("⊘");
      await expect(bronze).toHaveAttribute("data-afford", "short");
      await expect(bronze).toContainText("⊘");
      await expect(bronze).toHaveAttribute(
        "aria-description",
        "Can't craft yet: need 1 more Tin",
      );
      if (!wide) {
        const box = await club.boundingBox();
        expect(box?.height ?? 0, "phone rows are ≥44px").toBeGreaterThanOrEqual(
          44,
        );
      }

      // A greyed row stays selectable: its slots state have/need.
      await pickRow(p, "b", "Bronze");
      await expectTitle(p, wide, "Bronze");
      const tin = slot(p, wide, "Tin: need 1, you have 0, 1 short");
      await expect(tin).toHaveAttribute("data-short", "true");
      await expect(tin).toContainText("1 short");
      const copper = slot(p, wide, "Copper: need 2, you have 40");
      await expect(copper).toBeVisible();
      await expect(copper).not.toHaveAttribute("data-short", "true");
      await expect(slot(p, wide, "Forge, level 1")).toBeVisible();

      await addSelected(p, wide);
      await expect(planned(p)).toHaveCount(1);
      await expect(planned(p).first()).toContainText("Bronze");
      await expect(planned(p).first()).toContainText("× 1");
    } finally {
      await member.context.close();
    }
  });

  test("UPGRADE: the step follows 'Upgrade to quality' and adds a q1→2 target", async ({
    page,
    browser,
  }, testInfo) => {
    const f = await seedRecipes(testInfo);
    const wide = isDesktop(testInfo);
    const member = await pageAs(browser, page, f.memberUserId);
    try {
      const p = member.page;
      await openPlanner(p, f);
      await chooseMode(p, "UPGRADE");
      const switcher = stationSwitcher(p);

      await chooseRadio(switcher, "Forge");
      const forge = recipeList(p, "Forge upgrades");
      await expect(craftRows(forge, "SwordBronze")).toHaveAttribute(
        "data-afford",
        "short",
      );

      await chooseRadio(switcher, "Workbench");
      const bench = recipeList(p, "Workbench upgrades");
      await expect
        .poll(() => rowPrefabs(bench), { message: "Workbench upgrades" })
        .toEqual(["Club"]);
      const club = craftRows(bench, "Club");
      await expect(club).toHaveAttribute("data-afford", "can");
      await club.click();
      await expect(club).toHaveAttribute("aria-pressed", "true");

      const scope = detailScope(p, wide);
      const quality = scope.getByRole("combobox", {
        name: "Upgrade to quality",
      });
      await expectTitle(p, wide, "Club — quality 2");
      await expect(quality).toHaveValue("2");
      await expect(slot(p, wide, /^Wood: need 3, you have \d+$/)).toBeVisible();

      // The slots follow the chosen step…
      await quality.selectOption("3");
      await expectTitle(p, wide, "Club — quality 3");
      await expect(slot(p, wide, /^Wood: need 6, you have \d+$/)).toBeVisible();

      // …and the 1→2 step lands in the shopping list as "q1→2".
      await quality.selectOption("2");
      await expectTitle(p, wide, "Club — quality 2");
      await addSelected(p, wide);
      await expect(planned(p)).toHaveCount(1);
      await expect(planned(p).first()).toContainText("Club · q1→2 × 1");
    } finally {
      await member.context.close();
    }
  });

  test("phone: a tap opens the detail in the bottom sheet; Escape returns focus to the row", async ({
    page,
    browser,
  }, testInfo) => {
    test.skip(isDesktop(testInfo), "the BottomSheet is the <1024px layout");
    const f = await seedRecipes(testInfo);
    const member = await pageAs(browser, page, f.memberUserId);
    try {
      const p = member.page;
      await openPlanner(p, f);
      await expect(
        p.getByRole("region", { name: "Recipe detail" }),
        "no inline pane on phones",
      ).toHaveCount(0);

      await pickRow(p, "Bronze", "Bronze");
      const sheet = p.getByRole("dialog", { name: "Bronze" });
      await expect(sheet).toBeVisible();
      await expect(
        sheet.getByRole("spinbutton", { name: "Amount" }),
      ).toBeVisible();
      await expect(
        sheet.getByRole("button", { name: "Add to list" }),
      ).toBeVisible();
      await expect(
        sheet.locator("details").filter({ hasText: "Full breakdown" }),
        "the breakdown starts collapsed in the sheet",
      ).not.toHaveAttribute("open", "");
      await expect(
        sheet.getByRole("listitem", {
          name: "Tin: need 1, you have 0, 1 short",
        }),
      ).toBeVisible();

      await p.keyboard.press("Escape");
      await expect(p.getByRole("dialog")).toHaveCount(0);
      await expect(craftRows(craftWindow(p), "Bronze")).toBeFocused();
    } finally {
      await member.context.close();
    }
  });
});
