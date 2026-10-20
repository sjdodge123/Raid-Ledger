/**
 * ROK-1870 — hub proposal notices: a proposal notifies staff with
 * `hub_proposal_submitted` ("Review proposals" → the admin queue), approval
 * notifies the proposer with `hub_proposal_reviewed` ("View hub" →
 * /guilds/<id>), and a rejection carries the admin's reason with no button.
 *
 * The proposer is the smoke admin (staff bypass the A2 Discord-guild check, and
 * staff are notified of every proposal, the admin included), so the test needs
 * no member JWT. Names are run-unique; the approved hub is archived and any
 * proposal still open is withdrawn in `finally`. Nothing is posted to Discord
 * channels, so the shared-guild sweep has nothing to clean.
 *
 * The DM itself cannot be read (bot-to-bot DMs are refused, 50007); the embed is
 * pinned through `POST /admin/test/render-dm-embed`, which runs the deployed
 * API's real DM builder on the payload the pipeline stored.
 */
import { pollForCondition } from "../../helpers/polling.js";
import { SmokeAssertionError } from "../assert.js";
import { resolveConfiguredGame } from "../configured-game.js";
import { awaitProcessing, getNotificationsFor } from "../fixtures.js";
import type { SmokeTest, TestContext } from "../types.js";

const SUBMITTED = "hub_proposal_submitted";
const REVIEWED = "hub_proposal_reviewed";
const ADMIN_QUEUE = "/admin/settings/general/hubs";
/** discord-api-types ComponentType.Button. */
const BUTTON_COMPONENT_TYPE = 2;

interface Notice {
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

/** A registry game — `ctx.games` comes from the smoke admin's characters and is empty on CI. */
async function gameOf(ctx: TestContext): Promise<number> {
  return (await resolveConfiguredGame(ctx)).id;
}

async function propose(ctx: TestContext, gameId: number, name: string): Promise<number> {
  const body = await ctx.api.post<{ id?: unknown }>("/hubs/proposals", {
    gameId,
    name,
    blurb: "Smoke proposal (ROK-1870).",
  });
  if (typeof body.id !== "number") fail(`POST /hubs/proposals: no id in ${JSON.stringify(body)}`);
  return body.id;
}

/** Poll `userId`'s rows for a `type` notice about `proposalId`. */
async function waitForNotice(
  ctx: TestContext,
  userId: number,
  type: string,
  proposalId: number,
): Promise<Notice> {
  let seen: Notice[] = [];
  try {
    return await pollForCondition(
      async () => {
        const rows = await getNotificationsFor(ctx.api, userId, type, 20);
        seen = Array.isArray(rows) ? rows : [];
        return seen.find((n) => n.payload?.proposalId === proposalId) ?? null;
      },
      ctx.config.timeoutMs,
      { intervalMs: 2000 },
    );
  } catch {
    return fail(
      `no ${type} for user ${userId} and proposal ${proposalId}; saw ${JSON.stringify(seen.map((n) => n.title ?? n.type))}`,
    );
  }
}

async function render(ctx: TestContext, n: Notice): Promise<RenderedButton[]> {
  const res = await ctx.api.post<RenderedDm>("/admin/test/render-dm-embed", {
    type: n.type,
    title: n.title ?? "",
    message: n.message ?? "",
    payload: n.payload ?? {},
  });
  return res.components.flatMap((r) => (r.components ?? []).filter((b) => b.type === BUTTON_COMPONENT_TYPE));
}

function assertLink(buttons: RenderedButton[], label: string, path: string): void {
  const hit = buttons.find((b) => b.label === label);
  if (!hit?.url?.endsWith(path)) {
    fail(`expected a "${label}" button → ${path}, got ${JSON.stringify(buttons)}`);
  }
}

async function cleanup(ctx: TestContext, approvedId: number | null, openIds: number[]): Promise<void> {
  if (approvedId !== null) {
    await ctx.api.patch(`/hubs/${approvedId}/status`, { status: "archived" }).catch(() => undefined);
  }
  for (const id of openIds) await ctx.api.delete(`/hubs/proposals/${id}`).catch(() => undefined);
}

/** Propose → staff `hub_proposal_submitted`; approve → proposer "View hub". */
async function proposeAndApprove(ctx: TestContext): Promise<void> {
  const name = `Smoke Hub ${Date.now().toString(36)}`;
  const id = await propose(ctx, await gameOf(ctx), name);
  let approved = false;
  try {
    await awaitProcessing(ctx.api);
    const submitted = await waitForNotice(ctx, ctx.testUserId, SUBMITTED, id);
    if (submitted.payload?.url !== ADMIN_QUEUE) fail(`submitted url: ${JSON.stringify(submitted.payload)}`);
    assertLink(await render(ctx, submitted), "Review proposals", ADMIN_QUEUE);

    await ctx.api.post(`/admin/hubs/proposals/${id}/approve`, {});
    approved = true;
    await awaitProcessing(ctx.api);
    const reviewed = await waitForNotice(ctx, ctx.testUserId, REVIEWED, id);
    if (reviewed.payload?.outcome !== "approved" || reviewed.payload?.guildId !== id) {
      fail(`approved payload: ${JSON.stringify(reviewed.payload)}`);
    }
    if (reviewed.title !== `Your hub "${name}" is live`) fail(`approved title: "${reviewed.title}"`);
    assertLink(await render(ctx, reviewed), "View hub", `/guilds/${id}`);
  } finally {
    await cleanup(ctx, approved ? id : null, approved ? [] : [id]);
  }
}

/** Reject → proposer `hub_proposal_reviewed` carrying the reason, no hub button. */
async function proposeAndReject(ctx: TestContext): Promise<void> {
  const name = `Smoke Reject ${Date.now().toString(36)}`;
  const reason = `Smoke reason ${Date.now().toString(36)}`;
  const id = await propose(ctx, await gameOf(ctx), name);
  let rejected = false;
  try {
    await ctx.api.post(`/admin/hubs/proposals/${id}/reject`, { reason });
    rejected = true;
    await awaitProcessing(ctx.api);
    const reviewed = await waitForNotice(ctx, ctx.testUserId, REVIEWED, id);
    if (reviewed.payload?.outcome !== "rejected" || reviewed.payload?.reason !== reason) {
      fail(`rejected payload: ${JSON.stringify(reviewed.payload)}`);
    }
    if (reviewed.message !== reason) fail(`rejected message: "${reviewed.message}" (want the reason)`);
    const buttons = await render(ctx, reviewed);
    if (buttons.some((b) => b.label === "View hub" || b.label === "Review proposals")) {
      fail(`a rejection carries no hub button, got ${JSON.stringify(buttons)}`);
    }
  } finally {
    await cleanup(ctx, null, rejected ? [] : [id]);
  }
}

/** Serial: both propose as the admin on one game (≤1 open proposal per game, D12). */
export const hubProposalNotificationsTests: SmokeTest[] = [
  {
    name: "hub-proposal: propose notifies staff (Review proposals); approve notifies the proposer (View hub) (ROK-1870)",
    category: "dm",
    serial: true,
    run: proposeAndApprove,
  },
  {
    name: "hub-proposal: reject notifies the proposer with the reason and no hub button (ROK-1870)",
    category: "dm",
    serial: true,
    run: proposeAndReject,
  },
];
