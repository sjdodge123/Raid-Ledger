/**
 * ROK-1728 (spec §6.5, AC10) — the series card's "Join Series" row.
 *
 * A recurring event's channel card keeps row 1 unchanged (Sign Up · Tentative
 * · Decline · [View Event] · [Hub]) and gains a second row holding exactly one
 * `series_join:<eventId>` button; a one-off event's card has no second row.
 * After a signup changes the roster count, the embed re-sync must still carry
 * the row — this catches a writer that still sends `[row]` instead of
 * `embedComponents(result)`. Every card stays within Discord's 5-row cap.
 *
 * Bots cannot press another bot's buttons, so the click path is covered by the
 * api unit specs (`series-signup-interaction.*.spec.ts`), not here.
 * Deterministic polling only — no fixed-delay waits. Every event created is
 * deleted in `finally` (the guild is shared with CI and preserved envs).
 */
import { pollForEmbed, waitForEmbedUpdate } from "../../helpers/polling.js";
import type { SimpleMessage } from "../../helpers/messages.js";
import type { ApiClient } from "../api.js";
import { SmokeAssertionError } from "../assert.js";
import { awaitProcessing, createEvent, deleteEvent, flushEmbedQueue, signup } from "../fixtures.js";
import { nonSeriesRowProblem, seriesRowProblem } from "../series-join-row.js";
import type { SmokeTest, TestContext } from "../types.js";

const THREE_WEEKS_MS = 21 * 24 * 60 * 60 * 1000;

/** The card for this exact event: its title, plus a button or link carrying its id. */
function isCardFor(msg: SimpleMessage, ev: { id: number; title: string }): boolean {
  const id = String(ev.id);
  const titled = msg.embeds.some((e) => (e.title ?? "").includes(ev.title));
  const owned = msg.components.some(
    (c) => (c.customId ?? "").endsWith(`:${id}`) || (c.url ?? "").endsWith(`/events/${id}`),
  );
  return titled && owned;
}

/** The roster count on the chrome author line reads exactly `1 of …`. */
function showsOneSignup(msg: SimpleMessage): boolean {
  return msg.embeds.some((e) => /(^|\D)1 of /.test(e.author ?? ""));
}

function expectRows(problem: string | null, what: string, card: SimpleMessage): void {
  if (problem === null) return;
  throw new SmokeAssertionError(`${what}: ${problem} (components ${JSON.stringify(card.components)})`);
}

/** Delete every night of the series; fall back to the single event if the series route refuses. */
async function deleteSeries(api: ApiClient, eventId: number): Promise<void> {
  await awaitProcessing(api, 2_000).catch(() => {});
  await api.delete(`/events/${String(eventId)}/series?scope=all`).catch(() => deleteEvent(api, eventId));
}

async function postCard(ctx: TestContext, ev: { id: number; title: string }): Promise<SimpleMessage> {
  return pollForEmbed(ctx.defaultChannelId, (m) => isCardFor(m, ev), ctx.config.timeoutMs);
}

async function seriesCardKeepsJoinRow(ctx: TestContext): Promise<void> {
  const seriesIds: number[] = [];
  const eventIds: number[] = [];
  try {
    const until = new Date(Date.now() + THREE_WEEKS_MS).toISOString();
    const series = await createEvent(ctx.api, "series-join", { recurrence: { frequency: "weekly", until } });
    seriesIds.push(series.id);
    const plain = await createEvent(ctx.api, "series-join-plain");
    eventIds.push(plain.id);
    if (typeof series.recurrenceGroupId !== "string") {
      throw new SmokeAssertionError(`event ${String(series.id)} has no recurrenceGroupId — recurrence not applied`);
    }
    await awaitProcessing(ctx.api);
    await flushEmbedQueue(ctx.api);

    const card = await postCard(ctx, series);
    expectRows(seriesRowProblem(card, series.id), "series card as posted", card);
    const plainCard = await postCard(ctx, plain);
    expectRows(nonSeriesRowProblem(plainCard, plain.id), "one-off card", plainCard);

    await signup(ctx.api, series.id);
    await awaitProcessing(ctx.api);
    const edited = await waitForEmbedUpdate(
      ctx.defaultChannelId,
      (m) => isCardFor(m, series) && showsOneSignup(m),
      ctx.config.timeoutMs,
    );
    expectRows(seriesRowProblem(edited, series.id), "series card after the signup re-sync", edited);
  } finally {
    for (const id of eventIds) await deleteEvent(ctx.api, id);
    for (const id of seriesIds) await deleteSeries(ctx.api, id);
  }
}

export const seriesSignupEmbedTests: SmokeTest[] = [
  {
    name: "series-signup-embed: a series card carries one Join Series row (kept after a signup re-sync); a one-off card has none (ROK-1728)",
    category: "embed",
    run: seriesCardKeepsJoinRow,
  },
];
