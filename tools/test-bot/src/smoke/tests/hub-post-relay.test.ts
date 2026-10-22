/**
 * ROK-1868 §4 — a hub post with `relayToDiscord: true` lands in the hub's bound
 * Discord channel as ONE embed: author line = "📣 <hub name>", title
 * "New post from …", a Discord-safe ~300-char excerpt ending "…", and one
 * "Read more" link button to the post's deep link. Editing the post never
 * touches that message; deleting the post removes it.
 *
 * Channel: the EXISTING non-default text channel `guild-discord-mirror.test.ts`
 * binds (`pickJoinPostChannel`) — never a new channel, never `ci-*` / `slot-*`
 * (ROK-1623). The hub relays to its mirror binding (`findBoundChannelId`), so
 * the bind is the same `PUT /plugins/wow/guilds/:id/discord/channel`. `serial`
 * for the same reason as the mirror smoke: the join-post pool writes there.
 *
 * The body is ~600 chars of markdown with a `**bold**` span sitting across the
 * 300-char cut and a link right behind it, so the excerpt must cut without
 * leaving a dangling `**` or a `](` without its `)`.
 */
import type { Message, TextChannel } from "discord.js";
import { getTextChannel } from "../../client.js";
import { pollForCondition } from "../../helpers/polling.js";
import { SmokeAssertionError } from "../assert.js";
import { pickJoinPostChannel } from "../join-post-channel.js";
import type { DiscordChannel, SmokeTest, TestContext } from "../types.js";

const SEED_GUILD = "/admin/test/wow/seed-guild";
const NAME_PREFIX = "Smoke Relay";
const READ_MORE = "Read more";
/** discord-api-types ComponentType.Button / ButtonStyle.Link. */
const BUTTON = 2;
const LINK_STYLE = 5;
const SCAN_LIMIT = 50;

const mirrorRoute = (guildId: number) => `/plugins/wow/guilds/${guildId}/discord`;
const postsRoute = (guildId: number) => `/guilds/${guildId}/posts`;

interface LinkButton {
  label: string;
  url: string;
}

interface RelayState {
  guildId: number | null;
  postId: number | null;
  messageId: string | null;
  postDeleted: boolean;
}

function fail(msg: string): never {
  throw new SmokeAssertionError(msg);
}

/** 285 plain chars, a bold span over char 300, a link, then plain filler to ~600. */
export function relayBody(run: string): string {
  const filler = (n: number) => `Raid notes ${run}. `.repeat(40).slice(0, n);
  const head = filler(285);
  const bold = "**bold run across the cut**";
  const link = " and [the raid guide](https://example.com/raid-guide) ";
  return `${head}${bold}${link}${filler(600 - head.length - bold.length - link.length)}`;
}

function pickChannel(ctx: TestContext): DiscordChannel {
  const channel = pickJoinPostChannel(ctx.textChannels, ctx.defaultChannelId);
  if (!channel) fail(`ROK-1868 relay needs a non-default text channel; textChannels=${ctx.textChannels.length}`);
  return channel;
}

/** Link buttons of a message, read off its JSON so no discord.js row type is assumed. */
function linkButtons(msg: Message): LinkButton[] {
  const out: LinkButton[] = [];
  for (const row of msg.components) {
    const json: unknown = row.toJSON();
    const items = typeof json === "object" && json !== null && "components" in json ? json.components : [];
    const list: unknown[] = Array.isArray(items) ? items : [];
    for (const b of list) {
      if (typeof b !== "object" || b === null) continue;
      const rec: Record<string, unknown> = Object.fromEntries(Object.entries(b));
      if (rec["type"] === BUTTON && rec["style"] === LINK_STYLE) {
        out.push({ label: String(rec["label"] ?? ""), url: String(rec["url"] ?? "") });
      }
    }
  }
  return out;
}

const deepLinkRe = (guildId: number, postId: number) =>
  new RegExp(`/guilds/${guildId}\\?post=${postId}#posts$`);

/** Every recent channel message whose Read more button opens this post. */
async function messagesForPost(channel: TextChannel, guildId: number, postId: number): Promise<Message[]> {
  const recent = await channel.messages.fetch({ limit: SCAN_LIMIT, cache: false });
  const re = deepLinkRe(guildId, postId);
  return [...recent.values()].filter((m) => linkButtons(m).some((b) => re.test(b.url)));
}

/** Best-effort sweep of relay embeds a crashed earlier run left behind. */
async function sweepStale(channel: TextChannel): Promise<void> {
  const recent = await channel.messages.fetch({ limit: SCAN_LIMIT, cache: false });
  for (const m of recent.values()) {
    if (!m.embeds[0]?.author?.name?.startsWith(`📣 ${NAME_PREFIX}`)) continue;
    await m.delete().catch((err: unknown) => console.warn(`  stale relay ${m.id} delete failed: ${String(err)}`));
  }
}

async function seedAndBind(ctx: TestContext, channelId: string, state: RelayState): Promise<string> {
  const name = `${NAME_PREFIX} ${Date.now().toString(36)}`;
  const body = await ctx.api.post<{ guildId?: unknown }>(SEED_GUILD, { name });
  if (typeof body.guildId !== "number") fail(`seed-guild: no guildId in ${JSON.stringify(body)}`);
  state.guildId = body.guildId;
  await ctx.api.put(`${mirrorRoute(body.guildId)}/channel`, { channelId, privateAck: true });
  return name;
}

async function createRelayedPost(ctx: TestContext, guildId: number, state: RelayState): Promise<void> {
  const res = await ctx.api.post<{ post?: { id?: unknown; relay?: { messageUrl?: unknown } | null }; relayOutcome?: unknown }>(
    postsRoute(guildId),
    { body: relayBody(Date.now().toString(36)), relayToDiscord: true },
  );
  const id = res.post?.id;
  if (typeof id !== "number") fail(`create post: no post.id in ${JSON.stringify(res)}`);
  state.postId = id;
  if (res.relayOutcome !== "sent") fail(`expected relayOutcome "sent", got ${JSON.stringify(res.relayOutcome)}`);
  const url = res.post?.relay?.messageUrl;
  state.messageId = typeof url === "string" ? (url.split("/").pop() ?? null) : null;
}

/** Poll until exactly one relay message for the post exists; return it. */
async function waitForOneRelay(ctx: TestContext, channel: TextChannel, guildId: number, postId: number): Promise<Message> {
  let seen: Message[] = [];
  try {
    return await pollForCondition(async () => {
      seen = await messagesForPost(channel, guildId, postId);
      return seen.length === 1 ? (seen[0] ?? null) : null;
    }, ctx.config.timeoutMs, { intervalMs: 2000 });
  } catch {
    return fail(`expected ONE relay message for post ${postId} in #${channel.name}, saw ${seen.length}`);
  }
}

function assertEmbed(msg: Message, hubName: string, guildId: number, postId: number): void {
  const embed = msg.embeds[0];
  if (!embed) fail(`relay message ${msg.id} has no embed`);
  if (embed.author?.name !== `📣 ${hubName}`) fail(`expected author "📣 ${hubName}", got "${embed.author?.name ?? ""}"`);
  if (!embed.title?.startsWith("New post from ")) fail(`expected title "New post from …", got "${embed.title ?? ""}"`);
  const d = embed.description ?? "";
  if (!d.endsWith("…")) fail(`expected the excerpt to end "…", got "…${d.slice(-40)}"`);
  const stars = (d.match(/\*\*/g) ?? []).length;
  if (stars % 2 !== 0) fail(`expected balanced ** in the excerpt, got ${stars}: "${d.slice(-80)}"`);
  if (/\]\([^)]*$/.test(d)) fail(`excerpt leaves a "](" without its ")": "${d.slice(-80)}"`);
  if (d.includes("<")) fail(`excerpt contains a raw "<": "${d}"`);
  const buttons = linkButtons(msg);
  const only = buttons[0];
  if (buttons.length !== 1 || only?.label !== READ_MORE || !deepLinkRe(guildId, postId).test(only.url)) {
    fail(`expected one "${READ_MORE}" link → /guilds/${guildId}?post=${postId}#posts, got ${JSON.stringify(buttons)}`);
  }
}

/** PATCH never re-sends or edits the Discord message. */
async function assertEditLeavesMessage(ctx: TestContext, channel: TextChannel, msg: Message, guildId: number, postId: number): Promise<void> {
  await ctx.api.patch(`${postsRoute(guildId)}/${postId}`, { body: `Edited **after** the relay ${Date.now().toString(36)}` });
  const after = await messagesForPost(channel, guildId, postId);
  const same = after[0];
  if (after.length !== 1 || same?.id !== msg.id) fail(`after PATCH expected the one message ${msg.id}, got ${after.map((m) => m.id).join()}`);
  if (same.editedTimestamp !== null || same.embeds[0]?.description !== msg.embeds[0]?.description) {
    fail(`PATCH changed the Discord message ${msg.id} (edited=${String(same.editedTimestamp)})`);
  }
}

async function assertDeleteRemovesMessage(ctx: TestContext, channel: TextChannel, state: RelayState, guildId: number, postId: number): Promise<void> {
  await ctx.api.delete(`${postsRoute(guildId)}/${postId}`);
  state.postDeleted = true;
  let left = -1;
  try {
    await pollForCondition(async () => {
      left = (await messagesForPost(channel, guildId, postId)).length;
      return left === 0 ? true : null;
    }, ctx.config.timeoutMs, { intervalMs: 2000 });
  } catch {
    fail(`DELETE post ${postId}: its relay message is still in #${channel.name} (${left} left)`);
  }
}

/** Delete the post (unrelays), unbind, then drop any message still standing; never masks the failure. */
async function cleanup(ctx: TestContext, channel: TextChannel, state: RelayState): Promise<void> {
  const { guildId, postId } = state;
  if (guildId === null) return;
  const warn = (what: string) => (err: unknown) => console.warn(`  relay cleanup ${what} failed: ${String(err)}`);
  if (postId !== null && !state.postDeleted) await ctx.api.delete(`${postsRoute(guildId)}/${postId}`).catch(warn("post delete"));
  await ctx.api.delete(`${mirrorRoute(guildId)}/channel`).catch(warn("unbind"));
  if (postId === null) return;
  const left = await messagesForPost(channel, guildId, postId).catch(() => []);
  for (const m of left) await m.delete().catch(warn(`message ${m.id}`));
}

async function relayPostsOneMessage(ctx: TestContext): Promise<void> {
  const channel = getTextChannel(pickChannel(ctx).id);
  await sweepStale(channel);
  const state: RelayState = { guildId: null, postId: null, messageId: null, postDeleted: false };
  try {
    const hubName = await seedAndBind(ctx, channel.id, state);
    const guildId = state.guildId ?? fail("seed-guild: no guild id recorded");
    await createRelayedPost(ctx, guildId, state);
    const postId = state.postId ?? fail("create post: no post id recorded");
    const msg = await waitForOneRelay(ctx, channel, guildId, postId);
    if (state.messageId !== null && msg.id !== state.messageId) {
      fail(`post.relay.messageUrl names message ${state.messageId}, the channel holds ${msg.id}`);
    }
    assertEmbed(msg, hubName, guildId, postId);
    await assertEditLeavesMessage(ctx, channel, msg, guildId, postId);
    await assertDeleteRemovesMessage(ctx, channel, state, guildId, postId);
  } finally {
    await cleanup(ctx, channel, state);
  }
}

export const hubPostRelayTests: SmokeTest[] = [
  {
    name: "hub-post-relay: a relayed post is one embed with a Read more deep link; edit leaves it, delete removes it (ROK-1868)",
    category: "flow",
    serial: true,
    run: relayPostsOneMessage,
  },
];
