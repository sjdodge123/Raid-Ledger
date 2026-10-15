/**
 * ROK-1740 — the pinned "Join Raid Ledger" post: post / re-post /
 * delete-then-re-post / remove, against the real Discord guild.
 *
 * The join post is a per-instance singleton (one stored message id), so this
 * is the only smoke that touches it. It uses an EXISTING non-default text
 * channel that `setupChannelPool` reserves for it (`join-post-channel.ts`) —
 * never a new channel, never `ci-*` or `slot-*` (ROK-1623; `ctx.textChannels`
 * is already slot/⏰-filtered).
 *
 * The idempotency claim (AC2) is checked in Discord itself: after every
 * publish the channel's pins hold EXACTLY ONE join post from the app bot.
 */
import { pollForCondition } from "../../helpers/polling.js";
import {
  messageExists,
  readPinnedMessages,
  type SimpleMessage,
} from "../../helpers/messages.js";
import { SmokeAssertionError } from "../assert.js";
import { pickJoinPostChannel } from "../join-post-channel.js";
import type { DiscordChannel, SmokeTest, TestContext } from "../types.js";

/** `api/src/discord-bot/join-post/join-post.constants.ts::JOIN_POST_AUTHOR`. */
const JOIN_POST_AUTHOR = "\u{1F44B} JOIN RAID LEDGER";
const ROUTE = "/admin/settings/discord-bot/join-post";
const FIXTURE_DELETE = "/admin/test/join-post/delete-message";
const TIMEOUT_MS = 20_000;

interface PublishResult {
  outcome: "created" | "edited" | "adopted" | "recreated";
  channelId: string;
  messageId: string;
  pinned: boolean;
  warning: string | null;
}

/** The channel the binding pool left out for this smoke. */
function pickJoinChannel(ctx: TestContext): DiscordChannel {
  const channel = pickJoinPostChannel(ctx.textChannels, ctx.defaultChannelId);
  if (!channel) {
    throw new SmokeAssertionError(
      `ROK-1740 needs a non-default text channel; ` +
        `textChannels=${String(ctx.textChannels.length)}`,
    );
  }
  return channel;
}

function isJoinPost(m: SimpleMessage): boolean {
  return m.embeds.some((e) => e.author === JOIN_POST_AUTHOR);
}

/**
 * Wait until the pins hold exactly one join post, and it is `messageId`.
 * On timeout, fail naming what the pins actually held.
 */
async function expectSolePinned(
  channelId: string,
  messageId: string,
): Promise<SimpleMessage> {
  let seen: string[] = [];
  try {
    return await pollForCondition(async () => {
      const own = (await readPinnedMessages(channelId)).filter(isJoinPost);
      seen = own.map((m) => m.id);
      return own.length === 1 && own[0]?.id === messageId ? own[0] : null;
    }, TIMEOUT_MS);
  } catch {
    throw new SmokeAssertionError(
      `expected exactly one pinned join post (${messageId}) in ${channelId}, ` +
        `pins held [${seen.join(", ")}]`,
    );
  }
}

function expectOutcome(
  res: PublishResult,
  outcomes: PublishResult["outcome"][],
  step: string,
) {
  if (!outcomes.includes(res.outcome) || !res.pinned) {
    throw new SmokeAssertionError(
      `${step}: expected outcome=${outcomes.join("|")} pinned=true, got ` +
        `outcome=${res.outcome} pinned=${String(res.pinned)} ` +
        `warning=${String(res.warning)}`,
    );
  }
}

/** The post's embed author + a Link button that opens the sign-in page. */
function expectJoinPostShape(msg: SimpleMessage): void {
  const button = msg.components.find((c) => typeof c.url === "string");
  if (!button?.url?.endsWith("/login")) {
    throw new SmokeAssertionError(
      `join post ${msg.id}: expected a Link button to …/login, got ` +
        `${JSON.stringify(msg.components)}`,
    );
  }
}

async function waitGone(channelId: string, messageId: string, step: string) {
  try {
    await pollForCondition(
      async () => ((await messageExists(channelId, messageId)) ? null : true),
      TIMEOUT_MS,
    );
  } catch {
    throw new SmokeAssertionError(
      `${step}: message ${messageId} still exists in ${channelId}`,
    );
  }
}

async function postRepostDeleteRepost(ctx: TestContext): Promise<void> {
  const channel = pickJoinChannel(ctx);
  const publish = () =>
    ctx.api.post<PublishResult>(ROUTE, { channelId: channel.id });
  await ctx.api.delete(ROUTE); // a crashed earlier run's post, if any
  let lastId: string | null = null;
  try {
    const created = await publish();
    lastId = created.messageId;
    // A post leaked by a killed run is rediscovered (D6) on a fresh DB.
    expectOutcome(created, ["created", "adopted"], "post");
    expectJoinPostShape(await expectSolePinned(channel.id, created.messageId));

    const edited = await publish();
    expectOutcome(edited, ["edited"], "re-post");
    if (edited.messageId !== created.messageId) {
      throw new SmokeAssertionError(
        `re-post: expected the same message ${created.messageId}, ` +
          `got ${edited.messageId}`,
      );
    }
    await expectSolePinned(channel.id, created.messageId);

    await ctx.api.post(FIXTURE_DELETE);
    await waitGone(channel.id, created.messageId, "fixture delete");
    const recreated = await publish();
    lastId = recreated.messageId;
    expectOutcome(recreated, ["recreated"], "delete-then-re-post");
    await expectSolePinned(channel.id, recreated.messageId);
  } finally {
    // Never let a cleanup failure mask the assertion that got us here.
    await ctx.api.delete(ROUTE).catch((err: unknown) => {
      console.warn(`  join post cleanup DELETE failed: ${String(err)}`);
    });
  }
  if (lastId) await waitGone(channel.id, lastId, "remove");
}

export const joinPostTests: SmokeTest[] = [
  {
    name: "Join post: post, re-post, delete-then-re-post, remove (ROK-1740)",
    category: "embed",
    run: postRepostDeleteRepost,
  },
];
