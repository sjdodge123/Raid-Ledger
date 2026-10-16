/**
 * ROK-1788 (guild page S4) — the read-only Discord channel mirror, against the
 * real Discord guild: the companion bot posts four uniquely-tokened messages,
 * an admin binds a seeded WoW guild to that channel, and the smoke polls
 * `GET /plugins/wow/guilds/:id/discord` until the mirror's latest three are
 * exactly the bot's last three, in order. Cleanup unbinds and deletes the
 * bot's own messages.
 *
 * Channel: the EXISTING non-default text channel `join-post-channel.ts`
 * reserves out of the binding pool — never a new channel, never `ci-*` or
 * `slot-*` (ROK-1623; `ctx.textChannels` is already slot/⏰-filtered). The
 * join-post smoke runs in the parallel pool and posts there, so this test is
 * `serial`: it runs after the pool, when nothing else writes to the channel,
 * and "the newest message is ours" is a fair assertion.
 *
 * Wire order (`channel-mirror.helpers.ts::toGuildDiscordMessages`): up to 10
 * messages, OLDEST first; the card renders the last three. The bind happens
 * AFTER posting — the `PUT` clears the 60s mirror cache for that channel, so
 * the first read is fresh.
 */
import type { Message } from "discord.js";
import { getTextChannel } from "../../client.js";
import { pollForCondition } from "../../helpers/polling.js";
import { SmokeAssertionError } from "../assert.js";
import { pickJoinPostChannel } from "../join-post-channel.js";
import type { DiscordChannel, SmokeTest, TestContext } from "../types.js";

const SEED_GUILD = "/admin/test/wow/seed-guild";
const GUILD_NAME = "Smoke Discord Mirror Guild";
const POST_COUNT = 4;
const CARD_COUNT = 3;
const TIMEOUT_MS = 30_000;

/** The slice of `GuildDiscordMirrorDto` this smoke reads. */
interface MirrorMessage {
  messageId: string;
  content: string;
}
interface MirrorResponse {
  state: string;
  channel?: { id: string; url: string };
  messages?: MirrorMessage[];
}

const mirrorRoute = (guildId: number) => `/plugins/wow/guilds/${guildId}/discord`;

function pickMirrorChannel(ctx: TestContext): DiscordChannel {
  const channel = pickJoinPostChannel(ctx.textChannels, ctx.defaultChannelId);
  if (!channel) {
    throw new SmokeAssertionError(
      `ROK-1788 needs a non-default text channel; ` +
        `textChannels=${String(ctx.textChannels.length)}`,
    );
  }
  return channel;
}

async function seedGuild(ctx: TestContext): Promise<number> {
  const body = await ctx.api.post<{ guildId?: unknown }>(SEED_GUILD, {
    name: GUILD_NAME,
  });
  if (typeof body.guildId !== "number") {
    throw new SmokeAssertionError(`seed-guild: no guildId in ${JSON.stringify(body)}`);
  }
  return body.guildId;
}

/** Post the tokened messages oldest-first; every sent message is recorded. */
async function postTokens(channelId: string, sent: Message[]): Promise<string[]> {
  const run = Date.now().toString(36);
  const tokens = Array.from(
    { length: POST_COUNT },
    (_, i) => `ROK-1788 mirror smoke ${run} #${String(i + 1)}`,
  );
  const channel = getTextChannel(channelId);
  for (const token of tokens) sent.push(await channel.send(token));
  return tokens;
}

/** The card's view: the last three wire messages' contents. */
function cardContents(res: MirrorResponse): string[] {
  return (res.messages ?? []).slice(-CARD_COUNT).map((m) => m.content);
}

function matchesExpected(res: MirrorResponse, expected: string[]): boolean {
  const got = cardContents(res);
  return (
    res.state === "ok" &&
    got.length === expected.length &&
    got.every((c, i) => c === expected[i])
  );
}

/** Poll the mirror until its latest three are `expected`; fail naming what it held. */
async function expectMirror(
  ctx: TestContext,
  guildId: number,
  expected: string[],
): Promise<MirrorResponse> {
  let last: MirrorResponse | null = null;
  try {
    return await pollForCondition(async () => {
      last = await ctx.api.get<MirrorResponse>(mirrorRoute(guildId));
      return matchesExpected(last, expected) ? last : null;
    }, TIMEOUT_MS);
  } catch {
    const seen = last === null ? "no response" : describe(last);
    throw new SmokeAssertionError(
      `mirror for guild ${String(guildId)}: expected state=ok with latest ` +
        `[${expected.join(" | ")}], got ${seen}`,
    );
  }
}

function describe(res: MirrorResponse): string {
  return `state=${res.state} latest=[${cardContents(res).join(" | ")}]`;
}

/** The mirror's ids match the bot's sends, and the link opens the channel. */
function expectIdsAndLink(
  res: MirrorResponse,
  sent: Message[],
  channelId: string,
): void {
  const wantIds = sent.slice(-CARD_COUNT).map((m) => m.id);
  const gotIds = (res.messages ?? []).slice(-CARD_COUNT).map((m) => m.messageId);
  if (gotIds.join() !== wantIds.join()) {
    throw new SmokeAssertionError(
      `mirror message ids: expected [${wantIds.join()}], got [${gotIds.join()}]`,
    );
  }
  if (res.channel?.id !== channelId || !res.channel.url.endsWith(`/${channelId}`)) {
    throw new SmokeAssertionError(
      `mirror channel: expected id ${channelId} + Open-in-Discord link ending ` +
        `/${channelId}, got ${JSON.stringify(res.channel)}`,
    );
  }
}

/** Unbind + delete the bot's own posts; never mask the failure that got us here. */
async function cleanup(
  ctx: TestContext,
  guildId: number | null,
  sent: Message[],
): Promise<void> {
  if (guildId !== null) {
    await ctx.api.delete(`${mirrorRoute(guildId)}/channel`).catch((err: unknown) => {
      console.warn(`  mirror unbind failed: ${String(err)}`);
    });
  }
  for (const msg of sent) {
    await msg.delete().catch((err: unknown) => {
      console.warn(`  mirror smoke message ${msg.id} delete failed: ${String(err)}`);
    });
  }
}

async function mirrorShowsLatestMessages(ctx: TestContext): Promise<void> {
  const channel = pickMirrorChannel(ctx);
  const sent: Message[] = [];
  let guildId: number | null = null;
  try {
    guildId = await seedGuild(ctx);
    const tokens = await postTokens(channel.id, sent);
    // privateAck: harmless for a public channel; admin is staff for a private one.
    await ctx.api.put(`${mirrorRoute(guildId)}/channel`, {
      channelId: channel.id,
      privateAck: true,
    });
    const res = await expectMirror(ctx, guildId, tokens.slice(-CARD_COUNT));
    expectIdsAndLink(res, sent, channel.id);
  } finally {
    await cleanup(ctx, guildId, sent);
  }
}

export const guildDiscordMirrorTests: SmokeTest[] = [
  {
    name: "guild-discord-mirror: bound channel shows the latest 3 messages (ROK-1788)",
    category: "flow",
    serial: true,
    run: mirrorShowsLatestMessages,
  },
];
