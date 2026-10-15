/**
 * ROK-1740: the Join post card on /admin/settings/discord/features — render
 * and the 422 missing-permission state, at desktop and mobile viewports.
 *
 * CI has no connected Discord bot, and the Features page renders its cards only
 * when the bot is connected, so the API is route-mocked (as the community
 * insights smoke does): the real responses keep their headers (CORS) and get
 * swapped bodies. The POST is answered with the API's 422 shape; the real
 * post / re-post / delete-then-re-post flow is the companion bot smoke
 * (`tools/test-bot/src/smoke/tests/join-post.test.ts`).
 */
import { test, expect } from "./base";

const BOT_STATUS = /\/admin\/settings\/discord-bot$/;
const CHANNELS = /\/admin\/settings\/discord-bot\/channels$/;
const JOIN_POST = /\/admin\/settings\/discord-bot\/join-post$/;
const MISSING = ["Embed Links", "Pin Messages"];

test.describe("Admin Discord — Join post card (ROK-1740)", () => {
  test.beforeEach(async ({ page }) => {
    await page.route(
      (url) => BOT_STATUS.test(url.pathname),
      async (route) => {
        const response = await route.fetch();
        const real = (await response.json().catch(() => ({}))) as Record<
          string,
          unknown
        >;
        await route.fulfill({
          response,
          status: 200,
          json: { ...real, connected: true },
        });
      },
    );
    await page.route(
      (url) => CHANNELS.test(url.pathname),
      async (route) => {
        const response = await route.fetch();
        await route.fulfill({
          response,
          status: 200,
          json: [
            { id: "smoke-c1", name: "welcome" },
            { id: "smoke-c2", name: "general" },
          ],
        });
      },
    );
    await page.route(
      (url) => JOIN_POST.test(url.pathname),
      async (route) => {
        const method = route.request().method();
        if (method === "OPTIONS") {
          await route.continue();
          return;
        }
        if (method === "GET") {
          const response = await route.fetch();
          await route.fulfill({
            response,
            status: 200,
            json: { channelId: null, messageId: null },
          });
          return;
        }
        // Never let a POST/DELETE reach the API: answer with the 422 body shape.
        await route.fulfill({
          status: 422,
          // Not route.fetch(): a POST must never reach an env whose bot IS
          // connected. Echo the origin so the cross-origin read is allowed.
          headers: {
            "access-control-allow-origin":
              route.request().headers()["origin"] ?? "*",
            "access-control-allow-credentials": "true",
          },
          json: {
            message:
              "The bot can't post in #welcome. Missing: Embed Links, Pin Messages.",
            missing: MISSING,
          },
        });
      },
    );
  });

  test("renders the card with nothing posted", async ({ page }) => {
    await page.goto("/admin/settings/discord/features");
    const card = page.getByTestId("join-post-section");
    await expect(card.getByRole("heading", { name: "Join post" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(card.getByTestId("join-post-status")).toHaveText(
      "Not posted yet.",
    );
    await expect(
      card.getByRole("button", { name: "Post", exact: true }),
    ).toBeDisabled();
    await expect(card.getByRole("button", { name: "Remove" })).toBeDisabled();
  });

  test("a 422 lists the missing permissions inline", async ({ page }) => {
    await page.goto("/admin/settings/discord/features");
    const card = page.getByTestId("join-post-section");
    await card
      .getByRole("combobox", { name: "Channel" })
      .selectOption("smoke-c1", { timeout: 15_000 });
    await card.getByRole("button", { name: "Post", exact: true }).click();
    const banner = card.getByTestId("join-post-missing");
    await expect(banner).toContainText(
      "The bot can't post here. Missing in #welcome:",
    );
    await expect(banner.getByRole("listitem")).toHaveText(MISSING);
  });
});
