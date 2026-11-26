/**
 * ROK-2208 (S5) — inbound Discord → RL against the real Discord guild (AC8,
 * R7): the hub bound to the run's shared forum (`hub-forum-shared.ts`); the
 * test bot (another bot, so it imports as a Discord guest) opens a post and
 * replies; both appear in the hub Forum with `source: "discord"`, found by
 * this test's run-unique title. No sleep(): every wait is `pollForCondition`
 * on the RL API. The post goes with the shared forum at the run's teardown.
 */
import { pollForCondition } from "../../helpers/polling.js";
import { SmokeAssertionError } from "../assert.js";
import type { SmokeTest, TestContext } from "../types.js";
import { sharedHubForum } from "./hub-forum-shared.js";

const TIMEOUT_MS = 30_000;

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
  const { forum, hub } = await sharedHubForum(ctx);
  const title = `Inbound smoke ${runId}`;
  const post = await forum.threads.create({
    name: title,
    message: { content: "Posted on Discord" },
  });
  // No per-test delete: the companion bot cannot delete threads (50013); the
  // shared forum's teardown removes the post with the channel.
  const threadId = await expectThread(ctx, hub, title);
  const reply = `Discord reply ${runId}`;
  await post.send(reply);
  await expectReply(ctx, hub, threadId, reply);
}

export const hubForumDiscordInboundTests: SmokeTest[] = [
  {
    name: "hub-forum-discord: Discord post + reply → hub Forum as a guest (ROK-2208)",
    category: "flow",
    serial: true,
    run: inbound,
  },
];
