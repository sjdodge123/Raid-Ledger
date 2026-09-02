/**
 * ROK-1370 — Reschedule-poll start suppression + lock-in restore (Option A).
 *
 * Cancel-to-poll rescheduling opens a scheduling poll linked to an event, then
 * (on lock-in) moves the event in place to the winning time. This suite proves
 * the Discord-facing half end-to-end:
 *
 *   1. Poll start → the linked event's channel embed flips to the amber
 *      RESCHEDULING card AND its Discord Scheduled Event is torn down.
 *   2. Lock-in (reschedule in place → complete the poll) → the embed refreshes
 *      back to the live POSTED card at the new time AND the Scheduled Event is
 *      recreated.
 *   3. The whole cycle repeats — a second poll+lock-in works identically.
 *
 * The SE is recreated by the existing `event.updated → updateScheduledEvent`
 * path (a cleared SE id routes to the create branch) fired by the in-place
 * reschedule; the poll-complete re-emit resets the stuck embed to POSTED.
 *
 * Uses only deterministic wait helpers (pollForEmbed / waitForEmbedUpdate /
 * pollForCondition) — never fixed timers.
 */
import { GuildScheduledEventStatus } from "discord.js";
import { getGuild } from "../../client.js";
import {
  pollForEmbed,
  waitForEmbedUpdate,
  pollForCondition,
} from "../../helpers/polling.js";
import {
  createEvent,
  rescheduleEvent,
  deleteEvent,
  awaitProcessing,
  flushEmbedQueue,
  channelForTest,
  channelForGame,
  enableScheduledEvents,
  disableScheduledEvents,
} from "../fixtures.js";
import type { SmokeTest, TestContext } from "../types.js";
import type { ApiClient } from "../api.js";
import type { SimpleMessage } from "../../helpers/messages.js";

/** ROK-1459 palette: `announcing` — the colour an OPEN poll must render. */
const ANNOUNCEMENT_CYAN = 0x38bdf8;

interface CreatePollResponse {
  id: number;
  lineupId: number;
  gameId: number;
}

/** Resolve a configured gameId for the poll (MMO binding → /games/configured). */
async function resolveGameId(ctx: TestContext): Promise<number> {
  const fromCtx = ctx.games[0]?.id ?? ctx.mmoGameId;
  if (fromCtx) return fromCtx;
  const res = await ctx.api.get<{ data: { id: number }[] }>(
    "/games/configured",
  );
  const id = res?.data?.[0]?.id;
  if (!id) throw new Error("Need at least one configured game for the poll");
  return id;
}

/** Fetch a guild Scheduled Event by title substring (HTTP, not cache). */
async function findScheduledEventByTitle(title: string): Promise<{
  id: string;
  status: GuildScheduledEventStatus;
  startsAtMs: number | null;
} | null> {
  const guild = getGuild();
  const events = await guild.scheduledEvents.fetch();
  const match = events.find((se) => se.name.includes(title));
  return match
    ? {
        id: match.id,
        status: match.status,
        startsAtMs: match.scheduledStartAt?.getTime() ?? null,
      }
    : null;
}

/** Open a reschedule poll linked to the event. */
function openReschedulePoll(
  api: ApiClient,
  gameId: number,
  linkedEventId: number,
): Promise<CreatePollResponse> {
  return api.post<CreatePollResponse>("/scheduling-polls", {
    gameId,
    linkedEventId,
  });
}

/** Lock the poll in: move the event in place, then complete the poll. */
async function lockIn(
  ctx: TestContext,
  eventId: number,
  matchId: number,
  minutesFromNow: number,
): Promise<void> {
  await rescheduleEvent(ctx.api, eventId, minutesFromNow);
  await awaitProcessing(ctx.api);
  await ctx.api.post(`/scheduling-polls/${matchId}/complete`, { eventId });
  await awaitProcessing(ctx.api);
  await flushEmbedQueue(ctx.api);
}

/** Assert the channel embed shows the RESCHEDULING card for this event. */
function waitForReschedulingEmbed(
  channelId: string,
  title: string,
  timeoutMs: number,
) {
  // ROK-1460: RESCHEDULING moved from the title to the chrome author line.
  return waitForEmbedUpdate(
    channelId,
    (m) =>
      m.embeds.some(
        (e) => e.title?.includes(title) && !!e.author?.includes("RESCHEDULING"),
      ),
    timeoutMs,
  );
}

/** Assert the channel embed is back to the live (non-RESCHEDULING) card. */
function waitForLiveEmbed(channelId: string, title: string, timeoutMs: number) {
  return waitForEmbedUpdate(
    channelId,
    (m) =>
      m.embeds.some(
        (e) =>
          e.title?.includes(title) &&
          !e.author?.includes("RESCHEDULING") &&
          !!e.description?.includes("<t:"),
      ),
    timeoutMs,
  );
}

const pollStartSuppressesEvent: SmokeTest = {
  name: "ROK-1370: poll start flips embed to RESCHEDULING and tears down the Scheduled Event",
  category: "flow",
  async run(ctx) {
    await enableScheduledEvents(ctx.api);
    const ch = channelForTest(ctx, 0);
    const gameId = ch.gameId ?? (await resolveGameId(ctx));
    const ev = await createEvent(ctx.api, "resched-start", { gameId });
    try {
      await pollForEmbed(
        ch.channelId,
        (m) => m.embeds.some((e) => e.title?.includes(ev.title)),
        ctx.config.timeoutMs,
      );
      await awaitProcessing(ctx.api);
      await pollForCondition(
        () => findScheduledEventByTitle(ev.title),
        ctx.config.timeoutMs,
        { intervalMs: 2000 },
      );

      await openReschedulePoll(ctx.api, gameId, ev.id);
      await awaitProcessing(ctx.api);
      await flushEmbedQueue(ctx.api);

      // Embed shows RESCHEDULING and the Scheduled Event is gone.
      await waitForReschedulingEmbed(
        ch.channelId,
        ev.title,
        ctx.config.timeoutMs,
      );
      await pollForCondition(
        async () => ((await findScheduledEventByTitle(ev.title)) ? null : true),
        ctx.config.timeoutMs,
        { intervalMs: 2000 },
      );
    } finally {
      await disableScheduledEvents(ctx.api);
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

const lockInRestoresEventRepeatably: SmokeTest = {
  name: "ROK-1370: lock-in restores the live embed + Scheduled Event, repeatably",
  category: "flow",
  async run(ctx) {
    await enableScheduledEvents(ctx.api);
    const ch = channelForTest(ctx, 1);
    const gameId = ch.gameId ?? (await resolveGameId(ctx));
    const ev = await createEvent(ctx.api, "resched-cycle", { gameId });
    try {
      await pollForEmbed(
        ch.channelId,
        (m) => m.embeds.some((e) => e.title?.includes(ev.title)),
        ctx.config.timeoutMs,
      );

      // Two full reschedule cycles prove repeatability (ROK-1370 Part 3).
      for (const minutes of [240, 360]) {
        const poll = await openReschedulePoll(ctx.api, gameId, ev.id);
        await awaitProcessing(ctx.api);
        await flushEmbedQueue(ctx.api);
        await waitForReschedulingEmbed(
          ch.channelId,
          ev.title,
          ctx.config.timeoutMs,
        );

        const expectedStartMs = Date.now() + minutes * 60_000;
        await lockIn(ctx, ev.id, poll.id, minutes);

        // Embed back to the live card and the Scheduled Event recreated AT
        // THE NEW TIME — presence alone would false-pass on a stale-time SE
        // (the exact regression this test exists to catch).
        await waitForLiveEmbed(ch.channelId, ev.title, ctx.config.timeoutMs);
        await pollForCondition(
          async () => {
            const se = await findScheduledEventByTitle(ev.title);
            if (!se || se.startsAtMs === null) return null;
            // ±3 min tolerance: expectedStartMs is stamped just before the
            // reschedule PATCH, so only seconds of processing skew apply.
            return Math.abs(se.startsAtMs - expectedStartMs) < 3 * 60_000
              ? se
              : null;
          },
          ctx.config.timeoutMs,
          { intervalMs: 2000 },
        );
      }
    } finally {
      await disableScheduledEvents(ctx.api);
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

/**
 * ROK-1461 AC2/AC3/AC8 — the scheduling-poll embed carries its state on the
 * author line, is coloured `announcing` while open, and offers a masked
 * `Vote now ↗` link instead of the old "Vote Now" BUTTON.
 */
const pollEmbedUsesLinkNotButton: SmokeTest = {
  name: "ROK-1461: scheduling poll embed has no components and a Vote now link",
  category: "embed",
  async run(ctx) {
    const gameId = await resolveGameId(ctx);
    const channelId = channelForGame(ctx, gameId);
    const poll = await ctx.api.post<CreatePollResponse>("/scheduling-polls", {
      gameId,
      durationHours: 24,
    });
    try {
      await awaitProcessing(ctx.api);
      // Scope to THIS poll: the channel is shared, so an older poll's card
      // (same `POLL OPEN` author line) would otherwise satisfy the probe and
      // the assertions would then run against the wrong embed. `poll.id` IS
      // the match id (`StandalonePollService.buildResponse` returns
      // `id: matchId`), which is the `:matchId` segment of the vote route
      // `/community-lineup/:lineupId/schedule/:matchId`.
      const voteHref = `/community-lineup/${poll.lineupId}/schedule/${poll.id}`;
      const isThisPoll = (e: { description: string | null }): boolean =>
        (e.description ?? "").includes(voteHref);
      const msg = await pollForEmbed(
        channelId,
        (m: SimpleMessage) => m.embeds.some(isThisPoll),
        ctx.config.timeoutMs,
      );
      const embed = msg.embeds.find(isThisPoll);
      if (!embed) throw new Error("Poll embed vanished between poll and read");

      if (!embed.author?.includes("POLL OPEN")) {
        throw new Error(
          `Expected an open poll to author as "POLL OPEN" (ROK-1461), got "${embed.author}"`,
        );
      }
      if (msg.components.length > 0) {
        throw new Error(
          `Expected the poll message to carry no components (ROK-1461), got ${msg.components.length}`,
        );
      }
      const description = (embed.description ?? "").trimEnd();
      const last = description.split("\n").pop() ?? "";
      if (
        !last.startsWith("[Vote now \u2197](") ||
        !last.endsWith(`${voteHref})`)
      ) {
        throw new Error(
          `Expected the description to end with the "Vote now" masked link to ${voteHref}, got "${last}"`,
        );
      }
      if (embed.color !== ANNOUNCEMENT_CYAN) {
        throw new Error(
          `Expected an OPEN poll to render the announcing colour ${ANNOUNCEMENT_CYAN.toString(16)}, got ${embed.color?.toString(16)}`,
        );
      }
    } finally {
      await ctx.api
        .patch(`/lineups/${poll.lineupId}/status`, { status: "archived" })
        .catch(() => null);
    }
  },
};

export const reschedulePollLockInTests: SmokeTest[] = [
  pollStartSuppressesEvent,
  lockInRestoresEventRepeatably,
  pollEmbedUsesLinkNotButton,
];
