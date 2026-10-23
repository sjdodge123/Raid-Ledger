/**
 * ROK-1933 Part 1 — the "claim your character" banner on a Valheim server hub.
 *
 * Seed: `POST /admin/test/valheim/claim-drive-fixture { worker }` (DEMO_MODE,
 * ROK-1933 L6a) resets THIS worker's own server hub to three characters — one
 * claimed by a fresh user A, two unclaimed (one named exactly like fresh user
 * B's display name) — and returns fresh, onboarded users A and B. Every test
 * seeds again, so B (and the browser's dismiss memory, keyed per server, in a
 * fresh context per test) never leak between tests.
 *
 * B has no Steam link, so the banner is the "link-steam" variant (heading
 * "Playing on <server>?"); the assertions use the region name, which both
 * variants share. Overview = `/hubs/:id`, Characters = `#characters`.
 */
import type { Page } from "@playwright/test";
import { test, expect } from "./base";
import { API_BASE, apiPost, getAdminToken } from "./api-helpers";
import { signInContextAs } from "./browser-session";

const FIXTURE = "/admin/test/valheim/claim-drive-fixture";
const BANNER = "Claim your character";

interface Fixture {
  serverId: number;
  guildId: number;
  users: { a: { id: number }; b: { id: number; displayName: string } };
  characters: Record<
    "claimed" | "matching" | "other",
    { id: number; name: string }
  >;
}

/** Install-or-activate through the admin plugin API (valheim-map-tab pattern). */
async function ensurePluginActive(
  token: string,
  pluginId: string,
): Promise<void> {
  const init = {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
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
      `failed to enable ${pluginId}: install ${install.status}, activate ${activate.status}`,
    );
}

async function seed(worker: number): Promise<Fixture> {
  const token = await getAdminToken();
  await ensurePluginActive(token, "pelican");
  await ensurePluginActive(token, "valheim");
  const body = (await apiPost(token, FIXTURE, { worker })) as Partial<Fixture>;
  expect(
    body.guildId,
    `claim-drive fixture seed failed: ${JSON.stringify(body)}`,
  ).toEqual(expect.any(Number));
  return body as Fixture;
}

const banner = (page: Page) => page.getByRole("region", { name: BANNER });

/**
 * The banner renders nothing while `GET …/claim-status` is pending, so an
 * absence check is only meaningful once that response is in. Register BEFORE
 * the navigation that triggers it (a full load — not a hash-only goto, which
 * is same-document and refetches nothing).
 */
function claimStatusAnswered(page: Page): Promise<void> {
  return page
    .waitForResponse(
      (r) => new URL(r.url()).pathname.endsWith("/claim-status"),
      {
        timeout: 15_000,
      },
    )
    .then((r) => {
      expect(r.status(), `claim-status answered ${r.status()}`).toBe(200);
    });
}

async function openOverview(page: Page, f: Fixture): Promise<void> {
  const status = claimStatusAnswered(page);
  await page.goto(`/hubs/${f.guildId}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
    timeout: 15_000,
  });
  await status;
}

/** `settled`: wait for claim-status too (only on a full load — see above). */
async function openCharacters(
  page: Page,
  f: Fixture,
  settled = false,
): Promise<void> {
  const status = settled ? claimStatusAnswered(page) : null;
  await page.goto(`/hubs/${f.guildId}#characters`);
  await expect(
    page.getByRole("link", { name: `Open ${f.characters.claimed.name}` }),
  ).toBeVisible({ timeout: 15_000 });
  await status;
}

/** B claims the matching character from its sheet (the existing claim flow). */
async function claimMatching(page: Page, f: Fixture): Promise<void> {
  const name = f.characters.matching.name;
  await page.getByRole("link", { name: `Open ${name}` }).click();
  const header = page.locator("header", {
    has: page.getByRole("heading", { level: 1, name }),
  });
  await header.getByRole("button", { name: "Claim this character" }).click();
  const confirm = page.getByRole("dialog", { name: "Claim character" });
  await expect(confirm).toContainText(`Claim ${name} as yours?`);
  await confirm.getByRole("button", { name: "Claim", exact: true }).click();
  await expect(confirm).toBeHidden();
  await expect(header.getByText("Claimed", { exact: true })).toBeVisible();
}

test.describe("Valheim hub — claim banner (ROK-1933)", () => {
  test("B sees the banner, filters to unclaimed, claims, and the banner is gone", async ({
    page,
  }, testInfo) => {
    const f = await seed(testInfo.parallelIndex);
    await signInContextAs(page.context(), f.users.b.id);

    await openOverview(page, f);
    await expect(banner(page)).toHaveCount(1);
    // M3: the Overview's Pick jumps to the Characters tab, already filtered.
    await banner(page)
      .getByRole("button", { name: "Pick my character" })
      .click();
    await expect(page).toHaveURL(/[?&]unclaimed=1.*#characters$/);
    const filter = page.getByRole("button", { name: "Unclaimed only" });
    await expect(filter).toHaveAttribute("aria-pressed", "true");
    const rows = page.getByRole("link", { name: /^Open / });
    await expect(rows).toHaveCount(2);
    await expect(banner(page)).toHaveCount(1);
    await expect(
      page.getByRole("link", { name: `Open ${f.characters.matching.name}` }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: `Open ${f.characters.other.name}` }),
    ).toBeVisible();

    // B1: toggling the filter keeps the hub on the Characters tab.
    await filter.click();
    await expect(filter).toHaveAttribute("aria-pressed", "false");
    await expect(page).toHaveURL(/#characters$/);
    await expect(rows).toHaveCount(3);
    await filter.click();
    await expect(filter).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveURL(/[?&]unclaimed=1.*#characters$/);
    await expect(rows).toHaveCount(2);

    await claimMatching(page, f);
    await openCharacters(page, f, true);
    await expect(banner(page)).toHaveCount(0);
    await openOverview(page, f);
    await expect(
      page.getByRole("link", { name: /Characters/ }).first(),
    ).toBeVisible();
    await expect(banner(page)).toHaveCount(0);
  });

  test("an Overview dismiss survives a reload; the Characters tab ignores it", async ({
    page,
  }, testInfo) => {
    const f = await seed(testInfo.parallelIndex);
    await signInContextAs(page.context(), f.users.b.id);

    await openOverview(page, f);
    await banner(page).getByRole("button", { name: "Dismiss" }).click();
    await expect(banner(page)).toHaveCount(0);
    const status = claimStatusAnswered(page);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 15_000,
    });
    await status;
    await expect(banner(page)).toHaveCount(0);

    await openCharacters(page, f);
    await expect(banner(page)).toHaveCount(1);
    await expect(
      banner(page).getByRole("button", { name: "Dismiss" }),
    ).toHaveCount(0);
  });

  test("A, who has a claim, sees no banner", async ({ page }, testInfo) => {
    const f = await seed(testInfo.parallelIndex);
    await signInContextAs(page.context(), f.users.a.id);

    await openCharacters(page, f, true);
    await expect(
      page.getByRole("button", { name: "Unclaimed only" }),
    ).toBeVisible();
    await expect(banner(page)).toHaveCount(0);
    await openOverview(page, f);
    await expect(banner(page)).toHaveCount(0);
  });
});
