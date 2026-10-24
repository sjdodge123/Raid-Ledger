/**
 * ROK-1428 (L10, ROK-1872 / spec §2.8 D15–D16) — the event card's 5th Link
 * button "Hub": a game with a visible server hub gets a Link button labelled
 * "Hub" whose URL ends `/hubs/<hubId>`; a game with no hub gets none, and
 * its card carries exactly one component fewer.
 *
 * Both games are seeded fresh per run (`smoke-hub <run>` / `smoke-nohub <run>`)
 * via `/admin/test/channel-lifecycle/seed`, so neither has a binding and both
 * cards land in the default notification channel. The hub link needs the
 * API's CLIENT_URL (no CLIENT_URL ⇒ no link, by design). The seeded hub is a
 * `game_server` hub, whose kind belongs to the Pelican plugin: the resolver
 * skips hubs of an inactive plugin's kind, so the test turns Pelican on for
 * its run and puts it back afterwards.
 *
 * ROK-1895: a third card, tagged to the hub (`guildId`), must name the hub in
 * its body ("Hub: **<name>**") with the same single Hub button; the untagged
 * card must not.
 */
import { pollForEmbed } from "../../helpers/polling.js";
import type { SimpleComponent, SimpleMessage } from "../../helpers/messages.js";
import { SmokeAssertionError } from "../assert.js";
import { awaitProcessing, channelForGame, createEvent, deleteEvent, flushEmbedQueue } from "../fixtures.js";
import type { SmokeTest, TestContext } from "../types.js";

const SEED = "/admin/test/channel-lifecycle/seed";
const HUB_LABEL = "Hub";
const PELICAN = "pelican";

interface PluginRow { slug: string; status: "not_installed" | "active" | "inactive" }

interface SeedResult { gameId: number; hubId: number | null }

function mentions(msg: SimpleMessage, title: string): boolean {
  return msg.embeds.some((e) =>
    [e.title ?? "", e.description ?? "", ...e.fields.map((f) => `${f.name} ${f.value}`)].join(" ").includes(title),
  );
}

/** Create an event for the game and poll its channel card. */
async function postCard(
  ctx: TestContext,
  gameId: number,
  eventIds: number[],
  extra: Record<string, unknown> = {},
): Promise<SimpleMessage> {
  const event = await createEvent(ctx.api, "hub-link", { gameId, ...extra });
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

/** Activate Pelican (installing it first if needed); returns whether it was already active. */
async function enablePelican(ctx: TestContext): Promise<boolean> {
  const { data } = await ctx.api.get<{ data: PluginRow[] }>("/admin/plugins");
  const status = data.find((p) => p.slug === PELICAN)?.status ?? "not_installed";
  if (status === "active") return true;
  // install activates; activate on an installed-but-inactive plugin.
  const action = status === "not_installed" ? "install" : "activate";
  await ctx.api.post(`/admin/plugins/${PELICAN}/${action}`);
  return false;
}

function expectHubButton(card: SimpleMessage, hubId: number): void {
  const [button, ...extra] = hubButtons(card);
  if (!button || extra.length > 0) {
    throw new SmokeAssertionError(`expected one "Hub" button, got ${JSON.stringify(card.components)}`);
  }
  if (button.customId !== null || !(button.url ?? "").endsWith(`/hubs/${String(hubId)}`)) {
    throw new SmokeAssertionError(`"Hub" must be a Link to /hubs/${String(hubId)}, got ${JSON.stringify(button)}`);
  }
}

/** ROK-1895: the card body's "Hub: **<name>**" line, if any. */
const HUB_LINE = /^Hub: \*\*.+\*\*$/m;

function hasHubLine(card: SimpleMessage): boolean {
  return card.embeds.some((e) => HUB_LINE.test(e.description ?? ""));
}

/**
 * ROK-1895: an event explicitly tagged to the visible hub (`guildId`) names it
 * in the body and keeps exactly one Hub Link button to it; the untagged card
 * of the same game (game-derived hub) has the button but no name line.
 */
async function expectTaggedCard(
  ctx: TestContext,
  hub: { gameId: number; hubId: number },
  untagged: SimpleMessage,
  eventIds: number[],
): Promise<void> {
  if (hasHubLine(untagged)) {
    throw new SmokeAssertionError(`untagged card must not name a hub: ${JSON.stringify(untagged.embeds)}`);
  }
  const tagged = await postCard(ctx, hub.gameId, eventIds, { guildId: hub.hubId });
  expectHubButton(tagged, hub.hubId);
  if (!hasHubLine(tagged)) {
    throw new SmokeAssertionError(`hub-tagged card must carry a "Hub: **<name>**" line: ${JSON.stringify(tagged.embeds)}`);
  }
}

async function eventCardHubLink(ctx: TestContext): Promise<void> {
  const run = Date.now().toString(36);
  const eventIds: number[] = [];
  const wasActive = await enablePelican(ctx);
  try {
    const hubGame = await seed(ctx, `smoke-hub ${run}`, true);
    if (hubGame.hubId === null) throw new SmokeAssertionError("seed returned no hubId");
    const bareGame = await seed(ctx, `smoke-nohub ${run}`, false);
    const withHub = await postCard(ctx, hubGame.gameId, eventIds);
    expectHubButton(withHub, hubGame.hubId);
    await expectTaggedCard(ctx, { gameId: hubGame.gameId, hubId: hubGame.hubId }, withHub, eventIds);
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
    if (!wasActive) await ctx.api.post(`/admin/plugins/${PELICAN}/deactivate`);
  }
}

export const embedHubLinkTests: SmokeTest[] = [
  {
    name: 'embed-hub-link: event card gets a "Hub" Link button only when the game has a hub; a hub-tagged event names it (ROK-1428, ROK-1895)',
    category: "embed",
    run: eventCardHubLink,
  },
];
