/**
 * ROK-2271 — signup lines in an event's Discord thread carry role, character
 * and status; running late and roach-out post AT ONCE (no ~2 min debounce).
 * Each test makes its own run-scoped forum via the ROK-2208 setup (never a
 * shared channel), links the companion bot's Discord id to the signing-up
 * user, and in `finally` tears the forum/event down and re-links the bot to
 * the DM recipient (the link setup made for every other test).
 * Wording comes from `api/src/guilds/forum/discord/hub-forum-discord-signup-lines.copy.ts`;
 * only stable text is matched, never emoji.
 */
import type { ThreadChannel } from "discord.js";
import { pollForCondition } from "../../helpers/polling.js";
import { cancelSignupAs, createEvent, futureTime, linkDiscord, signupAs, updateSignupStatus } from "../fixtures.js";
import type { SmokeTest, TestContext } from "../types.js";
import { farOffTimes, fail, flushPings, setup, teardown, TIMEOUT_MS, type Made } from "./hub-forum-discord-outbound.test.js";

/** Well under the 2-minute debounce, so a line seen inside it was urgent. */
const URGENT_WINDOW_MS = 45_000;
const MMO_SLOTS = { type: "mmo", tank: 1, healer: 1, dps: 3, flex: 0, bench: 1 };
export const BOT_NAME = "SmokeTestBot";

interface SeededMember {
  userId: number;
  characterId: string;
}

/** The seed-guild cast's `member`: a user with a character in the hub game. */
export function seededMember(users: unknown): SeededMember {
  const member: unknown = typeof users === "object" && users !== null ? Reflect.get(users, "member") : null;
  const userId: unknown = typeof member === "object" && member !== null ? Reflect.get(member, "userId") : null;
  const characterId: unknown = typeof member === "object" && member !== null ? Reflect.get(member, "characterId") : null;
  if (typeof userId !== "number" || typeof characterId !== "string") return fail("seed-guild: no member with a character", users);
  return { userId, characterId };
}

/** Bot (non-webhook) message contents in the post, newest first. */
async function botLines(post: ThreadChannel): Promise<string[]> {
  const msgs = await post.messages.fetch({ limit: 30 });
  return msgs.filter((m) => m.author.bot && !m.webhookId).map((m) => m.content);
}

/** Poll until one bot line in the post satisfies `match`; returns it. */
async function expectLine(post: ThreadChannel, match: (line: string) => boolean, why: string, timeoutMs = TIMEOUT_MS): Promise<string> {
  let seen: string[] = [];
  try {
    return await pollForCondition(async () => {
      seen = await botLines(post);
      return seen.find(match) ?? null;
    }, timeoutMs);
  } catch {
    return fail(`ROK-2271 ${why} (post ${post.id})`, seen);
  }
}

/** Put the companion bot's Discord link back on the DM recipient. */
export async function relinkDmRecipient(ctx: TestContext): Promise<void> {
  await linkDiscord(ctx.api, ctx.dmRecipientUserId, ctx.testBotDiscordId, BOT_NAME).catch((err: unknown) => {
    console.warn(`  re-link of the DM recipient failed: ${String(err)}`);
  });
}

interface DiscordLink {
  discordId: string;
  username: string;
}

/**
 * The API user's own Discord link, read before a test points that user at the
 * companion bot. Null when there is none, or when it already is the bot's.
 */
async function ownDiscordLink(ctx: TestContext): Promise<DiscordLink | null> {
  const profile: unknown = await ctx.api.get<unknown>("/auth/me");
  const discordId: unknown = typeof profile === "object" && profile !== null ? Reflect.get(profile, "discordId") : null;
  const username: unknown = typeof profile === "object" && profile !== null ? Reflect.get(profile, "username") : null;
  if (typeof discordId !== "string" || typeof username !== "string" || discordId === ctx.testBotDiscordId) return null;
  return { discordId, username };
}

/**
 * Give the API user its own Discord id and name back. `relinkDmRecipient`
 * leaves that user with NO Discord id, and later categories on the same DB
 * (ROK-943 voice classification) count the event creator by Discord id.
 */
async function restoreOwnLink(ctx: TestContext, link: DiscordLink | null): Promise<void> {
  if (!link) return;
  await linkDiscord(ctx.api, ctx.testUserId, link.discordId, link.username).catch((err: unknown) => {
    console.warn(`  restore of the API user's Discord link failed: ${String(err)}`);
  });
}

function characterName(res: unknown): string {
  const ch: unknown = typeof res === "object" && res !== null ? Reflect.get(res, "character") : null;
  const name: unknown = typeof ch === "object" && ch !== null ? Reflect.get(ch, "name") : null;
  if (typeof name !== "string" || name === "") return fail("signup response: no character name", res);
  return name;
}

async function firstLineRoleCharacter(ctx: TestContext): Promise<void> {
  const runId = Date.now().toString(36);
  const made: Made = { hub: null, forum: null };
  const me = ctx.testBotDiscordId;
  try {
    const { hub, gameId, users } = await setup(ctx, runId, made);
    const member = seededMember(users);
    await linkDiscord(ctx.api, member.userId, me, BOT_NAME);
    const event = await createEvent(ctx.api, "signup-lines", { guildId: hub, gameId, slotConfig: MMO_SLOTS, ...farOffTimes() });
    made.event = event.id;
    const res = await signupAs(ctx.api, event.id, member.userId, ["tank"], { characterId: member.characterId });
    const name = characterName(res);
    const post = await flushPings(ctx, event.id);
    await expectLine(
      post,
      (l) => l.includes(`<@${me}>`) && l.includes("signed up") && l.includes("Tank") && l.includes(name),
      `first line: expected <@${me}> "signed up" with role "Tank" and character "${name}"`,
    );
  } finally {
    await teardown(ctx, made);
    await relinkDmRecipient(ctx);
  }
}

async function tentativeThenConfirmed(ctx: TestContext): Promise<void> {
  const runId = Date.now().toString(36);
  const made: Made = { hub: null, forum: null };
  const me = ctx.testBotDiscordId;
  const own = await ownDiscordLink(ctx);
  try {
    const { hub, gameId } = await setup(ctx, runId, made);
    await linkDiscord(ctx.api, ctx.testUserId, me, BOT_NAME);
    const event = await createEvent(ctx.api, "signup-confirm", { guildId: hub, gameId, ...farOffTimes() });
    made.event = event.id;
    await updateSignupStatus(ctx.api, event.id, "tentative");
    const post = await flushPings(ctx, event.id);
    // ROK-2273: the line leads with the embed's tentative glyph, not a second vocabulary.
    await expectLine(post, (l) => l.startsWith("⏳ ") && l.includes(`<@${me}>`) && l.includes("is tentative"), `first line: expected "⏳ <@${me}> … is tentative"`);
    await updateSignupStatus(ctx.api, event.id, "signed_up");
    await flushPings(ctx, event.id);
    const line = await expectLine(post, (l) => l.includes("is confirmed (was tentative)"), 'expected an "is confirmed (was tentative)" line');
    if (line.includes("<@")) fail("ROK-2271: a later line must not @mention again", line);
  } finally {
    await teardown(ctx, made);
    await relinkDmRecipient(ctx);
    await restoreOwnLink(ctx, own);
  }
}

/** Move the event to start in 3 h, so a cancel now is a roach-out (< 24 h). */
async function moveInside24h(ctx: TestContext, eventId: number): Promise<void> {
  await ctx.api.post("/admin/test/set-event-times", {
    eventId,
    startTime: futureTime(3 * 60),
    endTime: futureTime(5 * 60),
  });
}

async function lateAndRoachOutAtOnce(ctx: TestContext): Promise<void> {
  const runId = Date.now().toString(36);
  const made: Made = { hub: null, forum: null };
  const me = ctx.testBotDiscordId;
  try {
    const { hub, gameId, users } = await setup(ctx, runId, made);
    const member = seededMember(users);
    await linkDiscord(ctx.api, member.userId, me, BOT_NAME);
    const event = await createEvent(ctx.api, "signup-urgent", { guildId: hub, gameId, ...farOffTimes() });
    made.event = event.id;
    await signupAs(ctx.api, event.id, member.userId);
    const post = await flushPings(ctx, event.id);
    await expectLine(post, (l) => l.includes(`<@${me}>`) && l.includes("signed up"), `first line: expected <@${me}> "signed up"`);
    await ctx.api.post("/admin/test/running-late", { eventId: event.id, userId: member.userId, minutes: 15 });
    const late = await expectLine(post, (l) => l.includes("is running late"), "running late must post at once, no forced flush", URGENT_WINDOW_MS);
    if (late.includes("<@")) fail("ROK-2271: the late line must not @mention again", late);
    await moveInside24h(ctx, event.id);
    await cancelSignupAs(ctx.api, event.id, member.userId);
    await expectLine(post, (l) => l.includes("roached out"), "roach-out must post at once, no forced flush", URGENT_WINDOW_MS);
  } finally {
    await teardown(ctx, made);
    await relinkDmRecipient(ctx);
  }
}

export const hubForumDiscordSignupLineTests: SmokeTest[] = [
  {
    name: "hub-forum-discord: first signup line names role + character (ROK-2271)",
    category: "flow",
    serial: true,
    run: firstLineRoleCharacter,
  },
  {
    name: "hub-forum-discord: tentative → confirmed line, no second mention (ROK-2271)",
    category: "flow",
    serial: true,
    run: tentativeThenConfirmed,
  },
  {
    name: "hub-forum-discord: running late + roach-out post at once (ROK-2271)",
    category: "flow",
    serial: true,
    run: lateAndRoachOutAtOnce,
  },
];
