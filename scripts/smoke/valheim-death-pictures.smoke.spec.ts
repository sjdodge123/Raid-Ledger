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
 */
import type { Page, TestInfo } from "@playwright/test";
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

interface DeathsBody {
  players: {
    name: string;
    pictures?: { mediaId: number }[];
    pictureCount?: number;
  }[];
}

async function seed(
  testInfo: TestInfo,
): Promise<{ f: Fixture; newest: number }> {
  const f = await seedDeathsFixture(testInfo.parallelIndex);
  const token = await getAdminToken();
  const res = (await apiPost(token, "/admin/test/valheim/death-pictures", {
    worker: testInfo.parallelIndex,
    count: PICTURES,
  })) as { mediaIds?: number[] };
  const newest = res.mediaIds?.[0];
  if (newest === undefined) {
    throw new Error(
      `death-pictures seed returned no mediaIds: ${JSON.stringify(res)}`,
    );
  }
  await pollForCondition(
    async () => {
      const body = (await apiGet(
        token,
        `/plugins/valheim/armory/servers/${f.serverId}/deaths`,
      )) as DeathsBody | null;
      const bar = body?.players.find((p) => p.name === f.characters.top.name);
      return bar?.pictures?.[0]?.mediaId === newest ? bar : null;
    },
    { description: "death pictures on the top bar", timeoutMs: 15_000 },
  );
  return { f, newest };
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
