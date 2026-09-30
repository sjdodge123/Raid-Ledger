/**
 * TDB:571 — a re-decide deletes the poll card of the match it wiped.
 *
 * Decide a lineup so its single game's match enters `scheduling` and posts
 * card A (ROK-1473). Revert to `voting`, then decide again: the re-decide
 * wipes match A and re-inserts match B from the fresh tally. Card A's
 * buttons and link point at a match id that no longer exists, so it must be
 * DELETED from the channel, and match B must get its own fresh card.
 *
 * Shared-guild isolation: every active lineup is archived first, and every
 * assertion is keyed to THIS lineup's id, so a sibling env's or an earlier
 * run's poll cards in the same channel can never satisfy or fail it.
 */
import { pollForCondition, pollForEmbed } from '../../helpers/polling.js';
import {
  messageExists,
  readLastMessages,
  type SimpleMessage,
} from '../../helpers/messages.js';
import { awaitProcessing } from '../fixtures.js';
import type { SmokeTest, TestContext } from '../types.js';
import {
  POLL_OPEN,
  archiveAllLineups,
  assertPollOpen,
  buildDecidedLineup,
  deleteLineup,
  loadSchedulingMatch,
  resolveLineupChannelId,
} from './lineup-scheduling-poll-card.test.js';

/** The card's masked-link path for one scheduling match. */
function pollPath(lineupId: number, matchId: number): string {
  return `/community-lineup/${lineupId}/schedule/${matchId}`;
}

/** Messages in the channel carrying an embed that links `fragment`. */
function cardsLinking(msgs: SimpleMessage[], fragment: string): SimpleMessage[] {
  return msgs.filter((m) =>
    m.embeds.some((e) => (e.description ?? '').includes(fragment)),
  );
}

/** Wait for a card linking `path`; name the missing card on timeout. */
async function awaitCard(
  ctx: TestContext,
  channelId: string,
  path: string,
  label: string,
): Promise<SimpleMessage> {
  try {
    return await pollForEmbed(
      channelId,
      (m) => cardsLinking([m], path).length > 0,
      ctx.config.timeoutMs,
    );
  } catch {
    throw new Error(`Expected ${label} linking ${path} in ${channelId}; none posted`);
  }
}

/** Wait until card A is gone from Discord (10008 on a REST fetch). */
async function awaitCardDeleted(
  ctx: TestContext,
  channelId: string,
  card: SimpleMessage,
  path: string,
): Promise<void> {
  try {
    await pollForCondition(
      async () => ((await messageExists(channelId, card.id)) ? null : true),
      ctx.config.timeoutMs,
    );
  } catch {
    throw new Error(
      `Re-decide left orphaned poll card ${card.id} (links ${path}, a wiped match) live in ${channelId}`,
    );
  }
}

/** Exactly one OPEN card for the lineup remains, and it links match B. */
async function assertOnlyFreshCard(
  channelId: string,
  lineupId: number,
  pathA: string,
  pathB: string,
): Promise<void> {
  const msgs = await readLastMessages(channelId, 100);
  const stale = cardsLinking(msgs, pathA);
  if (stale.length > 0) {
    throw new Error(`Expected no card linking ${pathA} after re-decide, found ${stale.length}`);
  }
  const open = cardsLinking(msgs, `/community-lineup/${lineupId}/schedule/`).filter(
    (m) => m.embeds.some((e) => (e.author ?? '').includes(POLL_OPEN)),
  );
  const linksB = open.every((m) => cardsLinking([m], pathB).length > 0);
  if (open.length !== 1 || !linksB) {
    throw new Error(
      `Expected exactly 1 ${POLL_OPEN} card for lineup ${lineupId} linking ${pathB}, found ${open.length}`,
    );
  }
}

/** Revert to voting, then decide again — the operator re-decide path. */
async function redecide(ctx: TestContext, lineupId: number): Promise<void> {
  await ctx.api.patch(`/lineups/${lineupId}/status`, { status: 'voting' });
  await ctx.api.patch(`/lineups/${lineupId}/status`, { status: 'decided' });
  await awaitProcessing(ctx.api);
}

const redecideDeletesOrphanedCard: SmokeTest = {
  name: 'Lineup re-decide deletes the wiped match poll card and posts a fresh one (TDB:571)',
  category: 'embed',
  async run(ctx: TestContext) {
    await archiveAllLineups(ctx.api);
    const lineup = await buildDecidedLineup(ctx.api, `Re-decide Card ${Date.now()}`);
    try {
      await awaitProcessing(ctx.api);
      const channelId = await resolveLineupChannelId(ctx.api, ctx.defaultChannelId);
      const matchA = await loadSchedulingMatch(ctx.api, lineup.id);
      const pathA = pollPath(lineup.id, matchA.id);
      const cardA = await awaitCard(ctx, channelId, pathA, 'the first poll card');

      await redecide(ctx, lineup.id);
      await awaitCardDeleted(ctx, channelId, cardA, pathA);

      const matchB = await loadSchedulingMatch(ctx.api, lineup.id);
      if (matchB.id === matchA.id) {
        throw new Error(`Expected the re-decide to replace match ${matchA.id}, got the same id`);
      }
      const pathB = pollPath(lineup.id, matchB.id);
      const cardB = await awaitCard(ctx, channelId, pathB, 'a fresh poll card');
      const embedB = cardB.embeds.find((e) => (e.description ?? '').includes(pathB));
      if (embedB) assertPollOpen(embedB);
      await assertOnlyFreshCard(channelId, lineup.id, pathA, pathB);
    } finally {
      await deleteLineup(ctx.api, lineup.id);
    }
  },
};

export const lineupRedecideOrphanCardTests: SmokeTest[] = [redecideDeletesOrphanedCard];
