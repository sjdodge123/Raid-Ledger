/**
 * ROK-1933 — the pinned hub welcome embed, against the real Discord guild:
 * bind a Valheim server hub to a channel → the welcome posts and pins;
 * re-post → the SAME message is edited (no duplicate); clear the channel →
 * the message is deleted.
 *
 * Hub: `claim-drive-fixture` (worker 14) — a visible `game_server` hub for the
 * worker's own Valheim server, named after it plus a per-run `nameSuffix`
 * (`Claimheim 14 <run>`), so the title is unique to this run.
 *
 * Channel: the EXISTING non-default text channel `join-post-channel.ts`
 * reserves out of the binding pool — never a new channel, never `ci-*` or
 * `slot-*` (ROK-1623; `ctx.textChannels` is already slot/⏰-filtered). The
 * join-post smoke posts there in the parallel pool, so this test is `serial`.
 * The welcome is matched by its EXACT run-unique title, so a welcome left by
 * a parallel or earlier run can neither satisfy nor confuse the assertions.
 *
 * The link-time post comes from an async listener, so it is polled for.
 */
import { pollForCondition } from "../../helpers/polling.js";
import {
  messageExists,
  readLastMessages,
  readPinnedMessages,
  type SimpleMessage,
} from "../../helpers/messages.js";
import { SmokeAssertionError } from "../assert.js";
import { pickJoinPostChannel } from "../join-post-channel.js";
import type { DiscordChannel, SmokeTest, TestContext } from "../types.js";

const WORKER = 14;
/** `HUB_WELCOME_COPY.title` for the fixture hub (`Claimheim <worker> <run>`). */
const welcomeTitle = (run: string): string =>
  `Claimheim ${String(WORKER)} ${run} on Raid Ledger`;
/** `HUB_WELCOME_COPY.openHubLabel` / `.claimLabel`. */
const OPEN_HUB = "Open the hub";
const CLAIM = "Claim your character";
const TIMEOUT_MS = 20_000;

interface WelcomeResult {
  result: "posted" | "edited";
  pinned: boolean;
  warning: string | null;
}

const discordRoute = (guildId: number) => `/guilds/${String(guildId)}/discord`;

function fail(msg: string): never {
  throw new SmokeAssertionError(msg);
}

function pickWelcomeChannel(ctx: TestContext): DiscordChannel {
  const channel = pickJoinPostChannel(ctx.textChannels, ctx.defaultChannelId);
  if (!channel) {
    fail(`ROK-1933 needs a non-default text channel; textChannels=${String(ctx.textChannels.length)}`);
  }
  return channel;
}

async function seedHub(ctx: TestContext, run: string): Promise<number> {
  const res = await ctx.api.post<{ guildId?: unknown }>(
    "/admin/test/valheim/claim-drive-fixture",
    { worker: WORKER, nameSuffix: run },
  );
  if (typeof res?.guildId !== "number") {
    fail(`claim-drive-fixture: no guildId in ${JSON.stringify(res)}`);
  }
  return res.guildId;
}

const isWelcome =
  (title: string) =>
  (m: SimpleMessage): boolean =>
    m.embeds.some((e) => e.title === title);

/**
 * Wait until the pins hold exactly one welcome (and it is `messageId` when
 * given). On timeout, fail naming what the pins held.
 */
async function expectSolePinned(
  channelId: string,
  title: string,
  messageId: string | null,
  step: string,
): Promise<SimpleMessage> {
  let seen: string[] = [];
  try {
    return await pollForCondition(async () => {
      const own = (await readPinnedMessages(channelId)).filter(isWelcome(title));
      seen = own.map((m) => m.id);
      const only = own.length === 1 ? own[0] : undefined;
      return only && (messageId === null || only.id === messageId) ? only : null;
    }, TIMEOUT_MS);
  } catch {
    fail(
      `${step}: expected exactly one pinned "${title}"` +
        `${messageId ? ` (${messageId})` : ""} in ${channelId}, pins held [${seen.join(", ")}]`,
    );
  }
}

/** [Open the hub] → /hubs/<id>, [Claim your character] → /hubs/<id>#characters. */
function expectLinkButtons(msg: SimpleMessage, guildId: number): void {
  const hub = `/hubs/${String(guildId)}`;
  const got = msg.components.map((c) => `${String(c.label)}→${String(c.url)}`);
  const ok =
    msg.components.length === 2 &&
    msg.components[0]?.label === OPEN_HUB &&
    msg.components[0]?.url?.endsWith(hub) === true &&
    msg.components[1]?.label === CLAIM &&
    msg.components[1]?.url?.endsWith(`${hub}#characters`) === true;
  if (!ok) {
    fail(`welcome ${msg.id}: expected [${OPEN_HUB}→…${hub}, ${CLAIM}→…${hub}#characters], got [${got.join(", ")}]`);
  }
}

/** Re-post edits in place: result `edited`, and the channel holds ONE welcome. */
async function expectRepostEdits(
  ctx: TestContext,
  guildId: number,
  channelId: string,
  title: string,
  messageId: string,
): Promise<void> {
  const res = await ctx.api.post<WelcomeResult>(`${discordRoute(guildId)}/welcome`);
  if (res.result !== "edited" || !res.pinned) {
    fail(`re-post: expected result=edited pinned=true, got ${JSON.stringify(res)}`);
  }
  await expectSolePinned(channelId, title, messageId, "re-post");
  const posted = (await readLastMessages(channelId, 50)).filter(isWelcome(title));
  if (posted.length !== 1 || posted[0]?.id !== messageId) {
    fail(`re-post: expected only ${messageId} in the channel, found [${posted.map((m) => m.id).join(", ")}]`);
  }
}

async function waitGone(channelId: string, messageId: string, step: string): Promise<void> {
  try {
    await pollForCondition(
      async () => ((await messageExists(channelId, messageId)) ? null : true),
      TIMEOUT_MS,
    );
  } catch {
    fail(`${step}: welcome ${messageId} still exists in ${channelId}`);
  }
}

/** Unbind; never mask the failure that got us here. */
async function unbind(ctx: TestContext, guildId: number): Promise<void> {
  await ctx.api.delete(`${discordRoute(guildId)}/channel`).catch((err: unknown) => {
    console.warn(`  hub welcome unbind failed: ${String(err)}`);
  });
}

async function welcomePostRepostClear(ctx: TestContext): Promise<void> {
  const channel = pickWelcomeChannel(ctx);
  const run = Date.now().toString(36);
  const title = welcomeTitle(run);
  const guildId = await seedHub(ctx, run);
  await unbind(ctx, guildId); // a crashed earlier run's binding, if any
  let messageId: string | null = null;
  try {
    // privateAck: harmless for a public channel; admin is staff for a private one.
    await ctx.api.put(`${discordRoute(guildId)}/channel`, {
      channelId: channel.id,
      privateAck: true,
    });
    const posted = await expectSolePinned(channel.id, title, null, "link");
    messageId = posted.id;
    expectLinkButtons(posted, guildId);
    await expectRepostEdits(ctx, guildId, channel.id, title, messageId);
  } finally {
    await unbind(ctx, guildId);
  }
  if (messageId) await waitGone(channel.id, messageId, "clear");
}

export const valheimHubWelcomeTests: SmokeTest[] = [
  {
    name: "ROK-1933 hub welcome: link posts + pins, re-post edits in place, clear deletes",
    category: "embed",
    serial: true,
    run: welcomePostRepostClear,
  },
];
