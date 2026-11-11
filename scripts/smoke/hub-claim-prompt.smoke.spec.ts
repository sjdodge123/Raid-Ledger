/**
 * ROK-2153 S7 — the CORE "claim your character" prompt (testid
 * `hub-claim-prompt`, fed by `GET /guilds/:id/claim`) end to end on a BG3
 * hub, plus the Valheim strong-match facts S4's own spec does not pin.
 * Desktop AND mobile.
 *
 * BG3 (S6): list only (N3), the ACTIVE campaign's unclaimed hero slots only
 * (N5), and a dismissal scoped to that campaign (N4: `dismissScope`
 * `campaign-<id>`, stored as `claim-character` + `scope`), so a NEW active
 * campaign asks again. Seed: `POST /admin/test/bg3/seed-hub` variant
 * `default` — active campaign "Tactician run" holding the golden Act 2 party
 * (4 heroes + 1 summon); `claimer` holds the Human Wizard, `member` holds
 * nothing. The tag is per project × worker, so parallel projects never share
 * a hub; re-seeding recreates the campaign, so every test gets a fresh
 * campaign id (and a fresh dismissal scope).
 *
 * Valheim (S4): `scripts/smoke/valheim-claim-banner.smoke.spec.ts` already
 * drives the one-click claim, "Not me", the permanent dismiss and the
 * Characters banner. This file only adds the S7 "best match first" facts.
 * Its seed + warm-up are copied, not imported: importing a spec file would
 * register that file's tests here too.
 *
 * Every write is confirmed through the api with `pollForCondition` before
 * the next step relies on it. No sleeps.
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
import { signInAsAdmin, signInOnboardedMember } from "./browser-session";
import { hubSeedTag } from "./hub-seed";

const CLAIM_KEY = "claim-character";
/** `HUB_CLAIM_TEXT` (hub-claim-copy.ts) + `BG3_HUB_CLAIM_COPY` (bg3-hub-claim-provider.ts). */
const TEXT = {
  cta: "Pick my character",
  listTitle: "Pick your character",
  dismiss: "Dismiss: don't show this again",
  suggestedLead: "Is this you?",
  notMe: "Not me? Pick another",
  claimNamed: (name: string) => `Claim ${name}`,
  bg3Heading: "Playing in this campaign?",
  bg3Body:
    "Pick the party character you play, so the Party card shows who plays whom.",
  bg3ShortBody: "Pick the party character you play.",
};
/** Tailwind `md` — the prompt shows `body` at ≥768px and `shortBody` below. */
const MD_WIDTH = 768;
const BG3_HEROES = 4;
const VALHEIM_FIXTURE = "/admin/test/valheim/claim-drive-fixture";

interface Candidate {
  id: string;
  name: string;
  match?: string | null;
}
interface ClaimStatus {
  viewerHasClaim?: boolean;
  unclaimedCount?: number;
  dismissScope?: string;
  candidates?: Candidate[];
}
interface Dismissal {
  key?: unknown;
  guildId?: unknown;
  scope?: unknown;
}
interface Bg3Seed {
  hubId: number;
  campaignId: number;
  campaignKey: string;
  users: Record<"host" | "member", { userId: number }>;
}

const prompt = (page: Page) => page.getByTestId("hub-claim-prompt");
const pathOf = (r: Response) => decodeURIComponent(new URL(r.url()).pathname);

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

async function seedBg3(testInfo: TestInfo): Promise<Bg3Seed> {
  const token = await getAdminToken();
  await ensurePluginActive(token, "bg3");
  const body = (await apiPost(token, "/admin/test/bg3/seed-hub", {
    tag: hubSeedTag("bg3claim", testInfo),
    variant: "default",
  })) as Partial<Bg3Seed> | null;
  if (
    typeof body?.hubId !== "number" ||
    typeof body.campaignId !== "number" ||
    typeof body.campaignKey !== "string" ||
    !body.users
  )
    throw new Error(`bg3 seed-hub: ${JSON.stringify(body)}`);
  return body as Bg3Seed;
}

/** A GET whose path ends with `suffix` answered 200. Register BEFORE the navigation. */
function answered(page: Page, suffix: string): Promise<void> {
  return page
    .waitForResponse(
      (r) => r.request().method() === "GET" && pathOf(r).endsWith(suffix),
      { timeout: 20_000 },
    )
    .then((r) => {
      expect(r.status(), `GET …${suffix} answered ${r.status()}`).toBe(200);
    });
}

/**
 * Full load of the Overview, settled: the onboarding state and the claim
 * status are both in. A scoped provider (BG3) asks for claim status even when
 * dismissed — it needs `dismissScope` to judge the dismissal — so both
 * answers always arrive and an absence check after this is meaningful.
 */
async function openOverview(page: Page, hubId: number): Promise<void> {
  const waits = [
    answered(page, "/guilds/onboarding"),
    answered(page, `/guilds/${hubId}/claim`),
  ];
  await page.goto(`/hubs/${hubId}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
    timeout: 20_000,
  });
  await Promise.all(waits);
}

async function claimStatus(jwt: string, hubId: number): Promise<ClaimStatus> {
  const s = (await apiGet(jwt, `/guilds/${hubId}/claim`)) as ClaimStatus | null;
  if (!s) throw new Error(`GET /guilds/${hubId}/claim returned nothing`);
  return s;
}

/** The viewer's stored `claim-character` dismissal for this hub + scope. */
function pollDismissal(
  jwt: string,
  hubId: number,
  scope: string,
): Promise<Dismissal> {
  return pollForCondition(
    async () => {
      const s = (await apiGet(jwt, "/guilds/onboarding")) as {
        dismissed?: Dismissal[];
      } | null;
      const hit = (s?.dismissed ?? []).find(
        (d) => d.key === CLAIM_KEY && d.guildId === hubId && d.scope === scope,
      );
      return hit ?? null;
    },
    { description: `claim-character dismissal ${scope} on hub ${hubId}` },
  );
}

/** The copy line this viewport shows (both are in the DOM; one is hidden). */
async function expectBg3Copy(page: Page): Promise<void> {
  const p = prompt(page);
  await expect(
    p.getByRole("heading", { name: TEXT.bg3Heading }),
    "BG3 heading",
  ).toBeVisible();
  const wide = (page.viewportSize()?.width ?? 0) >= MD_WIDTH;
  const shown = wide ? TEXT.bg3Body : TEXT.bg3ShortBody;
  await expect(p.getByText(shown, { exact: true }), "BG3 body copy").toBeVisible();
}

/** Host's access JWT, minted by a throwaway signed-in context. */
async function hostJwt(
  browser: Browser,
  testInfo: TestInfo,
  userId: number,
): Promise<string> {
  const baseURL = testInfo.project.use.baseURL;
  const ctx = await browser.newContext({
    ...(baseURL === undefined ? {} : { baseURL }),
    storageState: { cookies: [], origins: [] },
  });
  try {
    return await signInOnboardedMember(await ctx.newPage(), userId);
  } finally {
    await ctx.close();
  }
}

/**
 * Host starts a second campaign, moves the seeded saves (their one campaign
 * key) into it and makes it the hub's active campaign. Returns its id.
 */
async function switchToNewCampaign(jwt: string, seed: Bg3Seed): Promise<number> {
  const created = (await apiPost(
    jwt,
    `/plugins/bg3/hubs/${seed.hubId}/campaigns`,
    { name: "Second run" },
  )) as { id?: unknown } | null;
  const id = created?.id;
  if (typeof id !== "number")
    throw new Error(`create campaign: ${JSON.stringify(created)}`);
  await putOk(jwt, `/plugins/bg3/me/campaign-keys/${seed.campaignKey}`, {
    campaignId: id,
  });
  await putOk(jwt, `/plugins/bg3/hubs/${seed.hubId}/settings`, {
    activeCampaignId: id,
  });
  return id;
}

/** PUT that must succeed; the key bind answers 204 (no JSON), so read status only. */
async function putOk(
  jwt: string,
  path: string,
  body: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok)
    throw new Error(`PUT ${path} → ${res.status}: ${await res.text()}`);
}

// The first navigation on a freshly spun env pays the cold start (assets,
// first API paths) — once per worker, outside every asserted budget
// (valheim-claim-banner pattern).
test.beforeAll(async ({ browser }, testInfo) => {
  test.setTimeout(60_000);
  const baseURL = testInfo.project.use.baseURL;
  const ctx = await browser.newContext({
    ...(baseURL === undefined ? {} : { baseURL }),
    storageState: { cookies: [], origins: [] },
  });
  await signInAsAdmin(ctx);
  const page = await ctx.newPage();
  const refresh = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" && pathOf(r).endsWith("/auth/refresh"),
    { timeout: 45_000 },
  );
  const [boot] = await Promise.all([refresh, page.goto("/")]);
  expect(boot.status(), "warm-up boot refresh").toBe(200);
  await ctx.close();
});

test.describe("Hub claim prompt — BG3 (ROK-2153 S6/S7)", () => {
  test("a member with no party character picks one; the Party card names them", async ({
    page,
  }, testInfo) => {
    test.setTimeout(60_000);
    const seed = await seedBg3(testInfo);
    const jwt = await signInOnboardedMember(page, seed.users.member.userId);
    await openOverview(page, seed.hubId);

    await expect(prompt(page)).toHaveCount(1);
    await expectBg3Copy(page);
    const status = await claimStatus(jwt, seed.hubId);
    const candidates = status.candidates ?? [];
    expect(status.dismissScope, "BG3 scopes the dismissal per campaign").toBe(
      `campaign-${seed.campaignId}`,
    );
    // 4 heroes, the claimer's Human Wizard taken, the summon never offered.
    expect(candidates, "the active campaign's unclaimed heroes").toHaveLength(
      BG3_HEROES - 1,
    );
    for (const c of candidates)
      expect(c.id, "every candidate is in the active campaign").toMatch(
        new RegExp(`^${seed.campaignId}:`),
      );
    // N3: list only — no one-click suggestion on BG3.
    await expect(prompt(page).getByTestId("hub-claim-suggested")).toHaveCount(0);

    await prompt(page).getByRole("button", { name: TEXT.cta }).click();
    const list = page.getByRole("dialog", { name: TEXT.listTitle });
    await expect(list).toBeVisible();
    const rows = list.getByTestId("hub-claim-candidates").getByRole("listitem");
    await expect(rows).toHaveCount(candidates.length);
    for (const c of candidates) await expect(list).toContainText(c.name);

    const pick = candidates[0];
    if (!pick) throw new Error("no BG3 candidate to claim");
    const post = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        pathOf(r).endsWith(`/guilds/${seed.hubId}/claim/${pick.id}`),
      { timeout: 15_000 },
    );
    await list
      .getByRole("button", { name: TEXT.claimNamed(pick.name), exact: true })
      .click();
    const res = await post;
    expect(res.status(), `claim POST answered ${res.status()}`).toBeLessThan(300);
    await expect(list).toBeHidden();
    await pollForCondition(
      async () => {
        const s = await claimStatus(jwt, seed.hubId);
        return s.viewerHasClaim === true ? s : null;
      },
      { description: `member claimed ${pick.id}` },
    );
    await expect(prompt(page)).toHaveCount(0);

    // The Party card refetched (no reload): the picked slot now names the viewer.
    const tile = page
      .getByRole("list", { name: "Party", exact: true })
      .getByTestId("bg3-party-slot")
      .filter({ hasText: pick.name });
    await expect(tile.getByTestId("bg3-claim-control")).toContainText("You", {
      timeout: 15_000,
    });

    await openOverview(page, seed.hubId);
    await expect(prompt(page), "no prompt once the member has a claim").toHaveCount(0);
  });

  test("a dismissal holds for this campaign; a new active campaign asks again with its own slots", async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(90_000);
    const seed = await seedBg3(testInfo);
    const firstScope = `campaign-${seed.campaignId}`;
    const jwt = await signInOnboardedMember(page, seed.users.member.userId);
    await openOverview(page, seed.hubId);
    await expect(prompt(page)).toHaveCount(1);

    const dismissed = page.waitForResponse(
      (r) => {
        const q = new URL(r.url()).searchParams;
        return (
          r.request().method() === "POST" &&
          pathOf(r).endsWith(`/guilds/onboarding/${CLAIM_KEY}/dismiss`) &&
          q.get("guildId") === String(seed.hubId) &&
          q.get("scope") === firstScope
        );
      },
      { timeout: 15_000 },
    );
    await prompt(page).getByRole("button", { name: TEXT.dismiss }).click();
    const res = await dismissed;
    expect(res.status(), `dismiss POST answered ${res.status()}`).toBeLessThan(300);
    await expect(prompt(page)).toHaveCount(0);
    await pollDismissal(jwt, seed.hubId, firstScope);

    await openOverview(page, seed.hubId);
    await expect(prompt(page), "dismissed for this campaign after a reload").toHaveCount(0);

    const host = await hostJwt(browser, testInfo, seed.users.host.userId);
    const secondId = await switchToNewCampaign(host, seed);
    const status = await pollForCondition(
      async () => {
        const s = await claimStatus(jwt, seed.hubId);
        return s.dismissScope === `campaign-${secondId}` &&
          (s.candidates ?? []).length > 0
          ? s
          : null;
      },
      { description: `hub ${seed.hubId} reports campaign ${secondId} as active` },
    );
    const candidates = status.candidates ?? [];
    // N5: only the active campaign's slots. The claimer's Human Wizard claim
    // belongs to the first campaign, so all four heroes are open here.
    expect(candidates).toHaveLength(BG3_HEROES);
    for (const c of candidates) {
      expect(c.id, "offered from the new active campaign").toMatch(
        new RegExp(`^${secondId}:`),
      );
      expect(c.id, "never from the old campaign").not.toMatch(
        new RegExp(`^${seed.campaignId}:`),
      );
    }

    await openOverview(page, seed.hubId);
    await expect(prompt(page), "a new campaign re-shows the prompt").toHaveCount(1);
    await expectBg3Copy(page);
    await prompt(page).getByRole("button", { name: TEXT.cta }).click();
    const list = page.getByRole("dialog", { name: TEXT.listTitle });
    await expect(
      list.getByTestId("hub-claim-candidates").getByRole("listitem"),
    ).toHaveCount(candidates.length);
    for (const c of candidates)
      await expect(
        list.getByRole("button", { name: TEXT.claimNamed(c.name), exact: true }),
      ).toBeVisible();
  });
});

interface ValheimFixture {
  guildId: number;
  users: { b: { id: number } };
  characters: Record<"matching" | "other", { id: number; name: string }>;
}

test.describe("Hub claim prompt — Valheim strong match (ROK-2153 S7)", () => {
  test("the strong match is offered first, ahead of the list", async ({
    page,
  }, testInfo) => {
    test.setTimeout(60_000);
    const token = await getAdminToken();
    await ensurePluginActive(token, "pelican");
    await ensurePluginActive(token, "valheim");
    const f = (await apiPost(token, VALHEIM_FIXTURE, {
      worker: testInfo.parallelIndex,
    })) as Partial<ValheimFixture> | null;
    if (typeof f?.guildId !== "number" || !f.users || !f.characters)
      throw new Error(`claim-drive fixture: ${JSON.stringify(f)}`);
    const { guildId, users, characters } = f as ValheimFixture;

    const jwt = await signInOnboardedMember(page, users.b.id);
    const status = await claimStatus(jwt, guildId);
    const strong = (status.candidates ?? []).filter((c) => c.match === "strong");
    expect(
      strong.map((c) => String(c.id)),
      "exactly one strong match: B's same-name character",
    ).toEqual([String(characters.matching.id)]);
    expect(status.dismissScope, "Valheim's dismissal is not scoped").toBeUndefined();

    await openOverview(page, guildId);
    const p = prompt(page);
    await expect(p).toHaveCount(1);
    const suggested = p.getByTestId("hub-claim-suggested");
    await expect(suggested).toContainText(TEXT.suggestedLead);
    await expect(suggested).toContainText(characters.matching.name);
    await expect(suggested).not.toContainText(characters.other.name);
    // The match comes first; the full list sits behind "Not me".
    const notMe = p.getByRole("button", { name: TEXT.notMe });
    await expect(notMe).toBeVisible();
    const matchFirst = await suggested.evaluate(
      (s, btn) =>
        btn !== null &&
        (s.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
      await notMe.elementHandle(),
    );
    expect(matchFirst, "the suggestion renders before Not me").toBe(true);
    await expect(page.getByRole("dialog", { name: TEXT.listTitle })).toHaveCount(0);
  });
});
