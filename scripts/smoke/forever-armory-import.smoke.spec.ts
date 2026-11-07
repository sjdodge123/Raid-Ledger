/**
 * ROK-1722 — Armory import for WoW: Forever (on by default).
 *
 * Forever is realmless, so its "Import from Armory" tab renders the shared
 * Forever identity block (Region / Ruleset / First name / Second name) instead
 * of Name + Realm. A one-word name is blocked client-side before any request,
 * and a valid two-part lookup calls the preview route WITHOUT a `realm` param;
 * the preview card shows the ruleset + region ("PvP (US)") where a realm sits.
 *
 * The preview route is mocked (`page.route`) — CI never calls live Blizzard.
 * Nothing is saved, so there is nothing to clean up. Runs under every project.
 */
import type { Locator, Page, Request } from "@playwright/test";
import { test, expect } from "./base";

const GAME_NAME = "World of Warcraft: Forever";
const PREVIEW_PATH = "/blizzard/character-preview";
const ONE_WORD_ERROR = "Enter a first and second name";

/** The mocked Forever preview: realmless, like the server's ROK-2102 lookup. */
const FOREVER_PREVIEW = {
  name: "Ana Forever",
  realm: null,
  class: "Warrior",
  spec: null,
  role: "dps",
  level: 60,
  race: "Human",
  faction: "alliance",
  itemLevel: null,
  avatarUrl: null,
  profileUrl: null,
};

interface ArmoryForm {
  dialog: Locator;
  block: Locator;
  region: Locator;
  ruleset: Locator;
  first: Locator;
  second: Locator;
  search: Locator;
}

/** CI has no Blizzard keys: answer the status read with Blizzard configured (page-local) so the Armory tab mounts its form. */
async function forceBlizzardConfigured(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname.endsWith("/system/status"),
    async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as Record<string, unknown>;
      await route.fulfill({
        response,
        json: { ...body, blizzardConfigured: true },
      });
    },
  );
}

/** Open Add Character, pick WoW: Forever, switch to the Armory tab. */
async function openForeverArmory(page: Page): Promise<ArmoryForm> {
  await forceBlizzardConfigured(page);
  await page.goto("/profile/gaming/characters");
  await page.getByRole("button", { name: "Add Character" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add Character" });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  const game = dialog.getByRole("combobox", { name: "Game", exact: true });
  const settled = page.waitForResponse(
    (r) => {
      const url = new URL(r.url());
      return (
        url.pathname.endsWith("/games/search") &&
        url.searchParams.get("q") === GAME_NAME &&
        r.ok()
      );
    },
    { timeout: 20_000 },
  );
  await game.click();
  await game.pressSequentially(GAME_NAME, { delay: 20 });
  await settled;
  await page
    .getByRole("listbox")
    .getByRole("option", { name: GAME_NAME, exact: true })
    .click();
  await expect(game).toHaveValue(GAME_NAME);

  const tab = dialog.getByRole("button", { name: "Import from Armory" });
  await expect(
    tab,
    "Armory import is on by default for Forever",
  ).not.toHaveAttribute("aria-disabled", "true", {
    timeout: 15_000,
  });
  await tab.click();
  const block = dialog.getByTestId("forever-identity-fields");
  return {
    dialog,
    block,
    region: dialog.getByRole("combobox", { name: "Region", exact: true }),
    ruleset: dialog.getByRole("radiogroup", { name: "Ruleset" }),
    first: dialog.getByRole("textbox", { name: "First name", exact: true }),
    second: dialog.getByRole("textbox", { name: "Second name", exact: true }),
    search: dialog.getByRole("button", { name: "Search Armory" }),
  };
}

function isPreviewRequest(url: URL): boolean {
  return url.pathname.endsWith(PREVIEW_PATH);
}

/** Capture (and answer) every preview request; returns the live list. */
async function mockPreview(page: Page): Promise<Request[]> {
  const seen: Request[] = [];
  await page.route(isPreviewRequest, async (route) => {
    seen.push(route.request());
    await route.fulfill({
      status: 200,
      // Not route.fetch(): CI must never reach live Blizzard. Echo the
      // origin so the cross-origin read is allowed.
      headers: {
        "access-control-allow-origin":
          route.request().headers()["origin"] ?? "*",
        "access-control-allow-credentials": "true",
      },
      json: FOREVER_PREVIEW,
    });
  });
  return seen;
}

test.describe("WoW: Forever Armory import (ROK-1722)", () => {
  test("the Armory tab renders the realmless Forever identity block", async ({
    page,
  }) => {
    const form = await openForeverArmory(page);
    await expect(form.block).toBeVisible();
    await expect(form.ruleset).toBeVisible();
    await expect(form.first).toBeVisible();
    await expect(form.second).toBeVisible();
    await expect(form.region).toBeVisible();
    await expect(
      form.dialog.getByLabel("Realm", { exact: true }),
      "Forever has no realm",
    ).toHaveCount(0);
    await expect(
      form.dialog.getByPlaceholder("e.g. Arthas"),
      "the retail realm input is gone",
    ).toHaveCount(0);
    await expect(form.search).toBeVisible();
  });

  test("a one-word name is blocked before any preview request", async ({
    page,
  }) => {
    const requests = await mockPreview(page);
    const form = await openForeverArmory(page);
    await form.first.fill("Ana");
    await form.search.click();
    await expect(
      form.dialog.getByRole("alert").filter({ hasText: ONE_WORD_ERROR }),
    ).toBeVisible();
    await expect(
      form.dialog.getByTestId("preview-location"),
      "no preview card for a one-word name",
    ).toHaveCount(0);
    expect(
      requests,
      "a one-word name must not call the preview route",
    ).toHaveLength(0);
  });

  test('a two-part PvP lookup omits realm and shows "PvP (US)" on the preview card', async ({
    page,
  }) => {
    const requests = await mockPreview(page);
    const form = await openForeverArmory(page);
    await form.first.fill("Ana");
    await form.second.fill("Forever");
    await form.ruleset.getByText("PvP", { exact: true }).click();
    await expect(
      form.ruleset.getByRole("radio", { name: "PvP", exact: true }),
    ).toBeChecked();

    const sent = page.waitForRequest(
      (r) => isPreviewRequest(new URL(r.url())),
      { timeout: 15_000 },
    );
    await form.search.click();
    const url = new URL((await sent).url());
    expect(
      url.searchParams.has("realm"),
      "a realmless Forever lookup sends no realm param",
    ).toBe(false);
    expect(url.searchParams.get("name")).toBe("Ana Forever");
    expect(url.searchParams.get("gameVariant")).toBe("wow_forever");
    expect(url.searchParams.get("region")?.toLowerCase()).toBe("us");

    // exact text: "RP-PvP (US)" would substring-match "PvP (US)".
    await expect(form.dialog.getByTestId("preview-location")).toHaveText(
      "PvP (US)",
      { timeout: 15_000 },
    );
    await expect(
      form.dialog.getByRole("button", { name: "Save character" }),
    ).toBeVisible();
    expect(
      requests.length,
      "the mocked route answered the lookup",
    ).toBeGreaterThan(0);
  });
});
