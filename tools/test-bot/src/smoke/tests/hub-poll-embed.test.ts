/**
 * ROK-1896 — a hub poll's DM names its hub and links to it, once.
 *
 * Flow: seed the community-hub fixture (`POST /admin/test/community-hubs/seed`
 * — "Seed Crew" is an active community hub), enable the DM recipient's Discord
 * notifications, then create a hub-tagged poll as the admin (staff may tag)
 * picking the recipient (`memberUserIds`). The recipient's
 * `community_lineup` row for this poll is polled (no sleep) and must carry
 * `hubId` + `hubName`; the stored payload is then rendered through the
 * deployed API's REAL DM builder (`POST /admin/test/render-dm-embed`) and the
 * embed must hold exactly one `Hub` Link button → `/hubs/<hubId>` and one
 * `Hub` field naming the hub.
 *
 * Why the DM and not the channel card: since ROK-1893 P3 (ruling 2026-10-23)
 * a hub-tagged poll posts NO default-channel card until P2b routes it to the
 * hub's own channel, so there is no card to read on Discord. The card render
 * is pinned by `hub-poll-embed.integration.spec.ts` instead. The DM itself
 * cannot be read either — Discord refuses bot-to-bot DMs (50007, see
 * `dm-embed-render.test.ts`).
 */
import { pollForCondition } from "../../helpers/polling.js";
import { SmokeAssertionError } from "../assert.js";
import { awaitProcessing, getNotificationsFor } from "../fixtures.js";
import type { SmokeTest, TestContext } from "../types.js";

const SEED = "/admin/test/community-hubs/seed";
/** `SEED_HUB_NAMES.crew` in `demo-test-community-hubs.helpers.ts`. */
const CREW_NAME = "Seed Crew";
const TYPE = "community_lineup";
const HUB_LABEL = "Hub";
/** discord-api-types ComponentType.Button. */
const BUTTON_COMPONENT_TYPE = 2;

interface SeedResult {
  gameId: number;
  hubIds: { crew: number };
}

interface PollNotification {
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
  embed: { fields?: { name?: string; value?: string }[] };
  components: { components?: RenderedButton[] }[];
}

function fail(msg: string): never {
  throw new SmokeAssertionError(msg);
}

async function seedHub(ctx: TestContext): Promise<SeedResult> {
  const body = await ctx.api.post<Partial<SeedResult>>(SEED, {});
  if (typeof body.gameId !== "number" || typeof body.hubIds?.crew !== "number") {
    fail(`community-hubs seed: no gameId / hubIds.crew in ${JSON.stringify(body)}`);
  }
  return { gameId: body.gameId, hubIds: { crew: body.hubIds.crew } };
}

interface CreatedPoll {
  id: number;
  lineupId: number;
}

/** A hub poll picking the DM recipient; returns its match + lineup ids. */
async function createHubPoll(ctx: TestContext, seed: SeedResult): Promise<CreatedPoll> {
  const poll = await ctx.api.post<{ id?: unknown; lineupId?: unknown }>("/scheduling-polls", {
    gameId: seed.gameId,
    hubId: seed.hubIds.crew,
    memberUserIds: [ctx.dmRecipientUserId],
    durationHours: 2,
  });
  if (typeof poll.id !== "number" || typeof poll.lineupId !== "number") {
    fail(`create poll: no id / lineupId in ${JSON.stringify(poll)}`);
  }
  return { id: poll.id, lineupId: poll.lineupId };
}

/**
 * Never leave the open 2h poll behind: in a preserved env its reminders would
 * DM the recipient later. Cancel it, then archive its lineup (best-effort).
 */
async function retirePoll(ctx: TestContext, poll: CreatedPoll): Promise<void> {
  await ctx.api
    .post(`/lineups/${poll.lineupId}/schedule/${poll.id}/cancel`, { reason: "smoke cleanup ROK-1896" })
    .catch(() => null);
  await ctx.api.patch(`/lineups/${poll.lineupId}/status`, { status: "archived" }).catch(() => null);
}

/** Poll the recipient's rows for this poll's DM notification. */
async function waitForPollDm(ctx: TestContext, matchId: number): Promise<PollNotification> {
  let seen: PollNotification[] = [];
  try {
    return await pollForCondition(
      async () => {
        const rows = await getNotificationsFor(ctx.api, ctx.dmRecipientUserId, TYPE, 20);
        seen = Array.isArray(rows) ? rows : [];
        return seen.find((n) => n.payload?.matchId === matchId) ?? null;
      },
      ctx.config.timeoutMs,
      { intervalMs: 2000 },
    );
  } catch {
    return fail(
      `no ${TYPE} row for user ${ctx.dmRecipientUserId} and match ${matchId}; ` +
        `saw ${JSON.stringify(seen.map((n) => n.payload?.subtype ?? n.type))}`,
    );
  }
}

function assertPayloadHub(n: PollNotification, hubId: number): void {
  if (n.payload?.hubId !== hubId || n.payload?.hubName !== CREW_NAME) {
    fail(
      `expected payload hubId ${hubId} + hubName "${CREW_NAME}", got ` +
        `${JSON.stringify({ hubId: n.payload?.hubId, hubName: n.payload?.hubName })}`,
    );
  }
}

/** Exactly one hub link (the Hub button → /hubs/<id>) and one Hub field. */
function assertRendered(res: RenderedDm, hubId: number): void {
  const buttons = res.components
    .flatMap((r) => r.components ?? [])
    .filter((b) => b.type === BUTTON_COMPONENT_TYPE);
  const hubLinks = buttons.filter((b) => /\/hubs(\/|\?)/.test(b.url ?? ""));
  const only = hubLinks[0];
  if (hubLinks.length !== 1 || only?.label !== HUB_LABEL || !only.url?.endsWith(`/hubs/${hubId}`)) {
    fail(`expected exactly one "${HUB_LABEL}" button → /hubs/${hubId}, got ${JSON.stringify(buttons)}`);
  }
  const fields = (res.embed.fields ?? []).filter((f) => f.name === HUB_LABEL);
  if (fields.length !== 1 || fields[0]?.value !== `**${CREW_NAME}**`) {
    fail(`expected one "${HUB_LABEL}" field "**${CREW_NAME}**", got ${JSON.stringify(res.embed.fields)}`);
  }
}

async function hubPollDmNamesHub(ctx: TestContext): Promise<void> {
  const seed = await seedHub(ctx);
  await ctx.api.post("/admin/test/enable-discord-notifications", { userId: ctx.dmRecipientUserId });
  const poll = await createHubPoll(ctx, seed);
  try {
    await awaitProcessing(ctx.api);
    const n = await waitForPollDm(ctx, poll.id);
    assertPayloadHub(n, seed.hubIds.crew);
    const res = await ctx.api.post<RenderedDm>("/admin/test/render-dm-embed", {
      type: TYPE,
      title: n.title ?? "",
      message: n.message ?? "",
      payload: n.payload ?? {},
    });
    assertRendered(res, seed.hubIds.crew);
  } finally {
    await retirePoll(ctx, poll);
  }
}

export const hubPollEmbedTests: SmokeTest[] = [
  {
    name: "hub-poll-embed: a hub poll DM carries one Hub button → /hubs/<id> and a Hub field (ROK-1896)",
    category: "dm",
    run: hubPollDmNamesHub,
  },
];
