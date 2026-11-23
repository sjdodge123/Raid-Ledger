/**
 * ROK-2292 — shared assertions for an event forum post whose starter is the
 * event's signup card (used by `forum-starter-card.test.ts` and the
 * event-planning non-hub event smoke).
 */
import type { ForumChannel, Message, ThreadChannel } from "discord.js";
import { toSimpleMessage, type SimpleMessage } from "../../helpers/messages.js";
import { pollForCondition } from "../../helpers/polling.js";
import { signupAs } from "../fixtures.js";
import type { TestContext } from "../types.js";
import { fail, TIMEOUT_MS } from "./hub-forum-discord-outbound.test.js";
import { seededMember } from "./hub-forum-discord-signup-lines.test.js";

/** `SIGNUP_BUTTON_IDS.SIGNUP` (api discord-bot.constants) + `:<eventId>`. */
const signupButtonId = (eventId: number) => `signup:${String(eventId)}`;

export type StarterAuthor = "bot" | "webhook";

/** What a failed poll last saw, so the failure names expected vs actual. */
interface StarterView {
  content: string;
  webhookId: string | null;
  embeds: SimpleMessage["embeds"];
  components: SimpleMessage["components"];
}

function viewOf(msg: Message): StarterView {
  const simple = toSimpleMessage(msg);
  return {
    content: msg.content,
    webhookId: msg.webhookId,
    embeds: simple.embeds,
    components: simple.components,
  };
}

/** Poll Discord only (no fixture that could lazily create it) for the event's post. */
export async function postCreatedOnAnnounce(
  forum: ForumChannel,
  title: string,
): Promise<ThreadChannel> {
  let names: string[] = [];
  try {
    return await pollForCondition(async () => {
      const active = await forum.threads.fetchActive();
      names = [...active.threads.values()].map((t) => t.name);
      return active.threads.find((t) => t.name.startsWith(title)) ?? null;
    }, TIMEOUT_MS);
  } catch {
    return fail(
      `ROK-2292 D8: a post for "${title}" should exist once the event is announced, before any signup`,
      names,
    );
  }
}

/** True when the starter links the event page (description masked link or a link button). */
function linksEvent(view: StarterView, eventId: number): boolean {
  const path = `/events/${String(eventId)}`;
  const inEmbed = view.embeds.some(
    (e) => e.description?.includes(path) ?? false,
  );
  return inEmbed || view.components.some((c) => c.url?.includes(path) ?? false);
}

function isCard(
  view: StarterView,
  eventId: number,
  title: string,
  by: StarterAuthor,
): boolean {
  const authorOk =
    by === "webhook" ? view.webhookId !== null : view.webhookId === null;
  const embed = view.embeds[0];
  return (
    view.content === "" &&
    view.embeds.length === 1 &&
    (embed?.title?.includes(title) ?? false) &&
    linksEvent(view, eventId) &&
    view.components.some((c) => c.customId === signupButtonId(eventId)) &&
    authorOk
  );
}

/**
 * The starter is the event card: empty content, exactly one embed titled for
 * the event and linking its page, the signup button, authored as `by`.
 */
export async function expectStarterCard(
  post: ThreadChannel,
  eventId: number,
  title: string,
  by: StarterAuthor,
): Promise<Message> {
  let last: StarterView | null = null;
  try {
    return await pollForCondition(async () => {
      const msg = await post
        .fetchStarterMessage({ force: true })
        .catch(() => null);
      last = msg ? viewOf(msg) : null;
      return msg && last && isCard(last, eventId, title, by) ? msg : null;
    }, TIMEOUT_MS);
  } catch {
    const want = `content "", 1 embed titled "${title}" linking /events/${String(eventId)}, button ${signupButtonId(eventId)}, ${by} author`;
    return fail(
      `ROK-2292: post ${post.id} starter should be the event card (${want})`,
      last,
    );
  }
}

/** The card's signup count from its chrome author line (`{n} of {max}`, ROK-1460). */
function cardCount(msg: Message): number | null {
  const m = /(\d+) of /.exec(msg.embeds[0]?.author?.name ?? "");
  return m?.[1] === undefined ? null : Number(m[1]);
}

async function apiSignupCount(
  ctx: TestContext,
  eventId: number,
): Promise<number> {
  const ev = await ctx.api.get<{ signupCount?: unknown }>(
    `/events/${String(eventId)}`,
  );
  if (typeof ev.signupCount !== "number")
    return fail(`GET /events/${String(eventId)}: no signupCount`, ev);
  return ev.signupCount;
}

/** Sign the seeded member up, then poll until the starter card shows the new count. */
export async function expectCardTracksSignup(
  ctx: TestContext,
  post: ThreadChannel,
  eventId: number,
  users: unknown,
): Promise<void> {
  const before = await apiSignupCount(ctx, eventId);
  await signupAs(ctx.api, eventId, seededMember(users).userId);
  const want = await apiSignupCount(ctx, eventId);
  if (want !== before + 1)
    fail(
      `signup fixture: event ${String(eventId)} count should go ${before} → ${before + 1}`,
      want,
    );
  let seen: number | null = null;
  try {
    await pollForCondition(async () => {
      const msg = await post
        .fetchStarterMessage({ force: true })
        .catch(() => null);
      seen = msg ? cardCount(msg) : null;
      return seen === want ? true : null;
    }, TIMEOUT_MS);
  } catch {
    fail(
      `ROK-2292: post ${post.id} starter card should show "${want} of" after the signup (embed sync edits the starter)`,
      seen,
    );
  }
}

/** `buildSchedulingPollEmbedBody` title prefix (api discord-embed-scheduling.helpers). */
const POLL_EMBED_TITLE = "When should we play";

function isPollCard(
  view: StarterView,
  pollPath: string,
  by: StarterAuthor,
): boolean {
  const authorOk =
    by === "webhook" ? view.webhookId !== null : view.webhookId === null;
  const embed = view.embeds[0];
  return (
    view.content === "" &&
    view.embeds.length === 1 &&
    (embed?.title?.startsWith(POLL_EMBED_TITLE) ?? false) &&
    (embed?.description?.includes(pollPath) ?? false) &&
    view.components.length === 0 &&
    authorOk
  );
}

/**
 * ROK-2295: a poll post's starter is the live poll embed — empty content,
 * exactly one embed titled "When should we play …" whose body links the
 * poll page, no buttons, authored as `by` (hub webhook / planning bot).
 */
export async function expectPollStarterCard(
  post: ThreadChannel,
  poll: { lineupId: number; matchId: number },
  by: StarterAuthor,
): Promise<Message> {
  const pollPath = `/community-lineup/${String(poll.lineupId)}/schedule/${String(poll.matchId)}`;
  let last: StarterView | null = null;
  try {
    return await pollForCondition(async () => {
      const msg = await post
        .fetchStarterMessage({ force: true })
        .catch(() => null);
      last = msg ? viewOf(msg) : null;
      return msg && last && isPollCard(last, pollPath, by) ? msg : null;
    }, TIMEOUT_MS);
  } catch {
    const want = `content "", 1 embed titled "${POLL_EMBED_TITLE} …" linking ${pollPath}, no buttons, ${by} author`;
    return fail(
      `ROK-2295: post ${post.id} starter should be the live poll embed (${want})`,
      last,
    );
  }
}
