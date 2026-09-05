/**
 * LFM channel-embed smoke test (ROK-1454 AC10).
 *
 * Drives one group through its whole life against a real Discord channel and
 * asserts the four things the design promises and the round-1 implementation
 * broke:
 *
 *   1. NOTHING posts on the first hand — "LFG is quiet. LFM is loud."
 *   2. The 1 → 2 transition posts exactly one message.
 *   3. Every later hand EDITS that message; the id never changes.
 *   4. Conversion edits it one final time and the roster still names everyone.
 *
 * (4) is the regression guard for the defect that got round 1 rejected: the
 * converted read composed `liveIntent`, whose `status='active'` AND
 * `expiresAt > now` predicates are both false for a converted group, so the
 * final embed silently lost every player. The assertion therefore names the
 * three players INDIVIDUALLY — a count would still pass if the roster were
 * replaced by three different people, and `Nobody yet` would pass any
 * "description is non-empty" check.
 *
 * The five assertions are one test, not five: they are stages of a single
 * lifecycle and stages 3-5 need the message id that stage 2 produced.
 */
import { pollForEmbed, waitForEmbedUpdate } from '../../helpers/polling.js';
import { readLastMessages } from '../../helpers/messages.js';
import {
  assertConditionNeverMet,
  awaitProcessing,
  createBinding,
  createEvent,
  convertLfg,
  deleteBinding,
  deleteEvent,
  postLfgIntent,
  seedFixtureUser,
  withdrawLfgIntent,
  type FixtureUser,
  type LfgGroupSummary,
} from '../fixtures.js';
import { assertEmbedColor, assertEmbedRenderRules } from '../assert.js';
import type { SmokeTest, TestContext } from '../types.js';
import type { SimpleEmbed, SimpleMessage } from '../../helpers/messages.js';

/** `EMBED_COLORS.REMINDER` — chrome state `needs_you`, below viability. */
const AMBER = 0xf59e0b;
/** `EMBED_COLORS.SIGNUP_CONFIRMATION` — chrome state `live`, at viability. */
const EMERALD = 0x34d399;
/** `EMBED_COLORS.SYSTEM` — chrome state `done`, every terminal state. */
const SLATE = 0x64748b;

/**
 * The D7 author vocabulary. Used to tell an LFM message apart from any other
 * embed family that happens to share the channel — the count assertion is
 * about "one LFM message per group", so widening it to every game-titled embed
 * would fail on an unrelated family rather than on the invariant.
 */
const LFM_AUTHOR =
  /^(◌ NEEDS PLAYERS|▸ READY TO SCHEDULE|■ SCHEDULED|■ EXPIRED|■ CLOSED)/u;

/** AC1 says "≥ 10 s"; a little over, and no `sleep()` anywhere. */
const QUIET_WINDOW_MS = 12_000;
/** How many games to probe for an idle one before giving up. */
const GAME_SCAN_LIMIT = 8;

/** `GET /lfg/:gameId` — the summary plus the live roster. */
interface LfgGroupDetail extends LfgGroupSummary {
  members: { userId: number; username: string; displayName: string | null }[];
}

/** What the DEMO_MODE slash-command harness hands back. */
interface HarnessReply {
  content?: string;
  embeds?: { author?: { name?: string }; description?: string }[];
}

/** Everything the phases share. Assembled as the run progresses. */
interface Run {
  ctx: TestContext;
  channelId: string;
  game: { id: number; name: string };
  fixture?: FixtureUser;
  /** The third hand — its own fixture user, so cleanup can withdraw it. */
  third?: FixtureUser;
  /** The id of the ONE message this group is allowed to own. */
  messageId?: string;
  /** Roster display names, captured while the live read still works. */
  rosterNames?: string[];
}

/** `GET /lfg/:gameId` as the admin. */
function readGroup(
  ctx: TestContext,
  gameId: number,
): Promise<LfgGroupDetail> {
  return ctx.api.get<LfgGroupDetail>(`/lfg/${gameId}`);
}

/**
 * A game nobody is currently looking for.
 *
 * Scanned from the END of the registry so this suite and the `/lfg` cases in
 * `slash-commands.test.ts` (which take the FIRST game) do not fight over one
 * group, and re-scanned every run so a leaked intent from a failed run costs
 * the next run a different game rather than a false failure.
 */
async function pickIdleGame(
  ctx: TestContext,
): Promise<{ id: number; name: string }> {
  // The admin registry (`/admin/settings/games`, paginated, default 20): one
  // wide page, candidates taken from ITS end.
  const res = await ctx.api.get<{ data: { id: number; name: string }[] }>(
    '/admin/settings/games?limit=100',
  );
  const candidates = (res.data ?? []).slice().reverse().slice(0, GAME_SCAN_LIMIT);
  if (candidates.length === 0) throw new Error('LFM: no games in the registry');
  for (const game of candidates) {
    const group = await readGroup(ctx, game.id);
    if (group.activeCount === 0) return game;
  }
  throw new Error(
    `LFM: all ${candidates.length} candidate games already have active LFG ` +
      `intents — clear them before re-running (ids: ${candidates
        .map((g) => g.id)
        .join(', ')})`,
  );
}

/** The game-titled embed on a message, or a failure naming what was there. */
function embedFor(msg: SimpleMessage, title: string): SimpleEmbed {
  const embed = msg.embeds.find((e) => e.title === title);
  if (!embed) {
    const titles = msg.embeds.map((e) => e.title).join(', ');
    throw new Error(
      `LFM: message ${msg.id} carries no embed titled "${title}" (titles: [${titles}])`,
    );
  }
  assertEmbedRenderRules(embed);
  return embed;
}

/** Assert an author line, reporting the line that was actually rendered. */
function assertAuthor(embed: SimpleEmbed, pattern: RegExp, label: string): void {
  const author = embed.author ?? '';
  if (!pattern.test(author)) {
    throw new Error(
      `${label}: expected author matching ${String(pattern)}, got "${author}"`,
    );
  }
}

/** Assert a description, reporting the description that was rendered. */
function assertDescription(
  embed: SimpleEmbed,
  pattern: RegExp,
  label: string,
): void {
  const description = embed.description ?? '';
  if (!pattern.test(description)) {
    throw new Error(
      `${label}: expected description matching ${String(pattern)}, got "${description}"`,
    );
  }
}

/**
 * Assert the edit landed on the SAME message.
 *
 * A new message id is the AC2 failure, not a flake — `waitForEmbedUpdate`
 * polls the channel as a fallback, so a re-post satisfies the predicate and
 * arrives here to be named.
 */
function assertSameMessage(run: Run, msg: SimpleMessage, label: string): void {
  if (msg.id !== run.messageId) {
    throw new Error(
      `${label}: expected the SAME message id ${run.messageId} (AC2 — one ` +
        `message per group, edited in place), got a different message ${msg.id}`,
    );
  }
}

/** Stage 1 — the first hand is silent. */
async function assertQuietOnFirstHand(run: Run): Promise<void> {
  const first = await postLfgIntent(run.ctx.api, run.game.id);
  if (first.group.activeCount !== 1) {
    throw new Error(
      `LFM precondition: expected activeCount 1 after the first hand on ` +
        `"${run.game.name}", got ${first.group.activeCount} — the group was ` +
        `not idle, so the quiet-window assertion would be vacuous`,
    );
  }
  await awaitProcessing(run.ctx.api);
  await assertConditionNeverMet(
    async () => {
      const msgs = await readLastMessages(run.channelId, 50);
      return msgs.some((m) => m.embeds.some((e) => e.title === run.game.name));
    },
    QUIET_WINDOW_MS,
    `AC1: a bot message titled "${run.game.name}" appeared in channel ` +
      `${run.channelId} after ONE hand — nothing may post before the 1 → 2 ` +
      `transition ("LFG is quiet, LFM is loud")`,
  );
}

/** Stage 2 — the second hand posts exactly one message. */
async function assertPostsOnSecondHand(run: Run): Promise<void> {
  run.fixture = await seedFixtureUser(run.ctx.api);
  const second = await postLfgIntent(run.fixture.api, run.game.id);
  if (second.group.activeCount !== 2) {
    throw new Error(
      `LFM precondition: expected activeCount 2 after the second hand, got ` +
        `${second.group.activeCount}`,
    );
  }
  await awaitProcessing(run.ctx.api);
  const msg = await pollForEmbed(
    run.channelId,
    (m) => m.embeds.some((e) => e.title === run.game.name),
    run.ctx.config.timeoutMs,
  );
  run.messageId = msg.id;
  const embed = embedFor(msg, run.game.name);
  assertAuthor(embed, /^(◌ NEEDS PLAYERS|▸ READY TO SCHEDULE)/u, 'AC3 author');
  assertAuthor(embed, /\b2 looking\b/u, 'AC3 count');
  assertDescription(embed, /Open group/u, 'AC3 group link');
  // Read viability rather than hard-coding it: the threshold is
  // `games.cooptimusOnlineMax`, which is null for most seeded games.
  const group = await readGroup(run.ctx, run.game.id);
  assertEmbedColor(embed, group.isViable ? EMERALD : AMBER);
}

/** Invoke `/lfg game:<id>` through the DEMO_MODE harness. */
function invokeLfg(
  ctx: TestContext,
  discordUserId: string,
  game: string,
): Promise<HarnessReply> {
  return ctx.api.post<HarnessReply>('/admin/test/slash-command', {
    commandName: 'lfg',
    options: { game },
    discordUserId,
    guildId: ctx.config.guildId,
    channelId: ctx.defaultChannelId,
  });
}

/**
 * The third player: a SECOND fixture user (its own JWT and Discord id), so the
 * `/lfg` harness resolves it by `users.discord_id` AND cleanup can withdraw
 * its hand. A borrowed demo user had no client to withdraw with, and a failure
 * between stages 3 and 4 left its intent live for days, poisoning the game.
 */
async function seedThirdPlayer(run: Run): Promise<string> {
  // Slot 2: the seed endpoint is idempotent per slot, and slot 1 is already
  // the second hand — the same user again would be a no-op `/lfg`.
  run.third = await seedFixtureUser(run.ctx.api, 3, 2);
  return run.third.discordId;
}

/** Stage 3 — the third hand, through `/lfg`, EDITS the same message. */
async function assertEditsOnThirdHand(run: Run): Promise<void> {
  const discordId = await seedThirdPlayer(run);
  const reply = await invokeLfg(run.ctx, discordId, String(run.game.id));
  const replyAuthor = reply.embeds?.[0]?.author?.name ?? '';
  if (!/\b3 looking\b/u.test(replyAuthor)) {
    throw new Error(
      `AC6: /lfg should have raised the third hand and answered with the ` +
        `group state, got author "${replyAuthor}" / content ` +
        `"${reply.content ?? ''}"`,
    );
  }
  await awaitProcessing(run.ctx.api);
  const msg = await waitForEmbedUpdate(
    run.channelId,
    (m) =>
      m.embeds.some(
        (e) => e.title === run.game.name && /\b3 looking\b/u.test(e.author ?? ''),
      ),
    run.ctx.config.timeoutMs,
  );
  assertSameMessage(run, msg, 'AC2 third hand');
  // Captured while the LIVE read still works: after conversion every intent is
  // `status='converted'` and this endpoint returns an empty roster by design.
  const group = await readGroup(run.ctx, run.game.id);
  run.rosterNames = group.members.map((m) => m.displayName ?? m.username);
  if (run.rosterNames.length !== 3) {
    throw new Error(
      `LFM precondition: expected a 3-player roster before conversion, got ` +
        `${run.rosterNames.length} ([${run.rosterNames.join(', ')}])`,
    );
  }
}

/** Stage 4 — conversion is the final edit, and it keeps everyone. */
async function assertConvertedEdit(run: Run, eventId: number): Promise<void> {
  await convertLfg(run.ctx.api, run.game.id, { eventId });
  await awaitProcessing(run.ctx.api);
  const msg = await waitForEmbedUpdate(
    run.channelId,
    (m) =>
      m.embeds.some(
        (e) => e.title === run.game.name && /^■ SCHEDULED/u.test(e.author ?? ''),
      ),
    run.ctx.config.timeoutMs,
  );
  assertSameMessage(run, msg, 'AC5 conversion');
  const embed = embedFor(msg, run.game.name);
  assertEmbedColor(embed, SLATE);
  assertDescription(embed, /Open event/u, 'AC5 event link');
  const description = embed.description ?? '';
  if (/Open group/u.test(description)) {
    throw new Error(
      `AC5: the SCHEDULED embed still links to the group page — the target ` +
        `link must replace it. Description: "${description}"`,
    );
  }
  assertRosterSurvived(run, description);
}

/**
 * The round-1 regression guard: every player is still named after conversion.
 *
 * Asserted name by name. A count would pass if the roster had been rebuilt
 * from different rows, and the round-1 defect rendered the `|| 'Nobody yet'`
 * fallback, which satisfies any "description is non-empty" check.
 */
function assertRosterSurvived(run: Run, description: string): void {
  const missing = (run.rosterNames ?? []).filter(
    (name) => !description.includes(name),
  );
  if (missing.length > 0) {
    throw new Error(
      `AC5 regression guard: the converted embed lost ${missing.length} of ` +
        `${run.rosterNames?.length} players from the roster — missing ` +
        `[${missing.join(', ')}]. This is the round-1 defect (the converted ` +
        `read composed liveIntent). Description: "${description}"`,
    );
  }
}

/** Stage 5 — one message for the whole run, and every embed renders. */
async function assertExactlyOneMessage(run: Run): Promise<void> {
  const msgs = await readLastMessages(run.channelId, 100);
  const lfm = msgs.filter((m) =>
    m.embeds.some(
      (e) => e.title === run.game.name && LFM_AUTHOR.test(e.author ?? ''),
    ),
  );
  for (const msg of lfm) embedFor(msg, run.game.name);
  if (lfm.length !== 1) {
    throw new Error(
      `AC2/AC5: expected exactly 1 LFM message for "${run.game.name}" in ` +
        `channel ${run.channelId} for the whole run, found ${lfm.length} ` +
        `(ids: ${lfm.map((m) => m.id).join(', ')}) — a terminal state must ` +
        `edit, never post a second card`,
    );
  }
}

/** Withdraw what can be withdrawn and drop the fixtures this test created. */
async function cleanup(
  run: Run,
  bindingId?: string,
  eventId?: number,
): Promise<void> {
  await withdrawLfgIntent(run.ctx.api, run.game.id);
  if (run.fixture) await withdrawLfgIntent(run.fixture.api, run.game.id);
  if (run.third) await withdrawLfgIntent(run.third.api, run.game.id);
  if (eventId !== undefined) await deleteEvent(run.ctx.api, eventId);
  if (bindingId) await deleteBinding(run.ctx.api, bindingId);
}

const lfmEmbedLifecycle: SmokeTest = {
  name: 'LFM embed: quiet on hand 1, one message edited in place through conversion',
  category: 'embed',
  async run(ctx) {
    const game = await pickIdleGame(ctx);
    const run: Run = { ctx, channelId: ctx.defaultChannelId, game };
    let bindingId: string | undefined;
    let eventId: number | undefined;
    try {
      // Bind the game explicitly so `resolveLfmChannel`'s FIRST step decides
      // where the embed lands. Relying on the default-channel fallback would
      // make the destination depend on a setting this test does not own.
      bindingId = await createBinding(ctx.api, {
        channelId: run.channelId,
        channelType: 'text',
        purpose: 'game-announcements',
        gameId: game.id,
      });
      await assertQuietOnFirstHand(run);
      await assertPostsOnSecondHand(run);
      await assertEditsOnThirdHand(run);
      const event = await createEvent(ctx.api, 'lfm-convert', {
        gameId: game.id,
      });
      eventId = event.id;
      await assertConvertedEdit(run, event.id);
      await assertExactlyOneMessage(run);
    } finally {
      await cleanup(run, bindingId, eventId);
    }
  },
};

export const lfmEmbedTests: SmokeTest[] = [lfmEmbedLifecycle];
