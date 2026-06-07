/**
 * Scheduled Event rename-on-game smoke test (ROK-1350).
 *
 * Validates that assigning / changing / clearing the game on a variety-night
 * event renames the bound Discord Scheduled Event in place:
 *   1. Create an event with a live SE and NO game → SE name = bare title.
 *   2. Set a game (PATCH /events/:id { gameId }) → SE name = "<title> — <GAME>".
 *   3. Change to a different game → SE re-renamed to "<title> — <GAME2>".
 *   4. Unset the game (gameId: null) → SE name reverts to the bare title.
 *
 * Crucially the SE id (discordScheduledEventId) is STABLE across all three
 * transitions — the rename rides scheduledEvents.edit on the stored id and
 * never creates a duplicate (ROK-1347 idempotency). We capture the SE id once
 * from the initial title, then re-fetch by that id after every transition so
 * the assertions survive the name changes.
 *
 * Deterministic polling only (helpers/polling.ts) — never a fixed delay.
 */
import { getGuild } from "../../client.js";
import { pollForCondition } from "../../helpers/polling.js";
import {
  createEvent,
  deleteEvent,
  awaitProcessing,
  flushEmbedQueue,
  enableScheduledEvents,
  disableScheduledEvents,
} from "../fixtures.js";
import type { ApiClient } from "../api.js";
import type { SmokeTest, TestContext } from "../types.js";

/** Find one guild SE by exact title (HTTP fetch, not cache). Returns id+name. */
async function findOneByTitle(
  title: string,
): Promise<{ id: string; name: string } | null> {
  const guild = getGuild();
  const events = await guild.scheduledEvents.fetch();
  const match = events.find((se) => se.name === title);
  if (!match) return null;
  return { id: match.id, name: match.name };
}

/** Fetch a single guild SE's current name by id (HTTP fetch). */
async function fetchSeName(seId: string): Promise<string> {
  const se = await getGuild().scheduledEvents.fetch(seId);
  return se.name;
}

/** Apply a game change via the public PATCH endpoint and drain the pipeline. */
async function setGame(
  api: ApiClient,
  eventId: number,
  gameId: number | null,
): Promise<void> {
  await api.patch(`/events/${eventId}`, { gameId });
  await awaitProcessing(api);
  await flushEmbedQueue(api);
}

/** Poll the bound SE (by id) until its name equals `expected`. */
async function pollForSeName(
  seId: string,
  expected: string,
  timeoutMs: number,
): Promise<void> {
  await pollForCondition(
    async () => ((await fetchSeName(seId)) === expected ? true : null),
    timeoutMs,
    { intervalMs: 2000 },
  );
}

/** Pick two distinct games with names from the discovered demo games. */
function pickTwoGames(ctx: TestContext): { a: { id: number; name: string }; b: { id: number; name: string } } {
  const games = ctx.games.filter((g) => g.name && g.name.length > 0);
  if (games.length < 2) {
    throw new Error(
      `Need ≥2 named games for rename test, found ${games.length}`,
    );
  }
  return { a: games[0], b: games[1] };
}

const renameOnGameSetChangeUnset: SmokeTest = {
  name: "ROK-1350: SE renamed on game set → change → unset, id stable (no duplicate)",
  category: "flow",
  async run(ctx: TestContext) {
    const { a: gameA, b: gameB } = pickTwoGames(ctx);
    await enableScheduledEvents(ctx.api);
    const ev = await createEvent(ctx.api, "se-rename");
    try {
      await awaitProcessing(ctx.api);
      // Capture the bound SE id from the initial (bare-title) name. 2× timeout:
      // SE creation traverses reconciliation → BullMQ → Discord (remote-env
      // headroom, matching scheduled-event-recovery.test.ts).
      const bound = await pollForCondition(
        () => findOneByTitle(ev.title),
        ctx.config.timeoutMs * 2,
        { intervalMs: 2000 },
      );
      const seId = bound.id;

      // 1. Set game A → SE renamed to "<title> — <GAME A>".
      await setGame(ctx.api, ev.id, gameA.id);
      await pollForSeName(seId, `${ev.title} — ${gameA.name}`, ctx.config.timeoutMs);

      // 2. Change to game B → SE re-renamed; SAME SE id (no duplicate).
      await setGame(ctx.api, ev.id, gameB.id);
      await pollForSeName(seId, `${ev.title} — ${gameB.name}`, ctx.config.timeoutMs);

      // 3. Unset the game → SE name reverts to the bare title.
      await setGame(ctx.api, ev.id, null);
      await pollForSeName(seId, ev.title, ctx.config.timeoutMs);

      // The SE id must be the one we started with (rode edit, never re-created).
      const final = await findOneByTitle(ev.title);
      if (!final || final.id !== seId) {
        throw new Error(
          `Expected stable SE id ${seId}; found ${final?.id ?? "none"} — rename created a duplicate`,
        );
      }
    } finally {
      await disableScheduledEvents(ctx.api);
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

export const scheduledEventRenameTests: SmokeTest[] = [
  renameOnGameSetChangeUnset,
];
