/**
 * ROK-2149 — an unclaimed roster member opens the character page read-only at
 * `/hubs/<id>/members/<memberId>`:
 *
 * 1. A guild member clicks an unlinked row's name in the Members table and
 *    lands on the member page — name, "Roster member" pill, rank facts, and no
 *    owner/admin control (no "More actions", no Change owner / Unlink; the only
 *    header button is the plugin's claim CTA).
 * 2. A non-member opens the join gate's claim list, follows the candidate's
 *    name (desktop/tablet) or its phone-only "View" button (mobile) to the
 *    member page in claim mode (`?from=claim`): no roster facts, the confirm
 *    copy "This is my character — claim it" + Back; claiming lands on
 *    `/characters/<id>`.
 * 3. (ROK-2155) Whole-row click: clicking a Members row's BODY (the phone
 *    card's meta line, or the desktop Rank cell — never the name link) opens
 *    the claimed row's `/characters/<id>` and the unclaimed row's member
 *    page; on phones the meta line also fits (professions on their own line).
 *
 * Fixture: `POST /admin/test/wow/seed-guild` (ROK-1785; Forever by default)
 * per test, with a per-project, per-worker, per-run name AND a random
 * `rosterSuffix` (ROK-2132), so every seed owns its roster names and a claim in
 * one project never hides another project's row. `member` owns Dainel (a hub
 * member), `outsider` has no character (the non-member), `unlinkedMemberIds`
 * are the owner-less rows. The claimed character is admin-unlinked and the
 * seeded users deleted in `finally`.
 */
import type { Locator, Page, TestInfo } from "@playwright/test";
import { test, expect } from "./base";
import { apiDelete, apiGet, apiPost, getAdminToken } from "./api-helpers";
import { signInOnboardedMember } from "./browser-session";

const CLAIM_PATH = /\/plugins\/wow\/roster-claim\/members\/\d+\/claim$/;
const CONFIRM_LABEL = "This is my character — claim it";
const MORE_ACTIONS = /^More( actions for .+)?$/;

interface SeedUser {
  userId: number;
  username: string;
}
interface SeededGuild {
  guildId: number;
  gameId: number;
  name: string;
  users: Record<"outsider" | "member" | "gm" | "officer", SeedUser>;
  unlinkedMemberIds: number[];
}
interface Candidate {
  memberId: number;
  name: string;
}
interface CandidateGuild {
  guildId: number;
  candidates: Candidate[];
}

function must<T>(value: T | undefined | null, label: string): T {
  if (value === undefined || value === null)
    throw new Error(`[wow-roster-member-page] missing ${label}`);
  return value;
}

function guildName(testInfo: TestInfo): string {
  return `Member ${testInfo.project.name} w${testInfo.workerIndex} ${Date.now()}`;
}

/** Six random letters: this seed's roster names are its own (see header). */
function rosterSuffix(): string {
  return Array.from({ length: 6 }, () =>
    String.fromCharCode(97 + Math.floor(Math.random() * 26)),
  ).join("");
}

async function seedGuild(
  token: string,
  testInfo: TestInfo,
  extra: Record<string, unknown> = {},
): Promise<SeededGuild> {
  const body = (await apiPost(token, "/admin/test/wow/seed-guild", {
    name: guildName(testInfo),
    rosterSuffix: rosterSuffix(),
    ...extra,
  })) as Partial<SeededGuild> | null;
  if (
    typeof body?.guildId !== "number" ||
    typeof body.gameId !== "number" ||
    !body.users ||
    !Array.isArray(body.unlinkedMemberIds)
  ) {
    throw new Error(
      `[wow-roster-member-page] seed-guild: ${JSON.stringify(body)}`,
    );
  }
  return {
    guildId: body.guildId,
    gameId: body.gameId,
    name: must(body.name, "name"),
    users: body.users,
    unlinkedMemberIds: body.unlinkedMemberIds,
  };
}

/** The first owner-less row, with the (suffixed) name the API lists for it. */
async function firstUnlinkedRow(
  token: string,
  guild: SeededGuild,
): Promise<Candidate> {
  const memberId = must(guild.unlinkedMemberIds[0], "unlinked member id");
  const body = (await apiGet(
    token,
    `/plugins/wow/roster-claim/candidates?gameId=${guild.gameId}`,
  )) as { guilds?: CandidateGuild[] } | null;
  const row = body?.guilds
    ?.find((g) => g.guildId === guild.guildId)
    ?.candidates.find((c) => c.memberId === memberId);
  return must(row, `candidate ${memberId} in guild ${guild.guildId}`);
}

async function cleanup(
  token: string,
  guild: SeededGuild,
  characterId: string | null,
): Promise<void> {
  if (characterId)
    await apiPost(
      token,
      `/admin/plugins/wow/characters/${characterId}/unlink`,
      {},
    ).catch(() => undefined);
  for (const user of Object.values(guild.users)) {
    await apiDelete(token, `/users/${user.userId}`).catch(() => undefined);
  }
}

/** Below Tailwind's `sm` (640px) the claim list shows "View" and the header uses its phone layout. */
function isNarrow(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1280) < 640;
}

function memberUrl(
  guild: SeededGuild,
  row: Candidate,
  fromClaim: boolean,
): RegExp {
  return new RegExp(
    `/hubs/${guild.guildId}/members/${row.memberId}${fromClaim ? "\\?from=claim" : ""}$`,
  );
}

/** The read-only page's shared facts: the name as the page heading and the "Roster member" pill. */
async function expectMemberPage(page: Page, row: Candidate): Promise<Locator> {
  await expect(
    page.getByRole("heading", { name: row.name, level: 1 }),
    "the member page names the roster character",
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("roster-member-pill")).toHaveText(
    "Roster member",
  );
  return page.getByTestId("character-header-actions");
}

/**
 * The snapshot member's Armory sections + the roster's last-online fact. The
 * "No Armory data" note also carries an "Equipment" heading, so the Talents
 * heading + the note's absence are what prove the snapshot rendered.
 */
async function expectArmorySections(page: Page): Promise<void> {
  await expect(
    page.getByTestId("roster-member-facts"),
    "the roster's own last-online renders as last seen",
  ).toContainText("Last seen yesterday");
  await expect(
    page.getByRole("heading", { name: "Talents", level: 2 }),
    "a verified snapshot shows the Talents panel",
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByRole("heading", { name: "Equipment", level: 2 }),
  ).toBeVisible();
  await expect(
    page.getByTestId("roster-member-no-armory"),
    "no 'No Armory data' note on the snapshot member",
  ).toHaveCount(0);
}

/** AC: no owner/admin control on the read-only page — only the plugin's claim CTA sits in the action row. */
async function expectNoOwnerOrAdminControls(
  page: Page,
  actions: Locator,
): Promise<void> {
  await expect(
    page.getByRole("button", { name: MORE_ACTIONS }),
    "no admin ⋯ / More menu on a roster member",
  ).toHaveCount(0);
  await expect(
    page.getByRole("menuitem", { name: "Change owner" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("menuitem", { name: "Unlink character" }),
  ).toHaveCount(0);
  await expect(
    actions
      .getByRole("button")
      .filter({ hasNotText: /claim/i })
      .filter({ hasNotText: /^Back$/ }),
    "every header button is the claim CTA or its confirm-step Back, never an owner action",
  ).toHaveCount(0);
}

/** Pick my character → the claim list; follow the row's name (≥ sm) or its phone-only View button. */
async function openFromClaimList(
  page: Page,
  guild: SeededGuild,
  row: Candidate,
): Promise<void> {
  await page.goto(`/hubs/${guild.guildId}`);
  const gate = page.getByTestId("wow-join-gate");
  await expect(gate, "a non-member sees the join gate").toBeVisible({
    timeout: 20_000,
  });
  await gate
    .getByRole("button", { name: "Pick my character", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Add Character" });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  const nameLink = dialog
    .getByTestId("roster-claim-name-link")
    .filter({ hasText: row.name });
  const view = dialog.getByRole("link", {
    name: `View ${row.name}`,
    exact: true,
  });
  await expect(
    nameLink,
    "the candidate name is a link to its member page",
  ).toBeVisible({ timeout: 15_000 });
  if (isNarrow(page)) {
    await expect(view, "phones get a View button").toBeVisible();
    await view.click();
  } else {
    await expect(view, "View is phone-only").toBeHidden();
    await nameLink.click();
  }
  await expect(page).toHaveURL(memberUrl(guild, row, true), {
    timeout: 15_000,
  });
  await expect(dialog, "the Add Character modal closes on navigate").toBeHidden(
    { timeout: 15_000 },
  );
}

/** Clicks the confirm CTA; returns the created character id. */
async function confirmClaim(page: Page, row: Candidate): Promise<string> {
  const response = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      CLAIM_PATH.test(new URL(r.url()).pathname),
    { timeout: 20_000 },
  );
  await page
    .getByTestId("roster-member-claim")
    .getByRole("button", { name: CONFIRM_LABEL, exact: true })
    .click();
  const res = await response;
  const body = (await res.json().catch(() => null)) as { id?: unknown } | null;
  expect(res.status(), `claim of member ${row.memberId}`).toBe(201);
  if (typeof body?.id !== "string")
    throw new Error(
      `claim response has no character id: ${JSON.stringify(body)}`,
    );
  return body.id;
}

/**
 * ROK-2155 — the point to click on a Members row that is NOT its name link: the
 * phone card's meta line (rank · class · role), or the desktop table's Rank
 * cell. Returned relative to the row so `row.click` keeps Playwright's
 * hit-target check (the stretched link is the row's own descendant).
 */
async function rowBodyPoint(
  row: Locator,
  cards: boolean,
): Promise<{ x: number; y: number }> {
  const target = cards
    ? row.getByTestId("guild-member-card-meta")
    : row.locator("td").nth(2);
  const rowBox = must(await row.boundingBox(), "row box");
  const box = must(await target.boundingBox(), "row body box");
  const name = must(
    await row.getByRole("link").first().boundingBox(),
    "name link box",
  );
  const point = {
    x: box.x + box.width / 2 - rowBox.x,
    y: box.y + box.height / 2 - rowBox.y,
  };
  const onName =
    rowBox.x + point.x >= name.x &&
    rowBox.x + point.x <= name.x + name.width &&
    rowBox.y + point.y >= name.y &&
    rowBox.y + point.y <= name.y + name.height;
  expect(onName, "the body click point must sit outside the name link").toBe(
    false,
  );
  return point;
}

/** Opens the hub's Members tab; true when the phone/tablet card shell renders (not the table). */
async function openMembers(page: Page, guild: SeededGuild): Promise<boolean> {
  await page.goto(`/hubs/${guild.guildId}#members`);
  await expect(page.getByTestId("guild-members")).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page.getByTestId("guild-member-row").filter({ visible: true }).first(),
  ).toBeVisible({ timeout: 15_000 });
  return page.getByTestId("guild-members-cards").isVisible();
}

/** AC (phone): the card's meta line fits — nothing pushed past its right edge. */
async function expectMetaLineFits(row: Locator): Promise<void> {
  const meta = row.getByTestId("guild-member-card-meta");
  const overflow = await meta.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(
    overflow,
    "the phone card's meta line is not squashed (scrollWidth − clientWidth)",
  ).toBeLessThanOrEqual(1);
  await expect(
    row.getByTestId("guild-member-card-own-line"),
    "professions get their own third card line",
  ).toHaveCount(1);
}

/** Click the row body (not the name) and expect the name link's own href. */
async function clickRowBody(
  page: Page,
  row: Locator,
  link: Locator,
  cards: boolean,
  href: RegExp,
): Promise<void> {
  await expect(link).toHaveAttribute("href", href, { timeout: 15_000 });
  const position = await rowBodyPoint(row, cards);
  await row.click({ position });
  await expect(
    page,
    "clicking the row body (not the name link) opens the row's page",
  ).toHaveURL(href, { timeout: 15_000 });
}

test.describe("WoW: Forever — read-only roster member page (ROK-2149)", () => {
  test("a guild member opens an unlinked Members row and sees it read-only", async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const token = await getAdminToken();
    // ROK-2149: the first unlinked row carries a verified Armory snapshot.
    const guild = await seedGuild(token, testInfo, {
      withArmorySnapshots: true,
    });
    try {
      const row = await firstUnlinkedRow(token, guild);
      await signInOnboardedMember(page, guild.users.member.userId);
      await page.goto(`/hubs/${guild.guildId}#members`);
      await expect(page.getByTestId("guild-members")).toBeVisible({
        timeout: 15_000,
      });
      const link = page
        .getByTestId("guild-member-roster-link")
        .filter({ hasText: row.name });
      await expect(
        link,
        "an unlinked row name links to its member page",
      ).toHaveAttribute(
        "href",
        `/hubs/${guild.guildId}/members/${row.memberId}`,
        { timeout: 15_000 },
      );
      await link.click();
      await expect(page).toHaveURL(memberUrl(guild, row, false), {
        timeout: 15_000,
      });
      const actions = await expectMemberPage(page, row);
      await expect(
        page.getByTestId("roster-member-facts"),
        "hub members see the roster facts",
      ).toContainText("Rank:");
      await expectArmorySections(page);
      await expectNoOwnerOrAdminControls(page, actions);
      await expect(
        actions.getByRole("button", { name: CONFIRM_LABEL }),
        "the confirm copy is for ?from=claim only",
      ).toHaveCount(0);
    } finally {
      await cleanup(token, guild, null);
    }
  });

  test("a non-member opens a claim candidate as the confirm step and claims it", async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const token = await getAdminToken();
    const guild = await seedGuild(token, testInfo);
    let characterId: string | null = null;
    try {
      const row = await firstUnlinkedRow(token, guild);
      await signInOnboardedMember(page, guild.users.outsider.userId);
      await openFromClaimList(page, guild, row);
      const actions = await expectMemberPage(page, row);
      await expect(
        page.getByTestId("roster-member-facts"),
        "a claim preview carries no roster-only facts",
      ).toHaveCount(0);
      await expectNoOwnerOrAdminControls(page, actions);
      const cta = page.getByTestId("roster-member-claim");
      await expect(
        cta.getByRole("button", { name: CONFIRM_LABEL, exact: true }),
      ).toBeVisible();
      await expect(
        cta.getByRole("button", { name: "Back", exact: true }),
        "the confirm step offers Back",
      ).toBeVisible();
      characterId = await confirmClaim(page, row);
      await expect(page, "a claim lands on the new character page").toHaveURL(
        new RegExp(`/characters/${characterId}$`),
        { timeout: 15_000 },
      );
      await expect(page.getByText(`${row.name} is now yours.`)).toBeVisible({
        timeout: 15_000,
      });
      await expect(
        page.getByTestId("roster-member-pill"),
        "the owned page is no longer the read-only roster page",
      ).toHaveCount(0);
    } finally {
      await cleanup(token, guild, characterId);
    }
  });
});

test.describe("WoW: Forever — Members rows open from anywhere (ROK-2155)", () => {
  test("clicking a Members row body opens the claimed character and the unclaimed roster member", async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const token = await getAdminToken();
    const guild = await seedGuild(token, testInfo);
    try {
      const unclaimed = await firstUnlinkedRow(token, guild);
      await signInOnboardedMember(page, guild.users.member.userId);
      const cards = await openMembers(page, guild);
      const rows = page
        .getByTestId("guild-member-row")
        .filter({ visible: true });
      // Claimed: the viewer's own row (`member` owns a linked main).
      const mine = rows.filter({ has: page.getByTestId("guild-member-you") });
      if (cards) await expectMetaLineFits(mine);
      await clickRowBody(
        page,
        mine,
        mine.getByTestId("guild-member-link"),
        cards,
        /\/characters\/[^/?#]+$/,
      );
      // Unclaimed: an owner-less roster row → its read-only member page.
      await openMembers(page, guild);
      const link = page
        .getByTestId("guild-member-roster-link")
        .filter({ hasText: unclaimed.name });
      const row = rows.filter({ has: link });
      await clickRowBody(
        page,
        row,
        link,
        cards,
        memberUrl(guild, unclaimed, false),
      );
      await expectMemberPage(page, unclaimed);
    } finally {
      await cleanup(token, guild, null);
    }
  });
});
