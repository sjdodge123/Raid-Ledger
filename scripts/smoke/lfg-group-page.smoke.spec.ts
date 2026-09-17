/**
 * ROK-1464 / ROK-1573 / 1572 / 1571 — `/lfg/:gameSlug`, the LFG group page
 * (desktop + mobile).
 *
 * Drives the whole loop the page exists for:
 *   1 looking → +1 → 2 looking → ⋯ Manage → Withdraw → back to 1 →
 *   +1 → Start a scheduling poll (confirm: Cancel is a no-op, Start poll
 *   lands on the poll) with the viewer's intent converted.
 * Plus the approved hero (ONE `lfg-hero-primary`), the Participants chip, and
 * Lock in → the event-set hero with "Open the event".
 *
 * Two things are asserted through the API rather than the UI:
 *   • the intent count after each write — React Query's 15s `staleTime` will
 *     happily re-render a stale empty fetch (TESTING.md "When to poll the API"),
 *   • the post-convert intent state, which has no rendered surface (D9).
 *
 * ROK-1483 adds the mirrored-conversation block at the end. A real Discord
 * forum thread cannot be created from Playwright, so it is seeded through the
 * DEMO_MODE `POST /admin/test/thread-mirror` seam, which does the same two
 * writes the live board does: the open `lfg_group_messages` forum row that
 * makes the thread app-owned, and the mirror rows themselves.
 *
 * Overlap: the loop asserts the panel's DERIVED states (the needs-two message
 * at one member, the seven-day strip at two). The Lock-in case seeds real
 * windows through the production `PUT /users/me/game-time` for both users. */
import { test, expect } from "./base";
import type { Page } from "@playwright/test";
import {
  getAdminToken,
  apiGet,
  apiPost,
  apiDelete,
  apiPut,
  pollForCondition,
  API_BASE,
} from "./api-helpers";

const HOOK_TIMEOUT_MS = 90_000;
/** Attempts allowed for the (concurrency-unsafe) fixture-user seed. */
const SEED_ATTEMPTS = 3;

let adminToken: string;
let inviteeToken: string;
let gameId: number;
let gameSlug: string;

/**
 * Seed the smoke invitee and mint its JWT.
 *
 * `POST /admin/test/seed-fixture-user` is a SELECT-then-INSERT on a single
 * hard-coded `discord_id`, so the desktop and mobile projects — separate
 * worker processes, started together against ONE API — race it: the loser's
 * INSERT trips the unique constraint and the endpoint answers 500. Observed
 * as a first-attempt failure on mobile (`seed-fixture-user failed: 500`) that
 * passed on Playwright's retry.
 *
 * Retrying is a complete fix rather than a mask: the retry takes the SELECT
 * branch, because the winner's row is committed by the time the loser fails.
 * The endpoint takes no body, so the identity itself cannot be made
 * per-project from the spec (see the TECH-DEBT entry); nothing downstream
 * needs it to be, since LFG state is keyed by (user, GAME) and the two
 * projects already hold different games.
 */
async function seedInvitee(adminToken: string): Promise<string> {
  let lastDiagnostic = "";
  for (let attempt = 1; attempt <= SEED_ATTEMPTS; attempt++) {
    const res = await fetch(`${API_BASE}/admin/test/seed-fixture-user`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
    });
    if (res.ok) return ((await res.json()) as { jwt: string }).jwt;
    const body = await res.text().catch(() => "");
    lastDiagnostic = `${res.status} ${body.slice(0, 200)}`;
    // 4xx is a real misconfiguration (DEMO_MODE off, bad token) — retrying
    // it would only bury the message.
    if (res.status < 500) break;
  }
  throw new Error(
    `seed-fixture-user failed after ${SEED_ATTEMPTS} attempts: ${lastDiagnostic}`,
  );
}

/**
 * Catalogue games with usable slugs, in discover order. The page is
 * slug-addressed, so a game without one is not reachable.
 */
async function pickGames(
  token: string,
): Promise<Array<{ id: number; slug: string }>> {
  const discover = await apiGet(token, "/games/discover");
  const seen = new Set<number>();
  const games: Array<{ id: number; slug: string }> = [];
  for (const row of discover?.rows ?? []) {
    for (const game of row.games ?? []) {
      if (!game?.id || typeof game.slug !== "string" || !game.slug) continue;
      if (seen.has(game.id)) continue;
      seen.add(game.id);
      games.push({ id: game.id, slug: game.slug });
    }
  }
  return games;
}

/**
 * LFG state is keyed by (user, game) and both Playwright projects run
 * concurrently against ONE API with the SAME admin + invitee. Sharing a game
 * would make desktop and mobile withdraw and convert each other's intents
 * mid-assertion, so each project takes its own game out of the catalogue.
 */
const PROJECT_GAME_INDEX: Record<string, number> = { desktop: 0, mobile: 1 };

// ROK-1584: the tablet project renders the phone layout the mobile project
// already proves here, and LFG intents are keyed per (user, game) — a third
// concurrent project would need its own catalogue game, which CI's seed does
// not guarantee. Skip rather than fall back onto another project's game.
test.beforeAll(() => {
    test.skip(
        test.info().project.name === 'tablet',
        'LFG specs run on desktop + mobile only (the tablet project shares the phone layout)',
    );
});

/** Active LFG intent count for the game, straight from the API. */
async function activeCount(token: string): Promise<number> {
  const group = await apiGet(token, `/lfg/${gameId}`);
  return group?.activeCount ?? 0;
}

/**
 * Wait until the API agrees before asserting on a `useQuery`-backed panel.
 * Returns a diagnostic string rather than a bare `true` so a timeout prints
 * the last observed value instead of `(none)`.
 */
async function waitForCount(token: string, expected: number): Promise<string> {
  return pollForCondition(
    async () => {
      const count = await activeCount(token);
      return count === expected ? `activeCount=${count}` : null;
    },
    { timeoutMs: 15_000, description: `LFG activeCount === ${expected}` },
  );
}

/**
 * Load the group page fresh so it reflects the latest read. Waits on the top
 * bar — the one row every loaded state renders (the hero is absent while the
 * group is playing now).
 */
async function openGroupPage(page: Page): Promise<void> {
  await page.goto(`/lfg/${gameSlug}`);
  await expect(page.getByTestId("lfg-top-bar")).toBeVisible({
    timeout: 15_000,
  });
}

/** `+1 · I'm in` → "This week" (ROK-1479's urgency choice). */
async function joinThisWeek(page: Page): Promise<void> {
  await page.getByRole("button", { name: /I'm in/ }).click();
  await expect(page.getByTestId("lfg-urgency-choice")).toBeVisible({
    timeout: 15_000,
  });
  await page.getByTestId("lfg-urgency-week").click();
}

test.beforeAll(async ({}, testInfo) => {
  test.setTimeout(HOOK_TIMEOUT_MS);
  adminToken = await getAdminToken();
  inviteeToken = await seedInvitee(adminToken);
  const games = await pickGames(adminToken);
  const index = PROJECT_GAME_INDEX[testInfo.project.name] ?? 0;
  const game = games[index];
  if (!game) return;
  gameId = game.id;
  gameSlug = game.slug;
  // Start from a known-empty group regardless of what a previous run left.
  await apiDelete(adminToken, `/lfg/${gameId}`);
  await apiDelete(inviteeToken, `/lfg/${gameId}`);
});

test.afterAll(async () => {
  if (!gameId) return;
  await apiDelete(adminToken, `/lfg/${gameId}`);
  await apiDelete(inviteeToken, `/lfg/${gameId}`);
});

const SEEDED_GUILD_ID = "148300000000000777";
function seededIds(id: number): { threadId: string; messageId: string } {
  const suffix = String(id).padStart(6, "0");
  return {
    threadId: `1483000000000${suffix}`,
    messageId: `1484000000000${suffix}`,
  };
}
async function seedThreadMirror(
  body: Record<string, unknown>,
): Promise<{ guildId: string; mirrored: number; cleared: number }> {
  return apiPost(adminToken, "/admin/test/thread-mirror", body);
}

test('LFG → LFM → Manage withdraw, then the confirmed poll converts the group', async ({
    page,
}) => {
    test.skip(
        !gameSlug,
        'Catalogue has fewer slugged games than Playwright projects',
    );
    test.setTimeout(HOOK_TIMEOUT_MS);

    // Every create/convert write the poll confirm could fire. Cancel must add
    // NOTHING here (1572-AC2); only Start poll may.
    const pollWrites: string[] = [];
    page.on('request', (req) => {
        if (req.method() !== 'POST') return;
        if (/\/scheduling-polls(\?|$)|\/lfg\/\d+\/convert(\?|$)/.test(req.url())) {
            pollWrites.push(req.url());
        }
    });

    // ---- 1 looking: someone else raised a hand, the viewer has not ---------
    await apiPost(inviteeToken, '/lfg', { gameId });
    await waitForCount(adminToken, 1);
    await openGroupPage(page);

    const hero = page.getByTestId('lfg-hero');
    const primary = page.getByTestId('lfg-hero-primary');
    await expect(hero).toBeVisible({ timeout: 15_000 });
    await expect(hero.getByText(/^1 looking/)).toBeVisible();
    await expect(
        page.getByText('Overlap appears once two people are in'),
    ).toBeVisible();
    await expect(page.getByTestId('lfg-join-row')).toBeVisible();
    // One primary, gated on holding an intent (the same gate as before).
    await expect(primary).toHaveCount(1);
    await expect(primary).toHaveText('Start a scheduling poll');
    await expect(primary).toBeDisabled();
    await expect(page.getByTestId('lfg-start-poll-hint')).toHaveText(
        '+1 first — you have to be in the group to start its poll',
    );

    // ---- +1: the derived LFG → LFM transition -----------------------------
    // ROK-1479: the +1 opens the three-way urgency choice first; "This week"
    // keeps the pre-1479 14-day horizon every assertion below was written for.
    await joinThisWeek(page);
    await waitForCount(adminToken, 2);
    await expect(hero.getByText(/^2 looking/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('lfg-join-row')).toHaveCount(0);
    // (a) exactly ONE enabled "Start a scheduling poll" on the whole page —
    // the overlap rows no longer carry a poll button.
    await expect(primary).toHaveCount(1);
    await expect(primary).toBeEnabled();
    await expect(
        page.getByRole('button', { name: 'Start a scheduling poll' }),
    ).toHaveCount(1);
    await expect(page.getByRole('button', { name: /^Start poll$/ })).toHaveCount(0);
    await expect(page.getByTestId('lfg-start-poll-hint')).toHaveText(
        'Everyone looking gets a Discord card and a vote on times.',
    );
    // Two live members: the overlap panel now has a roster to project.
    await expect(page.getByTestId('lfg-overlap-day')).toHaveCount(7);

    // ---- (e) Participants chip → the list of both members ------------------
    const chip = page.getByTestId('lfg-participants-chip');
    await expect(chip).toContainText('Participants · 2');
    await chip.click();
    const list = page.getByTestId('lfg-participants-list');
    await expect(list).toBeVisible({ timeout: 15_000 });
    await expect(list.locator('li')).toHaveCount(2);
    await openGroupPage(page);

    // ---- (d) ⋯ Manage → Withdraw: straight back to a one-person group ------
    // No standalone Withdraw survives the redesign; it lives in Manage.
    await expect(page.getByRole('button', { name: 'Withdraw' })).toHaveCount(0);
    await page.getByTestId('lfg-manage').click();
    await expect(page.getByTestId('lfg-manage-body')).toBeVisible({
        timeout: 15_000,
    });
    await page.getByTestId('lfg-manage-withdraw').click();
    await waitForCount(adminToken, 1);
    await expect(page.getByTestId('lfg-manage-body')).toHaveCount(0, {
        timeout: 15_000,
    });
    await expect(page.getByTestId('lfg-join-row')).toBeVisible({
        timeout: 15_000,
    });
    await expect(hero.getByText(/^1 looking/)).toBeVisible();
    await expect(page.getByRole('button', { name: /I'm in/ })).toBeVisible();

    // ---- (b) poll confirm: Cancel is a no-op, Start poll converts ----------
    await joinThisWeek(page);
    await waitForCount(adminToken, 2);
    await expect(primary).toBeEnabled({ timeout: 15_000 });
    const lfgUrl = page.url();

    await primary.click();
    const confirm = page.getByTestId('lfg-poll-confirm');
    await expect(confirm).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('lfg-poll-confirm-member')).toHaveCount(2);
    await page.getByTestId('lfg-poll-confirm-cancel').click();
    await expect(confirm).toHaveCount(0);
    expect(page.url(), 'Cancel must not navigate').toBe(lfgUrl);
    expect(pollWrites, 'Cancel must not create or convert a poll').toEqual([]);
    expect(
        await activeCount(adminToken),
        'Cancel must leave both intents active',
    ).toBe(2);

    await primary.click();
    await expect(confirm).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('lfg-poll-confirm-submit').click();

    await expect(page).toHaveURL(/\/community-lineup\/\d+\/schedule\/\d+$/, {
        timeout: 30_000,
    });
    // AC6: the group no longer advertises itself once it has converted.
    await pollForCondition(
        async () => {
            const group = await apiGet(adminToken, `/lfg/${gameId}`);
            return group && group.ownIntent === null
                ? `ownIntent=null activeCount=${group.activeCount}`
                : null;
        },
        {
            timeoutMs: 20_000,
            description: 'viewer intent converted away',
        },
    );
});

test("the group page renders the mirrored Discord conversation, read-only", async ({
  page,
}) => {
  test.skip(
    !gameSlug,
    "Catalogue has fewer slugged games than Playwright projects",
  );
  test.setTimeout(HOOK_TIMEOUT_MS);

  const { threadId, messageId } = seededIds(gameId);
  const author = "Smoke Companion";
  const content = "mirrored reply the panel must render verbatim";
  const surface = {
    threadId,
    guildId: SEEDED_GUILD_ID,
    surfaceKind: "lfg-group",
    surfaceId: String(gameId),
  };

  try {
    // A live group, so the page renders the same shape a reader would see.
    await apiPost(inviteeToken, "/lfg", { gameId });
    await waitForCount(adminToken, 1);

    const seeded = await seedThreadMirror({
      ...surface,
      messages: [
        {
          messageId,
          authorDiscordId: "900000000000000042",
          authorDisplayName: author,
          content,
          // ROK-1506: one unicode reaction, routed through the production
          // reducer, so the panel has a pill to render (D15 / R1).
          reactions: [{ name: "🔥", count: 2 }],
        },
      ],
    });
    expect(
      seeded.mirrored,
      "the seam must have written exactly one mirror row",
    ).toBe(1);

    await page.goto(`/lfg/${gameSlug}`);
    const panel = page.getByTestId("lfg-conversation-panel");
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(panel).toContainText(content);
    await expect(panel).toContainText(author);

    // AC4: read-only BY CONSTRUCTION — there is no composer of any kind,
    // and there is no write route behind this panel to reach one.
    await expect(
      panel.locator("input, textarea, [contenteditable]"),
    ).toHaveCount(0);

    // ROK-1506 AC2: the seeded reaction renders as a read-only pill —
    // the emoji as text and the count beside it, nothing clickable.
    const pill = panel.getByTestId("thread-message-reaction");
    await expect(pill).toBeVisible();
    await expect(pill).toContainText("🔥");
    await expect(pill.getByTestId("thread-message-reaction-count")).toHaveText(
      "2",
    );
    await expect(pill.locator("button, a")).toHaveCount(0);

    // The deep link is the durable path to the conversation (A11).
    await expect(panel.getByTestId("thread-open-in-discord")).toHaveAttribute(
      "href",
      `https://discord.com/channels/${SEEDED_GUILD_ID}/${threadId}`,
    );

    // ---- Cleared: the panel stays mounted on its empty state ----------
    const cleared = await seedThreadMirror({ ...surface, messages: null });
    expect(cleared.cleared, "clearing must have removed the seeded row").toBe(
      1,
    );

    // A fresh load, not a wait: the viewer's query has a staleTime that
    // would happily re-render the page it already had.
    await page.goto(`/lfg/${gameSlug}`);
    await expect(page.getByTestId("lfg-conversation-panel")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("thread-empty")).toBeVisible({
      timeout: 15_000,
    });
  } finally {
    // Hand the game back exactly as it was found: a leftover open forum
    // row would collide with the next real LFM post for this game.
    await seedThreadMirror({ ...surface, messages: null, unbind: true });
    await apiDelete(inviteeToken, `/lfg/${gameId}`);
  }
});

test("an unknown slug renders the not-found state, not a blank page", async ({
  page,
}) => {
  await page.goto("/lfg/definitely-not-a-real-game-slug");

  await expect(page.getByTestId("lfg-not-found")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("lfg-hero")).toHaveCount(0);
  await expect(page.getByTestId("lfg-top-bar")).toHaveCount(0);
});

/**
 * ROK-1479 AC7 — the "Right now" strip (operator ruling A7).
 *
 * Runs in BOTH projects: unlike `lfg-chips.smoke.spec.ts`, this file takes a
 * per-project game out of the catalogue (`PROJECT_GAME_INDEX`), so desktop and
 * mobile mutate different rows and neither can pull the strip out from under
 * the other.
 *
 * Ordered after the loop above deliberately — that test leaves the group
 * CONVERTED, so the intents are cleared first and a fresh `now` intent is the
 * only live row on the game.
 */
test('the Right now strip lists the now-member with their remaining time', async ({
    page,
}) => {
    test.skip(
        !gameSlug,
        'Catalogue has fewer slugged games than Playwright projects',
    );
    test.setTimeout(HOOK_TIMEOUT_MS);

    await apiDelete(adminToken, `/lfg/${gameId}`);
    await apiDelete(inviteeToken, `/lfg/${gameId}`);
    // A13: the 60-minute horizon, so the chip still reads in minutes when the
    // slower project gets here rather than having lapsed out of the roster.
    await apiPost(inviteeToken, '/lfg', {
        gameId,
        urgency: 'now',
        ttlMinutes: 60,
    });

    // ROK-1156 staleTime rule: the API is the barrier before any UI read.
    const member = await pollForCondition(
        async () => {
            const group = (await apiGet(adminToken, `/lfg/${gameId}`)) as {
                members?: { urgency: string; expiresAt: string }[];
            } | null;
            return (
                group?.members?.find((m) => m.urgency === 'now') ?? null
            );
        },
        {
            timeoutMs: 20_000,
            description: `GET /lfg/${gameId} reports a member whose urgency is 'now'`,
        },
    );

    await openGroupPage(page);

    const strip = page.getByTestId('lfg-now-strip');
    await expect(strip).toBeVisible({ timeout: 15_000 });
    await expect(strip).toContainText('Right now');

    const chips = strip.getByTestId('lfg-now-chip');
    await expect(chips).toHaveCount(1);
    // `🔥 <name> · <N min left>` (`lfg-copy.ts::nowChip` + `expiresIn`). Under
    // two minutes the same helper switches to whole seconds, so both shapes
    // are accepted — a 60-minute seed will read minutes, but a slow project
    // must not turn a correct render into a failure.
    await expect(chips).toHaveText(/^🔥 .+ · (\d+ min left|\d+s left)$/);
    // The exact instant is on the element, so it is readable between ticks.
    await expect(chips).toHaveAttribute('datetime', member.expiresAt);

    // The weekly avatar row is untouched: the strip sits ABOVE it (A7), it
    // does not replace it.
    // Scoped to the Participants chip (ROK-1571, which replaced the status
    // bar's avatar row): `member-avatar-group` is a shared testid used by
    // scheduling surfaces too, and an unscoped lookup would be a strict-mode
    // hazard the moment this page grows a second roster.
    await expect(
        page
            .getByTestId('lfg-participants-chip')
            .getByTestId('member-avatar-group'),
    ).toBeVisible();
});

/**
 * ROK-1494 AC8 — the playing-now state (desktop + mobile).
 *
 * Two hands go up as "Right now · 1 hour" and the server spawns the ad-hoc
 * event, which CONVERTS both intents: `activeCount` falls back to 0 while the
 * group is actually mid-session. What the page must show at that instant is
 * the session — not the empty-group invitation, and not a scheduling-poll
 * primary offering to schedule a game already in voice.
 *
 * `ttlMinutes: 60` (never 30) so the slower project cannot arrive after the
 * intents lapsed; the seed is posted through the real `POST /lfg`, and the
 * ROK-1156 barrier is `GET /lfg/:gameId` reporting `playingNow` BEFORE any DOM
 * read — `useLfgGroupDetail` holds a 60 s `staleTime` and would otherwise
 * happily re-render the pre-spawn fetch.
 *
 * The spawn itself is Lane A's server work (`LfgNowSpawnService`). Until that
 * lands this case fails at the barrier below, naming `playingNow`; it is not
 * skipped, because a silently-skipped AC is indistinguishable from a passing
 * one.
 */
test('a spawned now-group shows the session and no poll primary', async ({
    page,
}) => {
    test.skip(
        !gameSlug,
        'Catalogue has fewer slugged games than Playwright projects',
    );
    test.setTimeout(HOOK_TIMEOUT_MS);

    await apiDelete(adminToken, `/lfg/${gameId}`);
    await apiDelete(inviteeToken, `/lfg/${gameId}`);

    // Two now-hands: the second is what takes the group to LFM and triggers
    // the spawn (AC1 — the host is the earliest hand, i.e. the invitee).
    await apiPost(inviteeToken, '/lfg', {
        gameId,
        urgency: 'now',
        ttlMinutes: 60,
    });
    await apiPost(adminToken, '/lfg', {
        gameId,
        urgency: 'now',
        ttlMinutes: 60,
    });

    const playing = await pollForCondition(
        async () => {
            const group = (await apiGet(adminToken, `/lfg/${gameId}`)) as {
                activeCount?: number;
                playingNow?: { eventId: number } | null;
            } | null;
            return group?.playingNow ?? null;
        },
        {
            timeoutMs: 30_000,
            description: `GET /lfg/${gameId} reports playingNow (the spawned ad-hoc event)`,
        },
    );

    await openGroupPage(page);

    const card = page.getByTestId('lfg-playing-now');
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card).toContainText('Playing now');
    // The head-count is the EVENT's roster (voice joiners included), so its
    // value is not pinned here — only that the line renders one.
    await expect(page.getByTestId('lfg-playing-now-count')).toHaveText(
        /^\d+ in voice$/,
    );

    // The way in that always exists. The voice anchor does NOT: the temp
    // channel is created after the spawn transaction commits, and a fleet env
    // without a guild never gets one — so it is asserted only when present.
    const eventLink = page.getByTestId('lfg-playing-now-event');
    await expect(eventLink).toHaveAttribute('href', /^\/events\/\d+$/);
    await expect(eventLink).toHaveAttribute(
        'href',
        `/events/${playing.eventId}`,
    );
    const voiceLink = page.getByTestId('lfg-playing-now-voice');
    if (await voiceLink.count()) {
        await expect(voiceLink).toHaveAttribute(
            'href',
            /^https:\/\/discord\.com\/channels\/\d+\/\d+$/,
        );
    }

    // AC3: no poll primary survives the spawn — nor the hero that carries it
    // (it replaced the status bar AND the viability prompt), nor ⋯ Manage.
    await expect(page.getByTestId('lfg-playing-state')).toBeVisible();
    await expect(page.getByTestId('lfg-hero-primary')).toHaveCount(0);
    await expect(page.getByTestId('lfg-hero')).toHaveCount(0);
    await expect(
        page.getByRole('button', { name: 'Start a scheduling poll' }),
    ).toHaveCount(0);
    await expect(page.getByTestId('lfg-manage')).toHaveCount(0);
    await expect(
        page.getByText("Nobody's looking for a group right now — be the first"),
    ).toHaveCount(0);
});

/**
 * ROK-1556 — the last panel must clear the fixed mobile tab bar.
 *
 * `scrollIntoViewIfNeeded` alone proves nothing: the viewport always fits the
 * panel, it is the FIXED tab bar (3.5rem + safe-area) that covered its bottom
 * edge. So scroll the document to its very end and compare the panel's bottom
 * with the bar's top — with `py-6` the two overlapped by ~32px on 375×667.
 */
test('on mobile the last panel is not hidden under the bottom tab bar', async ({
    page,
}, testInfo) => {
    test.skip(
        !gameSlug,
        'Catalogue has fewer slugged games than Playwright projects',
    );
    test.skip(testInfo.project.name !== 'mobile', 'The tab bar is mobile-only');
    test.setTimeout(HOOK_TIMEOUT_MS);

    // A live group, so the page renders every panel a reader would see.
    await apiPost(inviteeToken, '/lfg', { gameId });
    await waitForCount(adminToken, 1);
    await openGroupPage(page);

    const panel = page.getByTestId('lfg-suggestions-panel');
    await expect(panel).toBeVisible({ timeout: 15_000 });
    const tabBar = page.getByTestId('bottom-tab-bar');
    await expect(tabBar).toBeVisible();

    await page.evaluate(() =>
        window.scrollTo(0, document.documentElement.scrollHeight),
    );
    const panelBox = await panel.boundingBox();
    const barBox = await tabBar.boundingBox();
    expect(panelBox, 'suggestions panel must have a box').not.toBeNull();
    expect(barBox, 'tab bar must have a box').not.toBeNull();
    expect(
        panelBox!.y + panelBox!.height,
        `the last panel's bottom (${String(panelBox!.y + panelBox!.height)}) ` +
            `sits under the tab bar (top ${String(barBox!.y)}) — ROK-1556`,
    ).toBeLessThanOrEqual(barBox!.y);
});

/** Every hour of the week — so the invitee's availability never limits overlap. */
const ALL_WEEK_SLOTS = Array.from({ length: 7 * 24 }, (_, i) => ({
    dayOfWeek: Math.floor(i / 24),
    hour: i % 24,
}));

/**
 * ROK-1573 (approved H3/H6) — Lock in this event → the event-set hero.
 *
 * Real overlap windows need both members' game time, seeded through the
 * production `PUT /users/me/game-time`. The admin gets EXACTLY the slot set
 * `scheduling-poll.smoke.spec.ts` writes (a superset of
 * `lineup-participants.smoke.spec.ts`'s), so a sibling worker writing its own
 * shape mid-run still leaves Mon/Wed evenings in common; the invitee gets the
 * whole week and is reset to empty afterwards.
 *
 * Last in the file on purpose: a locked-in group reads as EVENT SET (join row
 * hidden) until that event ends, so the event is deleted in `finally`.
 */
test('Lock in this event turns the hero into the event-set state', async ({
    page,
}) => {
    test.skip(
        !gameSlug,
        'Catalogue has fewer slugged games than Playwright projects',
    );
    test.setTimeout(HOOK_TIMEOUT_MS);

    let eventId: number | undefined;
    try {
        await apiDelete(adminToken, `/lfg/${gameId}`);
        await apiDelete(inviteeToken, `/lfg/${gameId}`);
        await apiPut(inviteeToken, '/users/me/game-time', {
            slots: ALL_WEEK_SLOTS,
        });
        await apiPut(adminToken, '/users/me/game-time', {
            slots: [
                { dayOfWeek: 1, hour: 19 }, { dayOfWeek: 1, hour: 20 },
                { dayOfWeek: 3, hour: 19 }, { dayOfWeek: 3, hour: 20 },
                { dayOfWeek: 5, hour: 18 }, { dayOfWeek: 5, hour: 19 },
            ],
        });
        await apiPost(inviteeToken, '/lfg', { gameId });
        await apiPost(adminToken, '/lfg', { gameId });
        await waitForCount(adminToken, 2);
        // ROK-1156 barrier: the overlap read has a window before the DOM read.
        await pollForCondition(
            async () => {
                const overlap = (await apiGet(
                    adminToken,
                    `/lfg/${gameId}/overlap`,
                )) as { windows?: unknown[] } | null;
                return overlap?.windows?.length
                    ? `windows=${overlap.windows.length}`
                    : null;
            },
            {
                timeoutMs: 20_000,
                description: `GET /lfg/${gameId}/overlap reports a shared window`,
            },
        );

        await openGroupPage(page);
        const lockIn = page.getByTestId('lfg-lockin').first();
        await expect(lockIn).toBeVisible({ timeout: 15_000 });
        await expect(lockIn).toHaveText('Lock in this event');
        await expect(lockIn).toBeEnabled();

        // Cancel first: the confirm closes and nothing converts.
        await lockIn.click();
        const confirm = page.getByTestId('lfg-lockin-confirm');
        await expect(confirm).toBeVisible({ timeout: 15_000 });
        await page.getByTestId('lfg-lockin-confirm-cancel').click();
        await expect(confirm).toHaveCount(0);
        await expect(page.getByTestId('lfg-converted-event')).toHaveCount(0);

        await lockIn.click();
        await expect(confirm).toBeVisible({ timeout: 15_000 });
        await page.getByTestId('lfg-lockin-confirm-submit').click();

        const converted = await pollForCondition(
            async () => {
                const group = (await apiGet(adminToken, `/lfg/${gameId}`)) as {
                    convertedEvent?: { eventId: number } | null;
                } | null;
                return group?.convertedEvent ?? null;
            },
            {
                timeoutMs: 20_000,
                description: `GET /lfg/${gameId} reports convertedEvent`,
            },
        );
        eventId = converted.eventId;

        await expect(page.getByTestId('lfg-converted-event')).toBeVisible({
            timeout: 15_000,
        });
        await expect(page.getByTestId('lfg-hero')).toContainText('EVENT SET');
        const open = page.getByTestId('lfg-hero-primary');
        await expect(open).toHaveCount(1);
        await expect(open).toHaveText('Open the event');
        await expect(open).toHaveAttribute('href', `/events/${eventId}`);
        await expect(
            page.getByRole('button', { name: 'Start a scheduling poll' }),
        ).toHaveCount(0);
    } finally {
        if (eventId) await apiDelete(adminToken, `/events/${eventId}`);
        await apiDelete(adminToken, `/lfg/${gameId}`);
        await apiDelete(inviteeToken, `/lfg/${gameId}`);
        await apiPut(inviteeToken, '/users/me/game-time', { slots: [] });
    }
});
