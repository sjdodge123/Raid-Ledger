/**
 * ROK-1941 (Q1 = A, D14) — the Valheim hub Deaths card's per-player picture
 * strip, desktop AND mobile projects.
 *
 * Seed: the ROK-1930 `POST /admin/test/valheim/deaths-fixture { worker }` gives
 * THIS worker its server hub (member + non-member visitor); then
 * `POST /admin/test/valheim/death-pictures { worker, count }` (DEMO_MODE,
 * ROK-1941) links `count` fresh death
 * pictures (authorName = the character's name) to the `top` character's
 * deaths and answers `{ mediaIds }` newest first. The Deaths read is polled until the bar carries them before the
 * browser opens. Waits are response- or expect-driven only.
 *
 * ROK-2027: the same seed with `{ secondCount, screenshot }` also gives the
 * `second` character its own death pictures and adds one non-death picture
 * (so the Gallery draws its kind chips); "+N" on a bar opens the Gallery
 * scoped to that player, and Remove on the chip returns to every death.
 */
import type { Page, Response, TestInfo } from "@playwright/test";
import { test, expect } from "./base";
import {
  apiGet,
  apiPost,
  getAdminToken,
  pollForCondition,
} from "./api-helpers";
import { signInContextAs } from "./browser-session";
import {
  type Fixture,
  responseTo,
  seedDeathsFixture,
} from "./valheim-pin-filter-helpers";

const PICTURES = 5;
/** ROK-2027: the `second` character's pictures (3 thumbs + "+1"). */
const SECOND_PICTURES = 4;

interface SeedBody {
  mediaIds?: number[];
  secondCharacterName?: string;
  secondMediaIds?: number[];
}

interface DeathsBody {
  players: {
    name: string;
    pictures?: { mediaId: number }[];
    pictureCount?: number;
  }[];
}

async function seed(
  testInfo: TestInfo,
  extra: { secondCount?: number; screenshot?: boolean } = {},
): Promise<{ f: Fixture; newest: number; res: SeedBody }> {
  const f = await seedDeathsFixture(testInfo.parallelIndex);
  const token = await getAdminToken();
  const res = (await apiPost(token, "/admin/test/valheim/death-pictures", {
    worker: testInfo.parallelIndex,
    count: PICTURES,
    ...extra,
  })) as SeedBody;
  const newest = res.mediaIds?.[0];
  if (newest === undefined) {
    throw new Error(
      `death-pictures seed returned no mediaIds: ${JSON.stringify(res)}`,
    );
  }
  const secondNewest = res.secondMediaIds?.[0];
  await pollForCondition(
    async () => {
      const body = (await apiGet(
        token,
        `/plugins/valheim/armory/servers/${f.serverId}/deaths`,
      )) as DeathsBody | null;
      const bar = body?.players.find((p) => p.name === f.characters.top.name);
      const other = body?.players.find(
        (p) => p.name === f.characters.second.name,
      );
      const secondReady =
        secondNewest === undefined ||
        other?.pictures?.[0]?.mediaId === secondNewest;
      return bar?.pictures?.[0]?.mediaId === newest && secondReady ? bar : null;
    },
    { description: "death pictures on the seeded bars", timeoutMs: 15_000 },
  );
  return { f, newest, res };
}

/** The Gallery list read scoped to a subject (`?subject=` set). */
function scopedMediaRead(page: Page, guildId: number): Promise<Response> {
  return page.waitForResponse(
    (r) => {
      const url = new URL(r.url());
      if (!url.pathname.endsWith(`/hubs/${guildId}/media`)) return false;
      return url.searchParams.has("subject");
    },
    { timeout: 15_000 },
  );
}

const strip = (page: Page, name: string) =>
  page.getByRole("group", { name: `${name}'s death pictures` });

async function openOverview(page: Page, f: Fixture): Promise<void> {
  const deaths = responseTo(page, `/servers/${f.serverId}/deaths`);
  await page.goto(`/hubs/${f.guildId}`);
  expect((await deaths).status()).toBe(200);
}

test.describe("Valheim hub — Deaths card picture strip (ROK-1941)", () => {
  test('member: 3 thumbs + "+2" outside the row link; a thumb opens the viewer at it, +N the Deaths grid', async ({
    page,
  }, testInfo) => {
    const { f, newest } = await seed(testInfo);
    const { top } = f.characters;
    await signInContextAs(page.context(), f.users.member.id);
    await openOverview(page, f);

    const group = strip(page, top.name);
    await expect(group.getByTestId("valheim-death-thumb")).toHaveCount(3, {
      timeout: 15_000,
    });
    const more = group.getByRole("button", {
      name: `${PICTURES - 3} more death pictures. Open the gallery`,
    });
    await expect(more).toHaveText(`+${PICTURES - 3}`);
    // Neither row link (ROK-2029: name + map) ever contains a thumb (Q1 = A).
    for (const link of [
      page.getByRole("link", { name: `Open ${top.name}'s character page` }),
      page.getByRole("link", {
        name: new RegExp(`^Show ${top.name}'s \\d+ deaths on the map$`),
      }),
    ]) {
      await expect(link).toHaveCount(1);
      await expect(link.getByRole("button")).toHaveCount(0);
    }

    const media = responseTo(page, `/hubs/${f.guildId}/media`);
    await group.getByTestId("valheim-death-thumb").first().click();
    expect((await media).status()).toBe(200);
    const dialog = page.getByRole("dialog", { name: "Gallery" });
    // Chips draw only when the hub has 2+ kinds, so the Deaths filter is proven by the caption (and the unit spec).
    await expect(dialog.getByTestId("hub-gallery-viewer")).toBeVisible();
    // Opened AT the clicked (newest) picture, not index 0 of some other list.
    await expect(dialog.getByTestId("hub-gallery-viewer")).toHaveAttribute(
      "data-media-id",
      String(newest),
    );
    await expect(dialog.getByTestId("hub-gallery-caption")).toContainText(
      "Death",
    );
    await expect(dialog.getByTestId("hub-gallery-caption")).toContainText(
      top.name,
    );
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(
      group.getByTestId("valheim-death-thumb").first(),
    ).toBeFocused();

    await more.click();
    const tiles = dialog.getByTestId("hub-gallery-tile");
    await expect(tiles.first()).toBeVisible();
    await expect(
      dialog.locator(
        '[data-testid="hub-gallery-tile"]:not([data-kind="death"])',
      ),
    ).toHaveCount(0);
  });

  test('ROK-2027: "+N" scopes the Gallery to that player; Remove returns to every death', async ({
    page,
  }, testInfo) => {
    const { f, res } = await seed(testInfo, {
      secondCount: SECOND_PICTURES,
      screenshot: true,
    });
    const { top, second } = f.characters;
    // The fixture's second character must be the bar we drive.
    expect(res.secondCharacterName).toBe(second.name);
    expect(res.secondMediaIds).toHaveLength(SECOND_PICTURES);
    await signInContextAs(page.context(), f.users.member.id);
    await openOverview(page, f);

    const group = strip(page, second.name);
    await expect(group.getByTestId("valheim-death-thumb")).toHaveCount(3, {
      timeout: 15_000,
    });
    const more = group.getByTestId("valheim-death-thumbs-more");
    await expect(more).toHaveText(`+${SECOND_PICTURES - 3}`);

    const scoped = scopedMediaRead(page, f.guildId);
    await more.click();
    const scopedRes = await scoped;
    expect(scopedRes.status()).toBe(200);
    expect(new URL(scopedRes.url()).searchParams.get("subject")).toMatch(
      /^valheim-death:/,
    );
    const dialog = page.getByRole("dialog", { name: "Gallery" });
    const chip = dialog.getByTestId("hub-gallery-subject-chip");
    await expect(chip).toContainText(`${second.name}'s deaths`);
    // A subject replaces the kind chips.
    await expect(dialog.getByTestId("hub-gallery-chip-death")).toHaveCount(0);
    await expect(
      dialog.getByText(`${SECOND_PICTURES} pictures`, { exact: true }),
    ).toBeVisible();
    const tiles = dialog.getByTestId("hub-gallery-tile");
    await expect(tiles).toHaveCount(SECOND_PICTURES);
    // Every tile is the second player's death; none is the top player's.
    for (const label of await tiles.evaluateAll((els) =>
      els.map((el) => el.getAttribute("aria-label") ?? ""),
    )) {
      expect(label).toMatch(new RegExp(`^Death — ${second.name},`));
    }
    await expect(
      dialog.locator(
        '[data-testid="hub-gallery-tile"]:not([data-kind="death"])',
      ),
    ).toHaveCount(0);

    // The unscoped Deaths list may already be cached, so no response wait here.
    await dialog
      .getByRole("button", { name: `Remove ${second.name}'s deaths` })
      .click();
    await expect(chip).toHaveCount(0);
    await expect(dialog.getByTestId("hub-gallery-chip-death")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const total = PICTURES + SECOND_PICTURES;
    await expect(
      dialog.getByText(`${total} pictures`, { exact: true }),
    ).toBeVisible();
    await expect(tiles).toHaveCount(total);
    // Back to the Deaths filter: both players' deaths, never the screenshot.
    await expect(
      dialog.locator(
        '[data-testid="hub-gallery-tile"]:not([data-kind="death"])',
      ),
    ).toHaveCount(0);
    for (const name of [top.name, second.name]) {
      await expect(
        dialog.getByRole("button", { name: new RegExp(`^Death — ${name},`) }),
      ).not.toHaveCount(0);
    }
  });

  test("visitor: no Deaths card, so no strip", async ({ page }, testInfo) => {
    const { f } = await seed(testInfo);
    await signInContextAs(page.context(), f.users.visitor.id);
    const hubRead = responseTo(page, `/guilds/${f.guildId}`);
    await page.goto(`/hubs/${f.guildId}`);
    expect((await hubRead).status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByRole("list", { name: "Deaths by player" }),
    ).toHaveCount(0);
    await expect(page.getByTestId("valheim-death-thumb")).toHaveCount(0);
  });
});
