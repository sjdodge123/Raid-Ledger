/**
 * ROK-1812 — the "Spots still available" bump keeps its count in sync.
 *
 * The bump carries an "N/M spots filled" line. Before the fix only a FULL
 * transition touched it (to delete it), so a sign-up below full left the
 * bump showing a stale count while the event embed moved on.
 *
 *  1. Create an event 30h out (inside the 48h recruitment window).
 *  2. Post its bump now via the DEMO fixture (skips grace period + dedup).
 *  3. Read the bump's starting "N/10 spots filled".
 *  4. Sign a demo user up.
 *  5. Poll the SAME bump message until it reads "N+1/10 spots filled".
 */
import { getTextChannel } from "../../client.js";
import { pollForEmbed } from "../../helpers/polling.js";
import type { SimpleMessage } from "../../helpers/messages.js";
import {
  awaitProcessing,
  channelForGame,
  createEvent,
  deleteEvent,
  futureTime,
  signupAs,
} from "../fixtures.js";
import { resolveConfiguredGame } from "../configured-game.js";
import type { SmokeTest, TestContext } from "../types.js";
import { assertAtLeast } from "./must.js";

const MAX_ATTENDEES = 10;
const SPOTS_RE = new RegExp(`(\\d+)/${MAX_ATTENDEES} spots filled`);

function bumpDescription(
  msg: SimpleMessage,
  eventTitle: string,
): string | null {
  const embed = msg.embeds.find(
    (e) =>
      /spots still available/i.test(e.title ?? "") &&
      (e.description ?? "").includes(eventTitle),
  );
  return embed?.description ?? null;
}

/** Wait for the event's bump to land; return its id and starting count. */
async function awaitBump(
  channelId: string,
  eventTitle: string,
): Promise<{ id: string; filled: number }> {
  const msg = await pollForEmbed(
    channelId,
    (m) => SPOTS_RE.test(bumpDescription(m, eventTitle) ?? ""),
    30_000,
  );
  const match = SPOTS_RE.exec(bumpDescription(msg, eventTitle) ?? "");
  if (!match?.[1]) {
    throw new Error(
      `bump for "${eventTitle}" has no "N/${MAX_ATTENDEES} spots filled" line`,
    );
  }
  return { id: msg.id, filled: Number(match[1]) };
}

async function awaitBumpCount(
  channelId: string,
  bumpId: string,
  eventTitle: string,
  expected: number,
): Promise<void> {
  const want = `${expected}/${MAX_ATTENDEES} spots filled`;
  try {
    await pollForEmbed(
      channelId,
      (m) =>
        m.id === bumpId &&
        (bumpDescription(m, eventTitle) ?? "").includes(want),
      30_000,
    );
  } catch {
    throw new Error(
      `bump ${bumpId} for "${eventTitle}" never showed "${want}" after a sign-up — its count is stale (ROK-1812)`,
    );
  }
}

/**
 * Nothing deletes a bump when its event is deleted (only FULL does), so the
 * smoke removes its own card from the shared channel. Never throws — it runs
 * in `finally` and must not mask the failure that got us there.
 */
async function deleteBump(channelId: string, bumpId: string): Promise<void> {
  try {
    await getTextChannel(channelId).messages.delete(bumpId);
  } catch (err) {
    console.warn(`    ROK-1812: bump ${bumpId} cleanup failed: ${String(err)}`);
  }
}

const bumpCountFollowsSignups: SmokeTest = {
  name: "Recruitment bump count follows sign-ups (ROK-1812)",
  category: "embed",
  async run(ctx: TestContext) {
    const users = ctx.demoUserIds ?? [];
    assertAtLeast(users, 1, "Need 1+ demo user to sign up");
    const gameId = ctx.mmoGameId ?? (await resolveConfiguredGame(ctx)).id;
    // The bump routes by game binding first (ROK-1335).
    const channelId = channelForGame(ctx, gameId);
    const event = await createEvent(ctx.api, "rok1812-bumpsync", {
      gameId,
      maxAttendees: MAX_ATTENDEES,
      startTime: futureTime(30 * 60),
      endTime: futureTime(31 * 60),
    });
    let bumpId: string | null = null;
    try {
      await awaitProcessing(ctx.api);
      await ctx.api.post("/admin/test/post-recruitment-bump", {
        eventId: event.id,
      });
      const bump = await awaitBump(channelId, event.title);
      bumpId = bump.id;
      console.log(
        `    ROK-1812: bump ${bump.id} starts at ${bump.filled}/${MAX_ATTENDEES}`,
      );

      await signupAs(ctx.api, event.id, users[0]);
      await awaitProcessing(ctx.api);
      await awaitBumpCount(channelId, bump.id, event.title, bump.filled + 1);
    } finally {
      if (bumpId) await deleteBump(channelId, bumpId);
      await deleteEvent(ctx.api, event.id);
    }
  },
};

export const recruitmentBumpSyncTests: SmokeTest[] = [bumpCountFollowsSignups];
