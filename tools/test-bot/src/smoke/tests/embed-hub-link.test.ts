/**
 * ROK-1428 (L10, ROK-1872 / spec §2.8 D15–D16) — the event card's 5th Link
 * button "Hub": a game with a visible server hub gets a Link button labelled
 * "Hub" whose URL ends `/guilds/<hubId>`; a game with no hub gets none, and
 * its card carries exactly one component fewer.
 *
 * Both games are seeded fresh per run (`smoke-hub <run>` / `smoke-nohub <run>`)
 * via `/admin/test/channel-lifecycle/seed`, so neither has a binding and both
 * cards land in the default notification channel. The hub link needs the
 * API's CLIENT_URL (no CLIENT_URL ⇒ no link, by design).
 */
import { pollForEmbed } from "../../helpers/polling.js";
import type { SimpleComponent, SimpleMessage } from "../../helpers/messages.js";
import { SmokeAssertionError } from "../assert.js";
import { awaitProcessing, channelForGame, createEvent, deleteEvent, flushEmbedQueue } from "../fixtures.js";
import type { SmokeTest, TestContext } from "../types.js";

const SEED = "/admin/test/channel-lifecycle/seed";
const HUB_LABEL = "Hub";

interface SeedResult { gameId: number; hubId: number | null }

function mentions(msg: SimpleMessage, title: string): boolean {
  return msg.embeds.some((e) =>
    [e.title ?? "", e.description ?? "", ...e.fields.map((f) => `${f.name} ${f.value}`)].join(" ").includes(title),
  );
}

/** Create an event for the game and poll its channel card. */
async function postCard(ctx: TestContext, gameId: number, eventIds: number[]): Promise<SimpleMessage> {
  const event = await createEvent(ctx.api, "hub-link", { gameId });
  eventIds.push(event.id);
  await awaitProcessing(ctx.api);
  await flushEmbedQueue(ctx.api);
  return pollForEmbed(channelForGame(ctx, gameId), (m) => mentions(m, event.title), ctx.config.timeoutMs);
}

function hubButtons(msg: SimpleMessage): SimpleComponent[] {
  return msg.components.filter((c) => c.label === HUB_LABEL);
}

async function seed(ctx: TestContext, gameName: string, withHub: boolean): Promise<SeedResult> {
  return ctx.api.post<SeedResult>(SEED, { gameName, serverHubWithoutChannel: withHub });
}

function expectHubButton(card: SimpleMessage, hubId: number): void {
  const [button, ...extra] = hubButtons(card);
  if (!button || extra.length > 0) {
    throw new SmokeAssertionError(`expected one "Hub" button, got ${JSON.stringify(card.components)}`);
  }
  if (button.customId !== null || !(button.url ?? "").endsWith(`/guilds/${String(hubId)}`)) {
    throw new SmokeAssertionError(`"Hub" must be a Link to /guilds/${String(hubId)}, got ${JSON.stringify(button)}`);
  }
}

async function eventCardHubLink(ctx: TestContext): Promise<void> {
  const run = Date.now().toString(36);
  const eventIds: number[] = [];
  try {
    const hubGame = await seed(ctx, `smoke-hub ${run}`, true);
    if (hubGame.hubId === null) throw new SmokeAssertionError("seed returned no hubId");
    const bareGame = await seed(ctx, `smoke-nohub ${run}`, false);
    const withHub = await postCard(ctx, hubGame.gameId, eventIds);
    expectHubButton(withHub, hubGame.hubId);
    const withoutHub = await postCard(ctx, bareGame.gameId, eventIds);
    if (hubButtons(withoutHub).length > 0) {
      throw new SmokeAssertionError(`no-hub card has a "Hub" button: ${JSON.stringify(withoutHub.components)}`);
    }
    if (withHub.components.length !== withoutHub.components.length + 1) {
      throw new SmokeAssertionError(
        `hub card should carry exactly one extra component: ${String(withHub.components.length)} vs ${String(withoutHub.components.length)}`,
      );
    }
  } finally {
    for (const id of eventIds) await deleteEvent(ctx.api, id);
  }
}

export const embedHubLinkTests: SmokeTest[] = [
  {
    name: 'embed-hub-link: event card gets a "Hub" Link button only when the game has a hub (ROK-1428)',
    category: "embed",
    run: eventCardHubLink,
  },
];
