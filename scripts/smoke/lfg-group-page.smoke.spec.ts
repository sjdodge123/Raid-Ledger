/**
 * ROK-1464 — `/lfg/:gameSlug`, the LFG group page (desktop + mobile).
 *
 * Drives the whole loop the page exists for:
 *   LFG (1 looking) → +1 → LFM (2 looking) → Withdraw → back to LFG →
 *   +1 → Find a time → the scheduling poll, with the viewer's intent converted.
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
 * Overlap: seeding two users' game-time availability is out of reach from a
 * smoke fixture, so this spec asserts the panel's DERIVED states (the
 * needs-two message at one member, the seven-day strip at two). The D4
 * `Start poll` → `suggest` seeding is covered by
 * `web/src/hooks/use-lfg-actions.test.ts`.
 */
import { test, expect } from "./base";
import type { Page } from "@playwright/test";
import {
  getAdminToken,
  apiGet,
  apiPost,
  apiDelete,
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

/** Load the group page fresh so the status bar reflects the latest read. */
async function openGroupPage(page: Page): Promise<void> {
  await page.goto(`/lfg/${gameSlug}`);
  await expect(page.getByTestId("lfg-status-bar")).toBeVisible({
    timeout: 15_000,
  });
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

test("LFG → LFM → withdraw, then Find a time converts the group", async ({
  page,
}) => {
  test.skip(
    !gameSlug,
    "Catalogue has fewer slugged games than Playwright projects",
  );
  test.setTimeout(HOOK_TIMEOUT_MS);

  // ---- 1 looking: someone else raised a hand, the viewer has not ---------
  await apiPost(inviteeToken, "/lfg", { gameId });
  await waitForCount(adminToken, 1);
  await openGroupPage(page);

  await expect(page.getByText("Looking for group")).toBeVisible();
  await expect(page.getByText(/^1 looking/)).toBeVisible();
  await expect(
    page.getByText("Overlap appears once two people are in"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /I'm in/ })).toBeVisible();

  // ---- +1: the derived LFG → LFM transition -----------------------------
  await page.getByRole("button", { name: /I'm in/ }).click();
  await waitForCount(adminToken, 2);
  await expect(page.getByText("Looking for members")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("button", { name: "Withdraw" })).toBeVisible();
  // Two live members: the overlap panel now has a roster to project.
  await expect(page.getByTestId("lfg-overlap-day")).toHaveCount(7);

  // ---- Withdraw: straight back to a one-person group --------------------
  await page.getByRole("button", { name: "Withdraw" }).click();
  await waitForCount(adminToken, 1);
  await expect(page.getByText("Looking for group")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("button", { name: /I'm in/ })).toBeVisible();

  // ---- Find a time: create → convert → navigate to the poll -------------
  await page.getByRole("button", { name: /I'm in/ }).click();
  await waitForCount(adminToken, 2);
  await page.getByRole("button", { name: "Find a time" }).click();

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
      description: "viewer intent converted away",
    },
  );
});

// ---------------------------------------------------------------------------
// ROK-1483 — the mirrored Discord conversation (AC8)
// ---------------------------------------------------------------------------

/** The seeded thread's guild — pinned so the deep link can be asserted exactly. */
const SEEDED_GUILD_ID = "148300000000000777";

/**
 * Ids derived from the game so desktop and mobile — separate workers against
 * ONE API, holding DIFFERENT games — cannot collide on `message_id`'s unique
 * index or on each other's binding row.
 */
function seededIds(id: number): { threadId: string; messageId: string } {
  const suffix = String(id).padStart(6, "0");
  return {
    threadId: `1483000000000${suffix}`,
    messageId: `1484000000000${suffix}`,
  };
}

/** Drive the seam. Returns whatever it answered, for the guild it settled on. */
async function seedThreadMirror(
  body: Record<string, unknown>,
): Promise<{ guildId: string; mirrored: number; cleared: number }> {
  return apiPost(adminToken, "/admin/test/thread-mirror", body);
}

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
  await expect(page.getByTestId("lfg-status-bar")).toHaveCount(0);
});
