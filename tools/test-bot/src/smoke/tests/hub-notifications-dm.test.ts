/**
 * ROK-1832 — a group leader's post reaches the group's members as a
 * `hub_leader_post` notification, and its DM carries a "View group" link with
 * "Adjust Notifications" as the last button.
 *
 * Flow: seed a WoW guild (`POST /admin/test/wow/seed-guild`, unique name per
 * run, so the per-guild post cooldown never carries over), make the DM
 * recipient a live member through the kind-aware `POST /admin/test/hub-member`,
 * enable its Discord notifications, then PATCH the GM post as the admin. The
 * recipient's notification row is polled (no sleep) for "New post in <Group>"
 * with this guild's id in its payload.
 *
 * The DM itself cannot be read here: the companion is a bot and Discord refuses
 * bot-to-bot DMs (50007 — see `dm-embed-render.test.ts`). The embed is pinned
 * instead through the DEMO_MODE seam `POST /admin/test/render-dm-embed`, which
 * runs the deployed API's REAL DM builder on the payload the pipeline stored.
 */
import { pollForCondition } from "../../helpers/polling.js";
import { SmokeAssertionError } from "../assert.js";
import { awaitProcessing, getNotificationsFor } from "../fixtures.js";
import type { SmokeTest, TestContext } from "../types.js";

const SEED_GUILD = "/admin/test/wow/seed-guild";
const HUB_MEMBER = "/admin/test/hub-member";
const TYPE = "hub_leader_post";
const ADJUST_LABEL = "Adjust Notifications";
const VIEW_GROUP_LABEL = "View group";
/** `buildNotificationEmbed` prefixes the DM title with the type emoji. */
const DM_TITLE_EMOJI = "📣";
/** discord-api-types ComponentType.Button. */
const BUTTON_COMPONENT_TYPE = 2;
/** `buildAdjustNotificationsUrl`: hub_leader_post → its settings row. */
const ADJUST_URL = /\/profile\/notifications\?type=hub_leader_post#notif-hub_leader_post$/;

interface HubNotification {
  type: string;
  title?: string;
  message?: string;
  payload?: Record<string, unknown>;
}

interface RenderedButton {
  type?: number;
  label?: string;
  url?: string;
}

interface RenderedDm {
  embed: { title?: string };
  components: { components?: RenderedButton[] }[];
}

function fail(msg: string): never {
  throw new SmokeAssertionError(msg);
}

/** Seed a guild with a run-unique name; return its id and name. */
async function seedGroup(ctx: TestContext): Promise<{ guildId: number; name: string }> {
  const name = `Smoke Bell ${Date.now().toString(36)}`;
  const body = await ctx.api.post<{ guildId?: unknown }>(SEED_GUILD, { name });
  if (typeof body.guildId !== "number") {
    fail(`seed-guild: no guildId in ${JSON.stringify(body)}`);
  }
  return { guildId: body.guildId, name };
}

/** Kind-aware live-membership insert for the DM recipient. */
async function addMember(ctx: TestContext, guildId: number, userId: number): Promise<void> {
  const body = await ctx.api.post<{ guildId?: unknown; userId?: unknown }>(HUB_MEMBER, {
    guildId,
    userId,
  });
  if (body.guildId !== guildId || body.userId !== userId) {
    fail(`hub-member: expected { guildId: ${guildId}, userId: ${userId} }, got ${JSON.stringify(body)}`);
  }
}

/** Poll the recipient's rows for this guild's leader-post notification. */
async function waitForLeaderPost(ctx: TestContext, guildId: number): Promise<HubNotification> {
  let seen: HubNotification[] = [];
  try {
    return await pollForCondition(
      async () => {
        const rows = await getNotificationsFor(ctx.api, ctx.dmRecipientUserId, TYPE, 10);
        seen = Array.isArray(rows) ? rows : [];
        return seen.find((n) => n.type === TYPE && n.payload?.guildId === guildId) ?? null;
      },
      ctx.config.timeoutMs,
      { intervalMs: 2000 },
    );
  } catch {
    return fail(
      `no ${TYPE} for user ${ctx.dmRecipientUserId} and guild ${guildId}; ` +
        `saw ${JSON.stringify(seen.map((n) => n.title ?? n.type))}`,
    );
  }
}

function buttons(res: RenderedDm): RenderedButton[][] {
  return res.components.map((r) => (r.components ?? []).filter((b) => b.type === BUTTON_COMPONENT_TYPE));
}

/** The primary (last) row: "View group" → /guilds/<id>, then Adjust Notifications last. */
function assertButtons(res: RenderedDm, guildId: number): void {
  const rows = buttons(res);
  const primary = rows[rows.length - 1] ?? [];
  const labels = primary.map((b) => b.label ?? "");
  const last = primary[primary.length - 1];
  if (last?.label !== ADJUST_LABEL || !ADJUST_URL.test(last.url ?? "")) {
    fail(`expected the last button "${ADJUST_LABEL}" → settings row, got ${JSON.stringify(primary)}`);
  }
  const view = rows.flat().find((b) => b.label === VIEW_GROUP_LABEL);
  if (!view?.url?.endsWith(`/guilds/${guildId}`)) {
    fail(`expected a "${VIEW_GROUP_LABEL}" link to /guilds/${guildId}, got rows ${JSON.stringify(labels)}`);
  }
}

/** Render the stored notification through the real DM builder and check it. */
async function assertDmEmbed(ctx: TestContext, n: HubNotification, guildId: number, name: string): Promise<void> {
  const res = await ctx.api.post<RenderedDm>("/admin/test/render-dm-embed", {
    type: TYPE,
    title: n.title ?? "",
    message: n.message ?? "",
    payload: n.payload ?? {},
  });
  const expected = `${DM_TITLE_EMOJI} New post in ${name}`;
  if (res.embed.title !== expected) {
    fail(`expected the DM title "${expected}", got "${res.embed.title}"`);
  }
  assertButtons(res, guildId);
}

async function leaderPostNotifiesMembers(ctx: TestContext): Promise<void> {
  const { guildId, name } = await seedGroup(ctx);
  await addMember(ctx, guildId, ctx.dmRecipientUserId);
  await ctx.api.post("/admin/test/enable-discord-notifications", { userId: ctx.dmRecipientUserId });
  await ctx.api.patch(`/guilds/${guildId}/profile`, {
    gmPost: `Smoke leader post ${Date.now().toString(36)}\nSecond line.`,
  });
  await awaitProcessing(ctx.api);
  const n = await waitForLeaderPost(ctx, guildId);
  if (n.title !== `New post in ${name}`) {
    fail(`expected the notification title "New post in ${name}", got "${n.title}"`);
  }
  await assertDmEmbed(ctx, n, guildId, name);
}

export const hubNotificationsDmTests: SmokeTest[] = [
  {
    name: "hub-notifications: a leader post notifies members; DM has View group + Adjust last (ROK-1832)",
    category: "dm",
    run: leaderPostNotifiesMembers,
  },
];
