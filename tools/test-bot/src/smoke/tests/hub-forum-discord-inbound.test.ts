/**
 * ROK-2208 (S5) — inbound Discord → RL against the real Discord guild (AC8,
 * R7): a hub bound to a run-scoped forum `rl-smoke-forum-in-<runId>`; the
 * test bot (another bot, so it imports as a Discord guest) opens a post and
 * replies; both appear in the hub Forum with `source: "discord"`. No sleep():
 * every wait is `pollForCondition` on the RL API. Teardown unbinds + deletes.
 */
import { ChannelType } from "discord.js";
import { getGuild } from "../../client.js";
import { pollForCondition } from "../../helpers/polling.js";
import { SmokeAssertionError } from "../assert.js";
import type { SmokeTest, TestContext } from "../types.js";

const SEED_GUILD = "/admin/test/wow/seed-guild";
const TIMEOUT_MS = 30_000;

interface Made {
  hub: number | null;
  forum: string | null;
}

function fail(what: string, got: unknown): never {
  throw new SmokeAssertionError(`${what}; got ${JSON.stringify(got)}`);
}

/** The first object anywhere in `node` whose `title` is `title`. */
function findTitled(
  node: unknown,
  title: string,
): Record<string, unknown> | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findTitled(item, title);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof node !== "object" || node === null) return null;
  const rec = Object.fromEntries(Object.entries(node));
  if (rec.title === title) return rec;
  return findTitled(Object.values(rec), title);
}

async function expectThread(
  ctx: TestContext,
  hub: number,
  title: string,
): Promise<number> {
  let last: unknown = null;
  try {
    return await pollForCondition(async () => {
      last = await ctx.api.get<unknown>(`/guilds/${String(hub)}/forum`);
      const t = findTitled(last, title);
      return t && t.source === "discord" && typeof t.id === "number"
        ? t.id
        : null;
    }, TIMEOUT_MS);
  } catch {
    return fail(`hub forum: expected a Discord-origin thread "${title}"`, last);
  }
}

async function expectReply(
  ctx: TestContext,
  hub: number,
  threadId: number,
  body: string,
): Promise<void> {
  let last = "";
  try {
    await pollForCondition(async () => {
      last = JSON.stringify(
        await ctx.api.get<unknown>(
          `/guilds/${String(hub)}/forum/${String(threadId)}`,
        ),
      );
      return last.includes(body) && last.includes('"source":"discord"')
        ? true
        : null;
    }, TIMEOUT_MS);
  } catch {
    fail(
      `hub forum thread ${String(threadId)}: expected the Discord reply "${body}"`,
      last,
    );
  }
}

async function inbound(ctx: TestContext): Promise<void> {
  const runId = Date.now().toString(36);
  const made: Made = { hub: null, forum: null };
  try {
    const forum = await getGuild().channels.create({
      name: `rl-smoke-forum-in-${runId}`,
      type: ChannelType.GuildForum,
      reason: "ROK-2208 inbound smoke",
    });
    made.forum = forum.id;
    const seeded = await ctx.api.post<{ guildId?: unknown }>(SEED_GUILD, {
      name: `SF-I ${runId}`,
    });
    if (typeof seeded.guildId !== "number")
      fail("seed-guild: no guildId", seeded);
    made.hub = seeded.guildId;
    await ctx.api.put(`/guilds/${String(made.hub)}/forum-discord`, {
      mode: "existing",
      channelId: forum.id,
      ack: true,
    });
    const title = `Inbound smoke ${runId}`;
    const post = await forum.threads.create({
      name: title,
      message: { content: "Posted on Discord" },
    });
    const threadId = await expectThread(ctx, made.hub, title);
    const reply = `Discord reply ${runId}`;
    await post.send(reply);
    await expectReply(ctx, made.hub, threadId, reply);
  } finally {
    await teardown(ctx, made);
  }
}

/** Best-effort undo; never masks the failure that got us here. */
async function teardown(ctx: TestContext, made: Made): Promise<void> {
  if (made.hub !== null) {
    await ctx.api
      .delete(`/guilds/${String(made.hub)}/forum-discord`)
      .catch(() => undefined);
  }
  if (made.forum === null) return;
  const forum = await getGuild()
    .channels.fetch(made.forum, { force: true })
    .catch(() => null);
  await forum?.delete("ROK-2208 smoke teardown").catch((err: unknown) => {
    console.warn(`  forum ${String(made.forum)} delete failed: ${String(err)}`);
  });
}

export const hubForumDiscordInboundTests: SmokeTest[] = [
  {
    name: "hub-forum-discord: Discord post + reply → hub Forum as a guest (ROK-2208)",
    category: "flow",
    serial: true,
    run: inbound,
  },
];
