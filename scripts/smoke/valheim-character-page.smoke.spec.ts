/**
 * ROK-1836 — the Valheim character page (`/valheim/characters/:id`), end to end.
 *
 * Seed: `POST /admin/test/valheim/armory-character` (DEMO_MODE, D8) resets one
 * keyed character on THIS worker's Valheim Pelican slot (`parallelIndex`), so
 * desktop and mobile never share a row: `c1` "Testviking" unclaimed, with the
 * item catalogue + atlas and the EAQS extra rows; `c2` "Shieldmaiden" claimed
 * by the invitee fixture user (an admin assignment). The page is opened by
 * deep link — the hub Characters tab needs the ROK-1831 seam (not on this base).
 *
 * Asserts: header (name, world, owner chip), the four sections (equipment
 * slots, skill meters, inventory grid with the "Equipment" / "Quick slots"
 * bands, trophies), an item tile's detail (popover ≥1024px, BottomSheet on
 * phones) with a new-tab wiki link, the claim flow (confirm → "Claimed", the
 * button gone, a history row), no Claim on another user's character, the
 * admin "Change owner" sheet with its history, and the not-found state.
 * Deterministic waits only (web-first assertions).
 */
import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./base";
import {
  API_BASE,
  apiPost,
  getAdminToken,
  getInviteeFixture,
} from "./api-helpers";
import { isDesktop } from "./helpers";

const FIXTURE = "/admin/test/valheim/armory-character";
const CLAIM = "Claim this character";

type SeedRequest = {
  slot: number;
  key: "c1" | "c2";
  withCatalog: boolean;
  extraRows?: boolean;
  claimedBy: number | null;
};

/** Install-or-activate through the admin plugin API (pelican-quick-play-switch pattern). */
async function ensurePluginActive(
  token: string,
  pluginId: string,
): Promise<void> {
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
      `failed to enable the ${pluginId} plugin: install ${install.status}, activate ${activate.status}`,
    );
}

async function seedCharacter(token: string, req: SeedRequest): Promise<number> {
  const body = (await apiPost(token, FIXTURE, req)) as {
    characterId?: unknown;
  } | null;
  expect(
    body?.characterId,
    `armory-character seed (${req.key}) failed: ${JSON.stringify(body)}`,
  ).toEqual(expect.any(Number));
  return typeof body?.characterId === "number" ? body.characterId : -1;
}

/** Seeds c1 (unclaimed, catalogue, EAQS) and c2 (claimed by the invitee) on this worker's slot. */
async function seedBoth(slot: number): Promise<{ c1: number; c2: number }> {
  const token = await getAdminToken();
  await ensurePluginActive(token, "pelican");
  await ensurePluginActive(token, "valheim");
  const invitee = await getInviteeFixture();
  const c1 = await seedCharacter(token, {
    slot,
    key: "c1",
    withCatalog: true,
    extraRows: true,
    claimedBy: null,
  });
  const c2 = await seedCharacter(token, {
    slot,
    key: "c2",
    withCatalog: true,
    claimedBy: invitee.userId,
  });
  return { c1, c2 };
}

/** The page header — the `<header>` holding the character's h1. */
function characterHeader(page: Page, name: string): Locator {
  return page.locator("header", {
    has: page.getByRole("heading", { level: 1, name }),
  });
}

async function assertSections(page: Page): Promise<void> {
  const equipment = page.getByRole("region", { name: "Equipment" });
  await expect(equipment.getByLabel("Equipment slots")).toBeVisible();
  await expect(
    equipment.getByRole("button", { name: /^Iron sword/ }),
  ).toBeVisible();

  const skills = page.getByRole("region", { name: "Skills" });
  await expect(skills.getByText("Swords", { exact: true })).toBeVisible();
  await expect(skills.getByRole("meter")).toHaveCount(3);

  const grid = page
    .getByRole("region", { name: "Inventory" })
    .getByRole("grid", { name: "Inventory" });
  await expect(grid).toBeVisible();
  await expect(
    grid.getByRole("rowgroup", { name: "Equipment" }),
  ).toBeAttached();
  await expect(
    grid.getByRole("rowgroup", { name: "Quick slots" }),
  ).toBeAttached();
  await expect(grid.getByRole("button", { name: /^Wood, 50$/ })).toBeAttached();

  await expect(
    page
      .getByRole("region", { name: "Trophies" })
      .getByLabel("Trophies", { exact: true }),
  ).toBeVisible();
}

/** Opens the Wood tile's detail: popover at ≥1024px, BottomSheet below. Checks the wiki link, then closes. */
async function assertItemDetail(page: Page, wide: boolean): Promise<void> {
  const grid = page.getByRole("grid", { name: "Inventory" });
  const tile = grid.getByRole("button", { name: /^Wood, 50$/ });
  await tile.scrollIntoViewIfNeeded();
  await tile.click();
  await expect(tile).toHaveAttribute("aria-expanded", "true");
  const detail = wide
    ? page.getByTestId("valheim-item-popover")
    : page.getByRole("dialog", { name: "Wood" });
  await expect(detail).toBeVisible();
  await expect(detail.getByRole("heading", { name: "Wood" })).toBeVisible();
  const wiki = detail.getByRole("link", { name: "Open on the Valheim wiki" });
  await expect(wiki).toHaveAttribute("target", "_blank");
  await expect(wiki).toHaveAttribute("rel", /noopener/);
  await expect(wiki).toHaveAttribute("href", /weirdgloop\.org\/w\/Wood$/);
  if (wide) await page.keyboard.press("Escape");
  else await detail.getByRole("button", { name: "Close" }).click();
  await expect(detail).toBeHidden();
}

async function claim(page: Page, header: Locator): Promise<void> {
  await header.getByRole("button", { name: CLAIM }).click();
  const confirm = page.getByRole("dialog", { name: "Claim character" });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText("Claim Testviking as yours?");
  await page.getByRole("button", { name: "Claim", exact: true }).click();
  await expect(confirm).toBeHidden();
  await expect(header.getByText("Claimed", { exact: true })).toBeVisible();
  await expect(header.getByText("Unclaimed", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: CLAIM })).toHaveCount(0);
}

/** Opens the admin "Change owner" dialog/sheet and returns it. */
async function openChangeOwner(page: Page, header: Locator): Promise<Locator> {
  await header.getByRole("button", { name: "Change owner" }).click();
  const dialog = page.getByRole("dialog", { name: "Change owner" });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("heading", { name: "Claim history" }),
  ).toBeVisible();
  return dialog;
}

test.describe("Valheim character page (ROK-1836)", () => {
  test("renders the sheet, opens an item, claims, and gates owner actions", async ({
    page,
  }, testInfo) => {
    const { c1, c2 } = await seedBoth(testInfo.parallelIndex);
    const wide = isDesktop(testInfo);

    // c1: header, sections, item detail.
    await page.goto(`/valheim/characters/${c1}`);
    const h1 = characterHeader(page, "Testviking");
    await expect(h1).toBeVisible({ timeout: 15_000 });
    await expect(h1).toContainText("World Fixtureheim");
    await expect(h1.getByText("Unclaimed", { exact: true })).toBeVisible();
    await assertSections(page);
    await assertItemDetail(page, wide);

    // Claim flow, then the claim shows in the admin history.
    await claim(page, h1);
    const sheet = await openChangeOwner(page, h1);
    const history = sheet.getByRole("list", { name: "Claim history" });
    await expect(
      history.getByText("Claimed by a member").first(),
    ).toBeVisible();
    await sheet
      .getByRole("button", {
        name: wide ? "Close modal" : "Close",
        exact: true,
      })
      .click();
    await expect(sheet).toBeHidden();

    // c2: claimed by someone else — no Claim; the admin can still change the owner.
    await page.goto(`/valheim/characters/${c2}`);
    const h2 = characterHeader(page, "Shieldmaiden");
    await expect(h2).toBeVisible({ timeout: 15_000 });
    await expect(
      h2.getByText("Assigned by an admin", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: CLAIM })).toHaveCount(0);
    await openChangeOwner(page, h2);
  });

  test("an unknown character id shows the not-found state", async ({
    page,
  }) => {
    await page.goto("/valheim/characters/999999999");
    await expect(
      page.getByText("This character doesn't exist or was removed.", {
        exact: false,
      }),
    ).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("region", { name: "Equipment" })).toHaveCount(
      0,
    );
  });
});
