/**
 * ROK-1660 — `/lfg-leave game:<id>` end to end through the DEMO_MODE slash
 * harness: the third hand leaves, the API stops counting it, then it rises
 * again through `/lfg` so the phases after this one see the same three-hand
 * group they always did.
 *
 * A real leave the companion bot CAN do — unlike the post's `I'm out` button,
 * which a bot cannot press (that path is covered by the api integration tier).
 */
import { awaitProcessing } from "./fixtures.js";
import { flushLfgBoard } from "./fixtures-lfg-board.js";
import { pollForCondition } from "../helpers/polling.js";
import { readGroup, type Run } from "./lfg-board-shared.js";
import type { TestContext } from "./types.js";

/** The API catches up within one write; the board edit is not awaited here. */
const LEAVE_SETTLE_MS = 15_000;

interface HarnessReply {
  content?: string;
}

/** Invoke `/<commandName> game:<game>` as one fixture user. */
function invokeGameCommand(
  ctx: TestContext,
  commandName: "lfg" | "lfg-leave",
  discordUserId: string,
  game: string,
): Promise<HarnessReply> {
  return ctx.api.post<HarnessReply>("/admin/test/slash-command", {
    commandName,
    options: { game },
    discordUserId,
    guildId: ctx.config.guildId,
    channelId: ctx.defaultChannelId,
  });
}

/** Poll `GET /lfg/:gameId` until it reports `expected` hands. */
async function awaitActiveCount(
  run: Run,
  expected: number,
  step: string,
): Promise<void> {
  try {
    await pollForCondition(async () => {
      const group = await readGroup(run.ctx, run.game.id);
      return group.activeCount === expected ? group : null;
    }, LEAVE_SETTLE_MS);
  } catch {
    const last = await readGroup(run.ctx, run.game.id).catch(() => null);
    throw new Error(
      `ROK-1660 ${step}: GET /lfg/${String(run.game.id)} should report ` +
        `${String(expected)} looking within ${String(LEAVE_SETTLE_MS)}ms, got ` +
        `${String(last?.activeCount ?? "<unreadable>")}`,
    );
  }
}

/**
 * `/lfg-leave` drops the third hand (3 → 2, private `You're out` reply), then
 * `/lfg` raises it again (2 → 3) and the board debounce is flushed.
 */
export async function assertSlashLeaveRoundTrip(run: Run): Promise<void> {
  if (!run.third) {
    throw new Error("ROK-1660 precondition: T26 never seeded the third hand");
  }
  const gameId = String(run.game.id);
  const reply = await invokeGameCommand(
    run.ctx,
    "lfg-leave",
    run.third.discordId,
    gameId,
  );
  const expected = `You're out — **${run.game.name}**. 2 still looking.`;
  if (reply.content !== expected) {
    throw new Error(
      `ROK-1660: /lfg-leave game:${gameId} should answer "${expected}", ` +
        `got ${JSON.stringify(reply)}`,
    );
  }
  await awaitActiveCount(run, 2, "/lfg-leave");
  await invokeGameCommand(run.ctx, "lfg", run.third.discordId, gameId);
  await awaitActiveCount(run, 3, "re-raise after /lfg-leave");
  await awaitProcessing(run.ctx.api);
  await flushLfgBoard(run.ctx.api);
}
