/**
 * ROK-1933 Part 1 + ROK-2153 S4 — "claim your character" on a Valheim server hub.
 *
 * Seed: `POST /admin/test/valheim/claim-drive-fixture { worker }` (DEMO_MODE,
 * ROK-1933 L6a) resets THIS worker's own server hub to three characters — one
 * claimed by a fresh user A, two unclaimed (one named exactly like fresh user
 * B's display name) — and returns fresh, onboarded users A and B. Every test
 * seeds again, so B (and B's server-side dismissals, keyed per user per hub)
 * never leak between tests.
 *
 * Overview (`/hubs/:id`): the CORE claim prompt (`web/src/components/hub/claim/`,
 * testid `hub-claim-prompt`), fed by `GET /guilds/:id/claim`. B's exact-name
 * match is the one strong candidate, so the prompt offers "Claim <name>" in one
 * click plus "Not me? Pick another" (the list: Modal ≥1024px, BottomSheet
 * below; both role=dialog "Pick your character"). Its dismiss is server-side
 * (`POST /guilds/onboarding/claim-character/dismiss?guildId=`), permanent.
 *
 * Characters (`#characters`): the Valheim banner (region "Claim your
 * character", fed by `…/claim-status`), unchanged by S4. Both carry the same
 * landmark name, so the Overview uses the testid and the Characters tab the
 * region; the core prompt renders only in the Overview grid.
 */
import type { Browser, Page, Response, TestInfo } from "@playwright/test";
import { test, expect } from "./base";
import {
  API_BASE,
  apiGet,
  apiPost,
  getAdminToken,
  pollForCondition,
} from "./api-helpers";
import { signInAsAdmin, signInContextAs } from "./browser-session";
import { expectHubTabReachable } from "./hub-tabs";

const FIXTURE = "/admin/test/valheim/claim-drive-fixture";
const BANNER = "Claim your character";
const CLAIM_KEY = "claim-character";
/** `HUB_CLAIM_TEXT` in `hub-claim-copy.ts`. */
const TEXT = {
  notMe: "Not me? Pick another",
  dismiss: "Dismiss: don't show this again",
  listTitle: "Pick your character",
  cta: "Pick my character",
  claimNamed: (name: string) => `Claim ${name}`,
};

interface Fixture {
  serverId: number;
  guildId: number;
  users: { a: { id: number }; b: { id: number; displayName: string } };
  characters: Record<
    "claimed" | "matching" | "other",
    { id: number; name: string }
  >;
}

interface ClaimStatus {
  viewerHasClaim?: unknown;
  candidates?: Array<{ id?: unknown }>;
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
const prompt = (page: Page) => page.getByTestId("hub-claim-prompt");
const path = (r: Response) => new URL(r.url()).pathname;

/** A GET whose path ends with `suffix` answered 200. Register BEFORE the navigation. */
function answered(page: Page, suffix: string): Promise<void> {
  return page
    .waitForResponse(
      (r) => r.request().method() === "GET" && path(r).endsWith(suffix),
      { timeout: 15_000 },
    )
    .then((r) => {
      expect(r.status(), `GET …${suffix} answered ${r.status()}`).toBe(200);
    });
}

/**
 * Full load of the Overview. The core prompt renders nothing until the
 * viewer's onboarding state is in (and, when not dismissed, `GET …/claim`),
 * so an absence check is only meaningful after those answers: pass
 * `claim: true` when the viewer has NOT dismissed (the claim GET then fires).
 */
async function openOverview(
  page: Page,
  f: Fixture,
  opts: { claim: boolean },
): Promise<void> {
  const waits = [answered(page, "/guilds/onboarding")];
  if (opts.claim) waits.push(answered(page, `/guilds/${f.guildId}/claim`));
  await page.goto(`/hubs/${f.guildId}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
    timeout: 15_000,
  });
  await Promise.all(waits);
}

/**
 * Every `GET /guilds/:id/claim` `page` makes from now on. The core prompt only
 * asks for claim status while its onboarding key is NOT dismissed
 * (`useHubClaim(guildId, prompt.visible)` in hub-claim-prompt.tsx), so an
 * empty list after a settled load proves the web honoured the dismissal.
 */
function recordClaimGets(page: Page, f: Fixture): string[] {
  const gets: string[] = [];
  page.on("request", (r) => {
    if (
      r.method() === "GET" &&
      new URL(r.url()).pathname.endsWith(`/guilds/${f.guildId}/claim`)
    )
      gets.push(r.url());
  });
  return gets;
}

/** Sign `page` in as `userId`, open the Overview, return the boot access JWT. */
async function bootOnOverview(
  page: Page,
  f: Fixture,
  userId: number,
  opts: { claim: boolean },
): Promise<string> {
  await signInContextAs(page.context(), userId);
  const refresh = page.waitForResponse(
    (r) => r.request().method() === "POST" && path(r).endsWith("/auth/refresh"),
    { timeout: 15_000 },
  );
  // Awaited together: a slow boot fails on its first real error, not on an
  // orphaned refresh rejection that cuts the h1 wait short ("Test ended").
  const [res] = await Promise.all([refresh, openOverview(page, f, opts)]);
  const body = (await res.json().catch(() => null)) as {
    access_token?: unknown;
  } | null;
  const jwt = body?.access_token;
  if (res.status() !== 200 || typeof jwt !== "string")
    throw new Error(`boot /auth/refresh for user ${userId} → ${res.status()}`);
  return jwt;
}

/** `settled`: wait for claim-status too (only on a full load). */
async function openCharacters(
  page: Page,
  f: Fixture,
  settled = false,
): Promise<void> {
  const status = settled ? answered(page, "/claim-status") : null;
  await page.goto(`/hubs/${f.guildId}#characters`);
  await expect(
    page.getByRole("link", { name: `Open ${f.characters.claimed.name}` }),
  ).toBeVisible({ timeout: 15_000 });
  await status;
}

/** Click `button` and require its claim POST for `candidateId` to succeed. */
async function claimVia(
  page: Page,
  f: Fixture,
  candidateId: number,
  click: () => Promise<void>,
): Promise<void> {
  const post = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      path(r).endsWith(`/guilds/${f.guildId}/claim/${candidateId}`),
    { timeout: 15_000 },
  );
  await click();
  const res = await post;
  expect(res.status(), `claim POST answered ${res.status()}`).toBeLessThan(300);
}

/** Poll `GET /guilds/:id/claim` as the viewer until it reports `claimedId` taken by them. */
async function expectClaimed(
  jwt: string,
  f: Fixture,
  claimedId: number,
  stillUnclaimed: number,
): Promise<void> {
  const status = await pollForCondition(
    async () => {
      const s = (await apiGet(
        jwt,
        `/guilds/${f.guildId}/claim`,
      )) as ClaimStatus | null;
      const ids = (s?.candidates ?? []).map((c) => String(c.id));
      return s?.viewerHasClaim === true && !ids.includes(String(claimedId))
        ? { ids }
        : null;
    },
    { description: `viewer claimed ${claimedId} on hub ${f.guildId}` },
  );
  expect(status.ids, "the other character stays unclaimed").toEqual([
    String(stillUnclaimed),
  ]);
}

/** A brand-new browser context (no cookies, no storage) signed in as `userId`. */
async function freshPageAs(
  browser: Browser,
  page: Page,
  testInfo: TestInfo,
  userId: number,
): Promise<Page> {
  const baseURL = testInfo.project.use.baseURL;
  const ctx = await browser.newContext({
    ...(baseURL === undefined ? {} : { baseURL }),
    viewport: page.viewportSize(),
    storageState: { cookies: [], origins: [] },
  });
  await signInContextAs(ctx, userId);
  return ctx.newPage();
}

test.describe("Valheim hub — claim prompt (ROK-1933, ROK-2153 S4)", () => {
  // The first navigation on a freshly spun env pays the cold start (assets,
  // first API paths) — once per worker, outside the asserted boot budget.
  test.beforeAll(async ({ browser }, testInfo) => {
    // Hook budget only (CI's 30 s test timeout would cut the 45 s wait short).
    test.setTimeout(60_000);
    const baseURL = testInfo.project.use.baseURL;
    const ctx = await browser.newContext({
      ...(baseURL === undefined ? {} : { baseURL }),
      storageState: { cookies: [], origins: [] },
    });
    await signInAsAdmin(ctx);
    const page = await ctx.newPage();
    const refresh = page.waitForResponse(
      (r) => r.request().method() === "POST" && path(r).endsWith("/auth/refresh"),
      { timeout: 45_000 },
    );
    const [boot] = await Promise.all([refresh, page.goto("/")]);
    expect(boot.status(), "warm-up boot refresh").toBe(200);
    await ctx.close();
  });

  test("B sees the suggested match and claims it in one click", async ({
    page,
  }, testInfo) => {
    const f = await seed(testInfo.parallelIndex);
    const jwt = await bootOnOverview(page, f, f.users.b.id, { claim: true });
    const { matching, other } = f.characters;

    await expect(prompt(page)).toHaveCount(1);
    const suggested = prompt(page).getByTestId("hub-claim-suggested");
    await expect(suggested).toContainText(matching.name);
    // A strong match replaces the list-opening cta with the one-click claim.
    await expect(
      prompt(page).getByRole("button", { name: TEXT.cta }),
    ).toHaveCount(0);
    await claimVia(page, f, matching.id, () =>
      suggested
        .getByRole("button", {
          name: TEXT.claimNamed(matching.name),
          exact: true,
        })
        .click(),
    );
    await expectClaimed(jwt, f, matching.id, other.id);
    await expect(prompt(page)).toHaveCount(0);

    await openOverview(page, f, { claim: true });
    await expect(prompt(page)).toHaveCount(0);
    // The Characters tab stays reachable from the Overview — in the row, or
    // (phone, ROK-1876) folded into the More menu.
    await expectHubTabReachable(page, /Characters/, "characters");
    await openCharacters(page, f, true);
    await expect(banner(page)).toHaveCount(0);
  });

  test("Not me? Pick another opens the list and claims the picked character", async ({
    page,
  }, testInfo) => {
    const f = await seed(testInfo.parallelIndex);
    const jwt = await bootOnOverview(page, f, f.users.b.id, { claim: true });
    const { matching, other } = f.characters;

    await prompt(page).getByRole("button", { name: TEXT.notMe }).click();
    const list = page.getByRole("dialog", { name: TEXT.listTitle });
    await expect(list).toBeVisible();
    const rows = list.getByTestId("hub-claim-candidates").getByRole("listitem");
    await expect(rows).toHaveCount(2);
    await expect(list).toContainText(matching.name);
    await claimVia(page, f, other.id, () =>
      list
        .getByRole("button", { name: TEXT.claimNamed(other.name), exact: true })
        .click(),
    );
    await expect(list).toBeHidden();
    await expectClaimed(jwt, f, other.id, matching.id);
    await expect(prompt(page)).toHaveCount(0);
  });

  test("a dismiss is server-side: gone after a reload and in a fresh browser", async ({
    page,
    browser,
  }, testInfo) => {
    const f = await seed(testInfo.parallelIndex);
    const jwt = await bootOnOverview(page, f, f.users.b.id, { claim: true });

    const dismissed = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        path(r).endsWith(`/guilds/onboarding/${CLAIM_KEY}/dismiss`) &&
        new URL(r.url()).searchParams.get("guildId") === String(f.guildId),
      { timeout: 15_000 },
    );
    await prompt(page).getByRole("button", { name: TEXT.dismiss }).click();
    const res = await dismissed;
    expect(res.status(), `dismiss POST answered ${res.status()}`).toBeLessThan(
      300,
    );
    await expect(prompt(page)).toHaveCount(0);
    await pollForCondition(
      async () => {
        const s = (await apiGet(jwt, "/guilds/onboarding")) as {
          dismissed?: Array<{ key?: unknown; guildId?: unknown }>;
        } | null;
        const hit = (s?.dismissed ?? []).find(
          (d) => d.key === CLAIM_KEY && d.guildId === f.guildId,
        );
        return hit ?? null;
      },
      { description: `claim-character dismissal stored for hub ${f.guildId}` },
    );

    const reloadClaimGets = recordClaimGets(page, f);
    await openOverview(page, f, { claim: false });
    await expect(prompt(page)).toHaveCount(0);

    const fresh = await freshPageAs(browser, page, testInfo, f.users.b.id);
    try {
      const freshClaimGets = recordClaimGets(fresh, f);
      await openOverview(fresh, f, { claim: false });
      await expect(prompt(fresh)).toHaveCount(0);
      // The Characters tab banner is Valheim's own and ignores the core dismiss.
      await openCharacters(fresh, f, true);
      await expect(banner(fresh)).toHaveCount(1);
      // Settled: both Overviews had their onboarding state well before this
      // second full load, and an undismissed prompt asks for claim status on
      // the very render that state lands. None asked, so the dismissal held.
      expect(
        freshClaimGets,
        "a dismissed prompt never fetches claim status (fresh browser)",
      ).toEqual([]);
      expect(
        reloadClaimGets,
        "a dismissed prompt never fetches claim status (reload)",
      ).toEqual([]);
    } finally {
      await fresh.context().close();
    }
  });

  test("Characters tab: the banner's Pick filters to unclaimed; a sheet claim hides both", async ({
    page,
  }, testInfo) => {
    const f = await seed(testInfo.parallelIndex);
    await signInContextAs(page.context(), f.users.b.id);

    await openCharacters(page, f, true);
    await expect(banner(page)).toHaveCount(1);
    // The Characters banner is not dismissable (only the Overview prompt is).
    await expect(
      banner(page).getByRole("button", { name: /Dismiss/ }),
    ).toHaveCount(0);
    await banner(page).getByRole("button", { name: TEXT.cta }).click();
    await expect(page).toHaveURL(/[?&]unclaimed=1.*#characters$/);
    const filter = page.getByRole("button", { name: "Unclaimed only" });
    await expect(filter).toHaveAttribute("aria-pressed", "true");
    const rows = page.getByRole("link", { name: /^Open / });
    await expect(rows).toHaveCount(2);

    // B1: toggling the filter keeps the hub on the Characters tab.
    await filter.click();
    await expect(filter).toHaveAttribute("aria-pressed", "false");
    await expect(page).toHaveURL(/#characters$/);
    await expect(rows).toHaveCount(3);
    await filter.click();
    await expect(filter).toHaveAttribute("aria-pressed", "true");
    await expect(rows).toHaveCount(2);

    await claimFromSheet(page, f);
    await openCharacters(page, f, true);
    await expect(banner(page)).toHaveCount(0);
    await openOverview(page, f, { claim: true });
    await expect(prompt(page)).toHaveCount(0);
  });

  test("A, who has a claim, sees neither the prompt nor the banner", async ({
    page,
  }, testInfo) => {
    const f = await seed(testInfo.parallelIndex);
    await bootOnOverview(page, f, f.users.a.id, { claim: true });
    await expect(prompt(page)).toHaveCount(0);

    await openCharacters(page, f, true);
    await expect(
      page.getByRole("button", { name: "Unclaimed only" }),
    ).toBeVisible();
    await expect(banner(page)).toHaveCount(0);
  });
});

/** B claims the matching character from its sheet (the armory's own claim flow). */
async function claimFromSheet(page: Page, f: Fixture): Promise<void> {
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
