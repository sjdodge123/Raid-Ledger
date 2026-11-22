/**
 * ROK-2208 (S2) — the hub forum's Discord forum binding against the real
 * Discord guild:
 *   1. create: hub A asks Raid Ledger's bot to make a forum; it exists, and
 *      (OQ-9) the bot's `fetchWebhooks()` hands back the token of the webhook
 *      it made — so nothing is stored. Unbind with deleteForum removes it,
 *      and (ROK-2296) deletes the bot's webhook first.
 *   2. share: the companion bot makes a run-scoped forum
 *      `rl-smoke-forum-<runId>`; hub A binds it, hub B joins it — the forum
 *      gains a tag per hub and Require tags.
 *   3. unbind: B leaves with deleteForum (shared + not bot-made ⇒ the forum
 *      stays, B's tag stays), then A leaves — the last hub out, so
 *      (ROK-2296) the bot's webhook on the forum is deleted.
 * Every channel is found by the id the API returned or the one this test
 * made — never by position. Teardown deletes both forums and both bindings.
 */
import { AuditLogEvent, ChannelFlags, ChannelType, type ForumChannel } from "discord.js";
import { getGuild } from "../../client.js";
import { pollForCondition } from "../../helpers/polling.js";
import { SmokeAssertionError } from "../assert.js";
import type { SmokeTest, TestContext } from "../types.js";

const SEED_GUILD = "/admin/test/wow/seed-guild";
const TIMEOUT_MS = 30_000;
const ACK = { ack: true } as const;

/** The slice of `HubForumDiscordStatus` this smoke reads. */
interface Binding {
  channelId: string;
  managed: boolean;
  shared: boolean;
  tagName: string | null;
}
interface Status {
  binding: Binding | null;
}
interface TokenProbe {
  webhookId: string | null;
  tokenPresent: boolean;
}

/** What teardown must undo, filled in as soon as each thing exists. */
interface Made {
  hubs: number[];
  forums: string[];
}

const route = (hubId: number) => `/guilds/${String(hubId)}/forum-discord`;

function fail(what: string, got: unknown): never {
  throw new SmokeAssertionError(`${what}; got ${JSON.stringify(got)}`);
}

async function seedHub(ctx: TestContext, name: string, made: Made): Promise<number> {
  const body = await ctx.api.post<{ guildId?: unknown }>(SEED_GUILD, { name });
  if (typeof body.guildId !== "number") fail("seed-guild: no guildId", body);
  made.hubs.push(body.guildId);
  return body.guildId;
}

async function bind(ctx: TestContext, hubId: number, body: object): Promise<Binding> {
  const res = await ctx.api.put<Status>(route(hubId), { ...body, ...ACK });
  if (!res.binding) fail(`PUT ${route(hubId)}: expected a binding`, res);
  return res.binding;
}

/** The forum as Discord serves it now (cache bypassed); null once gone. */
async function fetchForum(channelId: string): Promise<ForumChannel | null> {
  const ch = await getGuild()
    .channels.fetch(channelId, { force: true })
    .catch(() => null);
  return ch?.type === ChannelType.GuildForum ? ch : null;
}

async function expectForum(
  channelId: string,
  ok: (f: ForumChannel) => boolean,
  what: string,
): Promise<ForumChannel> {
  let last: ForumChannel | null = null;
  try {
    return await pollForCondition(async () => {
      last = await fetchForum(channelId);
      return last && ok(last) ? last : null;
    }, TIMEOUT_MS);
  } catch {
    return fail(`forum ${channelId}: expected ${what}`, describe(last));
  }
}

async function expectGone(channelId: string): Promise<void> {
  try {
    await pollForCondition(
      async () => ((await fetchForum(channelId)) === null ? true : null),
      TIMEOUT_MS,
    );
  } catch {
    fail(`forum ${channelId}: expected it deleted`, "still there");
  }
}

/**
 * ROK-2296: a deleted channel's webhooks keep counting toward the guild's
 * 1000-webhook cap, so the unlink must delete the bot's webhook itself. The
 * test bot lacks Manage Webhooks (it cannot list them), so the guild audit log
 * (View Audit Log) is the witness: a WEBHOOK_DELETE entry for that id.
 */
async function expectWebhookDeleted(webhookId: string): Promise<void> {
  let lastErr: unknown = null;
  try {
    await pollForCondition(async () => {
      const log = await getGuild()
        .fetchAuditLogs({ type: AuditLogEvent.WebhookDelete, limit: 50 })
        .catch((err: unknown) => {
          lastErr = err;
          return null;
        });
      return log?.entries.some((e) => e.targetId === webhookId) ? true : null;
    }, TIMEOUT_MS);
  } catch {
    fail(
      `ROK-2296: the last unbind must delete the bot's webhook ${webhookId} (no WEBHOOK_DELETE audit entry)`,
      lastErr === null ? "no entry" : String(lastErr),
    );
  }
}

function describe(f: ForumChannel | null): unknown {
  if (!f) return null;
  return {
    name: f.name,
    tags: f.availableTags.map((t) => t.name),
    requireTag: f.flags.has(ChannelFlags.RequireTag),
  };
}

const tagNames = (f: ForumChannel) => f.availableTags.map((t) => t.name);

/** Phase 1: create, OQ-9 token probe, unbind with deleteForum. */
async function createPhase(ctx: TestContext, runId: string, made: Made) {
  const hub = await seedHub(ctx, `SF-C ${runId}`, made);
  const b = await bind(ctx, hub, { mode: "create" });
  made.forums.push(b.channelId);
  if (!b.managed || b.shared) fail("create: expected managed + unshared", b);
  await expectForum(b.channelId, () => true, "a GuildForum");
  const probe = await ctx.api.get<TokenProbe>(
    `/admin/test/hub-forum-discord/${String(hub)}/webhook-token`,
  );
  if (!probe.webhookId || !probe.tokenPresent) {
    fail("OQ-9: fetchWebhooks must return the bot-made webhook's token", probe);
  }
  await ctx.api.delete(`${route(hub)}?deleteForum=true`);
  await expectGone(b.channelId);
  await expectWebhookDeleted(probe.webhookId);
}

/** Phase 2 + 3: two hubs share a run-scoped forum, then leave. */
async function sharePhase(ctx: TestContext, runId: string, made: Made) {
  const forum = await getGuild().channels.create({
    name: `rl-smoke-forum-${runId}`,
    type: ChannelType.GuildForum,
    reason: "ROK-2208 smoke",
  });
  made.forums.push(forum.id);
  const [nameA, nameB] = [`SF-A ${runId}`, `SF-B ${runId}`];
  const a = await seedHub(ctx, nameA, made);
  const b = await seedHub(ctx, nameB, made);
  const first = await bind(ctx, a, { mode: "existing", channelId: forum.id });
  if (first.shared || first.managed) fail("hub A: expected unshared, unmanaged", first);
  const second = await bind(ctx, b, { mode: "existing", channelId: forum.id });
  if (!second.shared || second.tagName !== nameB) fail(`hub B: expected shared + tag ${nameB}`, second);
  await expectForum(
    forum.id,
    (f) => tagNames(f).includes(nameA) && tagNames(f).includes(nameB) && f.flags.has(ChannelFlags.RequireTag),
    `tags [${nameA}, ${nameB}] and Require tags`,
  );
  await unbindPhase(ctx, { a, b, forumId: forum.id, nameB });
}

async function unbindPhase(
  ctx: TestContext,
  p: { a: number; b: number; forumId: string; nameB: string },
) {
  await ctx.api.delete(`${route(p.b)}?deleteForum=true`);
  const afterB = await ctx.api.get<Status>(route(p.b));
  if (afterB.binding !== null) fail("hub B: expected unbound", afterB);
  const a = await ctx.api.get<Status>(route(p.a));
  if (!a.binding || a.binding.shared) fail("hub A: expected bound, no longer shared", a);
  // ROK-2296: the last hub out frees the bot's webhook on an unmanaged forum.
  const probe = await ctx.api.get<TokenProbe>(
    `/admin/test/hub-forum-discord/${String(p.a)}/webhook-token`,
  );
  if (!probe.webhookId) fail("hub A: expected the shared forum's webhook", probe);
  await ctx.api.delete(route(p.a));
  await expectWebhookDeleted(probe.webhookId);
  const forum = await fetchForum(p.forumId);
  if (!forum || !tagNames(forum).includes(p.nameB)) {
    fail("an unmanaged forum (and B's tag) must survive unbind", describe(forum));
  }
}

/** Best-effort undo; never masks the failure that got us here. */
async function teardown(ctx: TestContext, made: Made): Promise<void> {
  for (const hub of made.hubs) {
    await ctx.api.delete(route(hub)).catch(() => undefined);
  }
  for (const id of made.forums) {
    const forum = await fetchForum(id);
    await forum?.delete("ROK-2208 smoke teardown").catch((err: unknown) => {
      console.warn(`  forum ${id} delete failed: ${String(err)}`);
    });
  }
}

async function forumBinding(ctx: TestContext): Promise<void> {
  const runId = Date.now().toString(36);
  const made: Made = { hubs: [], forums: [] };
  try {
    await createPhase(ctx, runId, made);
    await sharePhase(ctx, runId, made);
  } finally {
    await teardown(ctx, made);
  }
}

export const hubForumDiscordBindingTests: SmokeTest[] = [
  {
    name: "hub-forum-discord: create, share (tags + Require tags), unbind; webhook token re-fetch (ROK-2208)",
    category: "flow",
    serial: true,
    run: forumBinding,
  },
];
