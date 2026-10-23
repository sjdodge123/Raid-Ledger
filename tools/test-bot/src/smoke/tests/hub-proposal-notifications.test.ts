/**
 * ROK-1870 — hub proposal notices: a proposal notifies staff with
 * `hub_proposal_submitted` ("Review proposals" → the admin queue), approval
 * notifies the proposer with `hub_proposal_reviewed` ("View hub" →
 * /guilds/<id>), and a rejection carries the admin's reason with no button.
 *
 * The review path proposes as a NON-staff member — `seed-fixture-user` slot 9
 * with `guildMember: true`, i.e. "in the Discord" (A2). ROK-1892 sends a staff
 * proposal live at once, so an admin proposal never reaches review; that is
 * pinned by its own test below. The smoke admin is still the staff member
 * notified (`ctx.testUserId`) and the one who approves / rejects. Names are
 * run-unique; the approved hub is archived and any proposal still open is
 * withdrawn in `finally`. Nothing is posted to Discord channels, so the
 * shared-guild sweep has nothing to clean.
 *
 * The DM itself cannot be read (bot-to-bot DMs are refused, 50007); the embed is
 * pinned through `POST /admin/test/render-dm-embed`, which runs the deployed
 * API's real DM builder on the payload the pipeline stored.
 */
import { pollForCondition } from "../../helpers/polling.js";
import type { ApiClient } from "../api.js";
import { SmokeAssertionError } from "../assert.js";
import { resolveConfiguredGame } from "../configured-game.js";
import {
  assertConditionNeverMet,
  awaitProcessing,
  getNotificationsFor,
  seedFixtureUser,
  type FixtureUser,
} from "../fixtures.js";
import type { SmokeTest, TestContext } from "../types.js";

const SUBMITTED = "hub_proposal_submitted";
const REVIEWED = "hub_proposal_reviewed";
const ADMIN_QUEUE = "/admin/settings/general/hubs";
/** Fixture slot of the proposing member (distinct from every other smoke's slot). */
const PROPOSER_SLOT = 9;
/** How long a staff proposal must stay notice-free (the review path lands well inside it). */
const NO_NOTICE_WINDOW_MS = 10_000;
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

interface ProposalBody {
  id?: unknown;
  status?: unknown;
}

/** POST a proposal as whoever `api` is; the raw body (id + ROK-1892 status). */
async function proposeAs(api: ApiClient, gameId: number, name: string): Promise<ProposalBody> {
  return api.post<ProposalBody>("/hubs/proposals", { gameId, name, blurb: "Smoke proposal (ROK-1870)." });
}

async function propose(api: ApiClient, gameId: number, name: string): Promise<number> {
  const body = await proposeAs(api, gameId, name);
  if (typeof body.id !== "number") fail(`POST /hubs/proposals: no id in ${JSON.stringify(body)}`);
  return body.id;
}

/** A non-staff proposer who is "in the Discord" (A2). */
async function proposer(ctx: TestContext): Promise<FixtureUser> {
  return seedFixtureUser(ctx.api, 3, PROPOSER_SLOT, { guildMember: true });
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

/** Archive the live hub (admin); the proposer withdraws anything still open. */
async function cleanup(ctx: TestContext, by: ApiClient, approvedId: number | null, openIds: number[]): Promise<void> {
  if (approvedId !== null) {
    await ctx.api.patch(`/hubs/${approvedId}/status`, { status: "archived" }).catch(() => undefined);
  }
  for (const id of openIds) await by.delete(`/hubs/proposals/${id}`).catch(() => undefined);
}

/** Member proposes → staff `hub_proposal_submitted`; approve → proposer "View hub". */
async function proposeAndApprove(ctx: TestContext): Promise<void> {
  const name = `Smoke Hub ${Date.now().toString(36)}`;
  const member = await proposer(ctx);
  const id = await propose(member.api, await gameOf(ctx), name);
  let approved = false;
  try {
    await awaitProcessing(ctx.api);
    const submitted = await waitForNotice(ctx, ctx.testUserId, SUBMITTED, id);
    if (submitted.payload?.url !== ADMIN_QUEUE) fail(`submitted url: ${JSON.stringify(submitted.payload)}`);
    assertLink(await render(ctx, submitted), "Review proposals", ADMIN_QUEUE);

    await ctx.api.post(`/admin/hubs/proposals/${id}/approve`, {});
    approved = true;
    await awaitProcessing(ctx.api);
    const reviewed = await waitForNotice(ctx, member.userId, REVIEWED, id);
    if (reviewed.payload?.outcome !== "approved" || reviewed.payload?.guildId !== id) {
      fail(`approved payload: ${JSON.stringify(reviewed.payload)}`);
    }
    if (reviewed.title !== `Your hub "${name}" is live`) fail(`approved title: "${reviewed.title}"`);
    assertLink(await render(ctx, reviewed), "View hub", `/guilds/${id}`);
  } finally {
    await cleanup(ctx, member.api, approved ? id : null, approved ? [] : [id]);
  }
}

/** Reject → proposer `hub_proposal_reviewed` carrying the reason, no hub button. */
async function proposeAndReject(ctx: TestContext): Promise<void> {
  const name = `Smoke Reject ${Date.now().toString(36)}`;
  const reason = `Smoke reason ${Date.now().toString(36)}`;
  const member = await proposer(ctx);
  const id = await propose(member.api, await gameOf(ctx), name);
  let rejected = false;
  try {
    await ctx.api.postNoContent(`/admin/hubs/proposals/${id}/reject`, { reason });
    rejected = true;
    await awaitProcessing(ctx.api);
    const reviewed = await waitForNotice(ctx, member.userId, REVIEWED, id);
    if (reviewed.payload?.outcome !== "rejected" || reviewed.payload?.reason !== reason) {
      fail(`rejected payload: ${JSON.stringify(reviewed.payload)}`);
    }
    if (reviewed.message !== reason) fail(`rejected message: "${reviewed.message}" (want the reason)`);
    const buttons = await render(ctx, reviewed);
    if (buttons.some((b) => b.label === "View hub" || b.label === "Review proposals")) {
      fail(`a rejection carries no hub button, got ${JSON.stringify(buttons)}`);
    }
  } finally {
    await cleanup(ctx, member.api, null, rejected ? [] : [id]);
  }
}

/** True when `userId` holds a `type` notice about `proposalId`. */
async function hasNotice(ctx: TestContext, userId: number, type: string, proposalId: number): Promise<boolean> {
  const rows: Notice[] = await getNotificationsFor(ctx.api, userId, type, 20);
  return Array.isArray(rows) && rows.some((n) => n.payload?.proposalId === proposalId);
}

/** ROK-1892 — a staff proposal is `active` at once: no review notice, nothing pending. */
async function staffProposalIsLive(ctx: TestContext): Promise<void> {
  const name = `Smoke Staff Hub ${Date.now().toString(36)}`;
  const body = await proposeAs(ctx.api, await gameOf(ctx), name);
  if (typeof body.id !== "number") fail(`POST /hubs/proposals: no id in ${JSON.stringify(body)}`);
  const id = body.id;
  try {
    if (body.status !== "active") fail(`staff proposal status: ${JSON.stringify(body.status)} (want "active")`);
    await awaitProcessing(ctx.api);
    await assertConditionNeverMet(
      () => hasNotice(ctx, ctx.testUserId, SUBMITTED, id),
      NO_NOTICE_WINDOW_MS,
      `a staff proposal sent ${SUBMITTED} for proposal ${id}`,
    );
    const mine = await ctx.api.get<{ items?: { id?: unknown; status?: unknown }[] }>("/hubs/proposals/mine");
    if ((mine.items ?? []).some((p) => p.id === id && p.status !== "active")) {
      fail(`staff proposal ${id} is still pending: ${JSON.stringify(mine.items)}`);
    }
  } finally {
    await cleanup(ctx, ctx.api, id, []);
  }
}

/** Serial: all propose on one game (≤1 open proposal per game, D12). */
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
  {
    name: "hub-proposal: a staff proposal is live at once — no review notice, nothing pending (ROK-1892)",
    category: "dm",
    serial: true,
    run: staffProposalIsLive,
  },
];
