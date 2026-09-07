/**
 * LFG player-invite smoke (ROK-1455 AC10 / S1, S2).
 *
 * S1 — an invite from a group member lands as an `lfg_player_invite`
 *      notification for the recipient, naming the inviter and the reason.
 * S2 — the decline (pressed through the DEMO endpoint, D15) keeps the
 *      suggestion's `inviteState` at `sent`, refuses a re-invite with the one
 *      opaque body, and is idempotent.
 *
 * WHY THE DM ITSELF IS NOT READ: Discord refuses bot-to-bot DMs (50007), and
 * the only Discord account the smoke can read is the companion bot's. Every DM
 * smoke in this directory therefore asserts the in-app notification row —
 * the canonical mirror the dispatcher writes first — and this one does the
 * same. The decline button's custom id (`lfg:invite-decline:{gameId}`, above
 * the eventId guard) is pinned by the api unit test
 * `notification-embed.lfg-player-invite.spec.ts` (T-B3).
 *
 * The recipient is the DM-recipient demo user (its `discord_id` is the test
 * bot's real snowflake, which the invite pre-check requires). Its invite rows
 * are wiped before AND after the test so the no-repeat horizon and the
 * per-recipient budget cannot fail a re-run against a persistent database.
 *
 * WHY S1 AND S2 ARE ONE TEST: category `dm` runs in the parallel pool, and two
 * tests sharing one recipient would race — same idle-game pick (the loser's
 * first invite trips the no-repeat guard), and each one's
 * `lfg-invites/reset` wipes ALL of the recipient's rows, including the row the
 * sibling is about to decline. One arrange, one recipient, one game, one
 * reset: S1's delivery assertions run first, S2's decline assertions follow on
 * the same row. The inviter is fixture slot {@link INVITER_SLOT}, disjoint from
 * the slots the LFM/LFG-board suites seed (1–4).
 */
import { pollForCondition } from "../../helpers/polling.js";
import {
  addGameInterest,
  linkDiscord,
  postLfgIntent,
  seedFixtureUser,
  withdrawLfgIntent,
  type FixtureUser,
} from "../fixtures.js";
import type { ApiClient } from "../api.js";
import type { SmokeTest, TestContext } from "../types.js";

/** `LFG_INVITE_NOTIFICATION_TYPE` — mirrored; the bot has no api dependency. */
const INVITE_TYPE = "lfg_player_invite";
/** `LFG_INVITE_SKIP_REASON` — the one opaque recipient-scoped refusal (D13). */
const SKIP_REASON = "unavailable";
/** Enough for the notification INSERT inside the invite transaction. */
const NOTIFICATION_MS = 15_000;
/** The two LFG lifecycle suites scan the last 16 registry games; start past. */
const GAME_SCAN_OFFSET = 16;
/** Registry page size — `AdminGameListQuerySchema` caps `limit` at 100. */
const GAME_PAGE_SIZE = 100;
/** Stops a runaway loop if `meta.hasMore` ever lies; 100 pages = 10k games. */
const GAME_PAGE_CAP = 100;
/** How many candidates to probe for `activeCount === 0` before giving up. */
const GAME_PROBE_LIMIT = 24;
/**
 * How many idle games to arrange-and-probe for recipient inclusion.
 *
 * Each miss costs an interest write, an intent POST, a suggestions read and a
 * withdraw, so the loop is bounded well below {@link GAME_PROBE_LIMIT}: if the
 * recipient is outside the cut on eight independent idle games the cause is
 * ranking-wide, not this game's, and more attempts only burn the clock.
 */
const INCLUSION_PROBE_LIMIT = 8;
/** Fixture slot for the inviter — slots 1–4 belong to lfm-embed / lfg-board. */
const INVITER_SLOT = 5;

/** A registry game, as the fixture needs it. */
interface Game {
  id: number;
  name: string;
}
interface InviteResponse {
  status: "sent" | "skipped";
  reason: string | null;
}
interface Suggestion {
  userId: number;
  reasons: string[];
  inviteState: "none" | "sent";
}
interface SuggestionsResponse {
  suggestions: Suggestion[];
}
interface NotificationRow {
  type: string;
  title?: string;
  payload?: Record<string, unknown>;
}

async function readActiveCount(ctx: TestContext, gameId: number) {
  try {
    const g = await ctx.api.get<{ activeCount?: number }>(`/lfg/${gameId}`);
    return g.activeCount ?? 0;
  } catch {
    return 0;
  }
}

/** One page of `GET /admin/settings/games`. */
interface GamePage {
  data: Game[];
  meta?: { hasMore?: boolean };
}

/**
 * Every game in the registry, in registry order.
 *
 * Paged rather than read as one wide page because `limit` is capped at 100 by
 * the contract, and a catalogue cloned from prod is far larger than that.
 */
async function fetchAllGames(ctx: TestContext): Promise<Game[]> {
  const all: Game[] = [];
  for (let page = 1; page <= GAME_PAGE_CAP; page += 1) {
    const res = await ctx.api.get<GamePage>(
      `/admin/settings/games?limit=${GAME_PAGE_SIZE}&page=${page}`,
    );
    const rows = res.data ?? [];
    all.push(...rows);
    if (rows.length === 0 || res.meta?.hasMore !== true) break;
  }
  return all;
}

/**
 * Registry games with NO live group, best candidates first.
 *
 * Candidates are ordered, not windowed. Scanning from the END of the registry
 * keeps this suite off the games `slash-commands.test.ts` takes (the FIRST
 * one), and the first {@link GAME_SCAN_OFFSET} of that reversed list belong to
 * `lfm-embed.test.ts` (last 8) and `lfg-board.test.ts` (the 8 behind those) —
 * so those are tried LAST rather than skipped. A fixed `slice(16, 24)` window
 * returned zero candidates on GitHub's DEMO seed, which holds fewer than 16
 * games, and the suite failed at 0.0 s with "no idle game among 0 candidates".
 *
 * There is no fallback that CREATES a game: no DEMO seam or IGDB-free admin
 * endpoint inserts one (the sibling LFG suites scan the registry too), and a
 * new INSERT-into-`games` path would have to carry the name-dedup lock. If
 * every game in the catalogue is busy, both sibling suites are broken as well,
 * so the error names the ids to clear.
 *
 * Returns up to {@link INCLUSION_PROBE_LIMIT} of them rather than the first:
 * being idle is necessary but not sufficient, and
 * {@link pickVisibleGame} needs somewhere to go when a game's suggestions
 * list ranks the recipient out.
 */
async function collectIdleGames(ctx: TestContext): Promise<Game[]> {
  const reversed = (await fetchAllGames(ctx)).reverse();
  if (reversed.length === 0)
    throw new Error("LFG invite: no games in the registry");
  const candidates = [
    ...reversed.slice(GAME_SCAN_OFFSET),
    ...reversed.slice(0, GAME_SCAN_OFFSET),
  ].slice(0, GAME_PROBE_LIMIT);
  const idle: Game[] = [];
  for (const game of candidates) {
    if ((await readActiveCount(ctx, game.id)) === 0) idle.push(game);
    if (idle.length === INCLUSION_PROBE_LIMIT) return idle;
  }
  if (idle.length > 0) return idle;
  throw new Error(
    `LFG invite: no idle game among ${candidates.length} candidates ` +
      `(registry holds ${reversed.length}) — every one already has a live ` +
      `group (ids: ${candidates.map((g) => g.id).join(", ")})`,
  );
}

/**
 * An idle game whose suggestions list actually CONTAINS the recipient.
 *
 * `GET /lfg/:gameId/suggestions` returns only the top
 * `LFG_SUGGESTIONS_LIMIT` (12) rows, ranked played > owns > hearted — and the
 * recipient only ever HEARTS the game, so it ranks last. On a catalogue cloned
 * from prod that is enough to push it off the end, which is not a product bug:
 * the UI can only invite a player it lists, so a fixture that invites an
 * unlisted user is testing a call the real flow cannot make. It also breaks S2,
 * whose whole assertion is that the recipient's row reads `inviteState=sent`.
 *
 * So inclusion is arranged, not assumed: for each idle candidate the recipient
 * hearts it and the inviter raises a hand (both preconditions of the invite
 * itself), then the inviter's own suggestions read decides. A miss withdraws
 * the intent again so the loser is left exactly as found, and the next
 * candidate is tried.
 */
async function pickVisibleGame(
  ctx: TestContext,
  inviter: FixtureUser,
  recipientId: number,
): Promise<Game> {
  const idle = await collectIdleGames(ctx);
  const tried: string[] = [];
  for (const game of idle) {
    await addGameInterest(ctx.api, recipientId, game.id);
    await postLfgIntent(inviter.api, game.id);
    const rows = await suggestionRows(inviter.api, game.id);
    if (rows.some((s) => s.userId === recipientId)) return game;
    tried.push(`${game.name}#${game.id}: ${rows.length} rows`);
    await withdrawLfgIntent(inviter.api, game.id);
  }
  throw new Error(
    `LFG invite: recipient ${recipientId} ranked outside the suggestions cut ` +
      `on every idle game tried, so the UI could not have invited them ` +
      `either — the recipient only hearts the game and "hearted" ranks last. ` +
      `Tried ${tried.length}: ${tried.join("; ")}`,
  );
}

/** The inviter's view of who this group could still pull in. */
async function suggestionRows(
  api: ApiClient,
  gameId: number,
): Promise<Suggestion[]> {
  const res = await api.get<SuggestionsResponse>(`/lfg/${gameId}/suggestions`);
  return res.suggestions ?? [];
}

/**
 * `pollForCondition` with a caller-supplied failure line.
 *
 * The helper's timeout text names neither what was awaited nor what the last
 * poll actually saw, so an exhausted poll reaches CI as the anonymous
 * `pollForCondition timed out after 15000ms` and nothing else — which is
 * precisely how both of this suite's polls failed on run 34113941245, costing
 * a full triage cycle to tell them apart. The check hands back its own
 * observation alongside the hit; the last one is rethrown with the label.
 * Wrapped rather than changed at the source: `pollForCondition` is shared by
 * every smoke in this directory.
 */
async function pollOrExplain<T>(
  label: string,
  check: () => Promise<{ hit: T | null; seen: string }>,
  timeoutMs = NOTIFICATION_MS,
): Promise<T> {
  let last = "no poll completed";
  try {
    return await pollForCondition(async () => {
      const { hit, seen } = await check();
      last = seen;
      return hit;
    }, timeoutMs);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    throw new Error(`${label} (last: ${last}) — ${why}`);
  }
}

function resetInvites(api: ApiClient, userId: number) {
  return api.post<{ deleted: number }>("/admin/test/lfg-invites/reset", {
    userId,
  });
}

function invite(api: ApiClient, gameId: number, userId: number) {
  return api.post<InviteResponse>(`/lfg/${gameId}/invites`, { userId });
}

function declineViaDemo(api: ApiClient, userId: number, gameId: number) {
  return api.post<{ declined: boolean }>("/admin/test/lfg-invite-decline", {
    userId,
    gameId,
  });
}

function expectBody(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
}

interface Arranged {
  inviter: FixtureUser;
  game: Game;
  recipientId: number;
}

/**
 * The recipient-side preconditions the invite pre-check reads, restored.
 *
 * `setup()` establishes all three for the DM recipient ONCE — active row,
 * companion-bot snowflake linked, every channel enabled — and nothing
 * re-establishes them at test time. The API collapses `ineligible`,
 * `unlinked` and `opted_out` into the SAME opaque `skipped / unavailable`
 * (D13), so any drift in any of the three arrives as an unreadable refusal on
 * the first invite rather than as a named failure. Three idempotent DEMO
 * writes remove the whole class.
 */
async function ensureInvitable(
  ctx: TestContext,
  recipientId: number,
): Promise<void> {
  // Active — `eligibleUser()` (AC5). A 4xx because the row is ALREADY active
  // is the expected answer here, not a failure.
  await ctx.api.post(`/users/${recipientId}/reactivate`, {}).catch(() => null);
  // A real snowflake: a `local:` / `unlinked:` stamp reads as unlinked.
  await linkDiscord(ctx.api, recipientId, ctx.testBotDiscordId, "SmokeTestBot");
  // Every channel on for every type, `lfg_player_invite` included.
  await ctx.api
    .post("/admin/test/enable-discord-notifications", { userId: recipientId })
    .catch(() => null);
}

/** Name the recipient state the opaque refusal hides (D13). */
async function describeRecipient(
  ctx: TestContext,
  recipientId: number,
): Promise<string> {
  try {
    const state = await ctx.api.get<{ deactivatedAt: string | null }>(
      `/admin/test/user-state?userId=${recipientId}`,
    );
    return `recipient ${recipientId} deactivatedAt=${JSON.stringify(state.deactivatedAt)}`;
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    return `recipient ${recipientId} state unreadable (${why})`;
  }
}

/**
 * Idle game the recipient hearts, the inviter holds, and the suggestions list
 * actually shows — see {@link pickVisibleGame} for why the last clause is a
 * precondition and not an assumption.
 */
async function arrange(ctx: TestContext): Promise<Arranged> {
  const recipientId = ctx.dmRecipientUserId;
  await ensureInvitable(ctx, recipientId);
  await resetInvites(ctx.api, recipientId);
  const inviter = await seedFixtureUser(ctx.api, 3, INVITER_SLOT);
  const game = await pickVisibleGame(ctx, inviter, recipientId);
  return { inviter, game, recipientId };
}

async function cleanup(ctx: TestContext, a: Arranged): Promise<void> {
  await withdrawLfgIntent(a.inviter.api, a.game.id);
  await resetInvites(ctx.api, a.recipientId).catch(() => {});
}

/** S1 — the notification row names the inviter, the game and the reason. */
async function assertDelivered(ctx: TestContext, a: Arranged): Promise<void> {
  const row = await pollOrExplain<NotificationRow>(
    `S1: no ${INVITE_TYPE} notification for recipient ${a.recipientId} ` +
      `carrying gameId ${a.game.id} ("${a.game.name}") within ${NOTIFICATION_MS}ms`,
    async () => {
      const list = await ctx.api.get<NotificationRow[]>(
        `/admin/test/notifications?userId=${a.recipientId}&type=${INVITE_TYPE}&limit=20`,
      );
      return {
        hit: list.find((n) => n.payload?.gameId === a.game.id) ?? null,
        seen:
          `${list.length} ${INVITE_TYPE} rows, payload.gameId=` +
          `[${list.map((n) => String(n.payload?.gameId)).join(", ")}]`,
      };
    },
  );

  const p = row.payload ?? {};
  if (p.inviterUserId !== a.inviter.userId) {
    throw new Error(
      `payload.inviterUserId: expected ${a.inviter.userId}, got ${String(p.inviterUserId)}`,
    );
  }
  if (p.gameName !== a.game.name) {
    throw new Error(
      `payload.gameName: expected "${a.game.name}", got ${JSON.stringify(p.gameName)}`,
    );
  }
  const reasons = Array.isArray(p.reasons) ? (p.reasons as string[]) : [];
  if (!reasons.includes("hearted")) {
    throw new Error(
      `payload.reasons: expected to include "hearted" (the recipient hearted the game), got ${JSON.stringify(reasons)}`,
    );
  }
  if (typeof p.inviterName !== "string" || p.inviterName.length === 0) {
    throw new Error(`payload.inviterName missing: ${JSON.stringify(p)}`);
  }
}

/** S2 — decline keeps inviteState=sent, refuses a re-invite, is idempotent. */
async function assertDeclineHolds(
  ctx: TestContext,
  a: Arranged,
): Promise<void> {
  const declined = await declineViaDemo(ctx.api, a.recipientId, a.game.id);
  expectBody("decline", declined, { declined: true });

  await pollOrExplain<Suggestion>(
    `S2: recipient ${a.recipientId} never showed inviteState=sent in ` +
      `/lfg/${a.game.id}/suggestions (as inviter ${a.inviter.userId}) ` +
      `within ${NOTIFICATION_MS}ms`,
    async () => {
      const rows = await suggestionRows(a.inviter.api, a.game.id);
      const me = rows.find((s) => s.userId === a.recipientId);
      return {
        hit: me?.inviteState === "sent" ? me : null,
        seen: me
          ? `row present, inviteState=${me.inviteState}`
          : `absent from ${rows.length} rows ` +
            `(userIds=[${rows.map((s) => s.userId).join(", ")}])`,
      };
    },
  );

  const again = await invite(a.inviter.api, a.game.id, a.recipientId);
  expectBody("re-invite after decline", again, {
    status: "skipped",
    reason: SKIP_REASON,
  });

  const repeat = await declineViaDemo(ctx.api, a.recipientId, a.game.id);
  expectBody("second decline", repeat, { declined: false });
}

const inviteThenDecline: SmokeTest = {
  name: "LFG player invite lands as an lfg_player_invite notification naming inviter + reason (S1); declining keeps inviteState=sent, refuses a re-invite, and is idempotent (S2)",
  category: "dm",
  async run(ctx) {
    const a = await arrange(ctx);
    try {
      const sent = await invite(a.inviter.api, a.game.id, a.recipientId);
      if (sent.status !== "sent") {
        throw new Error(
          `invite: expected {"status":"sent","reason":null}, got ` +
            `${JSON.stringify(sent)} — every recipient-scoped reason collapses ` +
            `into this one body (D13); the API log line names which. ` +
            `${await describeRecipient(ctx, a.recipientId)}`,
        );
      }
      expectBody("invite", sent, { status: "sent", reason: null });

      await assertDelivered(ctx, a);
      await assertDeclineHolds(ctx, a);
    } finally {
      await cleanup(ctx, a);
    }
  },
};

export const lfgInviteTests: SmokeTest[] = [inviteThenDecline];
