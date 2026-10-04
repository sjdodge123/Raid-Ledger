/**
 * TDB:571 — a re-decide deletes the poll card of the match it wiped.
 *
 * Decide a lineup so its single game's match enters `scheduling` and posts
 * card A (ROK-1473). Revert to `voting`, then decide again: the re-decide
 * wipes match A and re-inserts match B from the fresh tally. Card A's
 * buttons and link point at a match id that no longer exists, so it must be
 * DELETED from the channel, and match B must get its own fresh card.
 *
 * Shared-guild isolation: keying on the lineup id is NOT enough. CI reseeds
 * the same lineup and match ids every run, and `deleteLineup` leaves the
 * run's fresh card B in the shared channel, so an earlier run's card links a
 * byte-identical `/community-lineup/7/schedule/3`. Every read is therefore
 * fenced to messages posted AFTER a snapshot taken before the lineup exists
 * (the `ghostIds` pattern from reschedule-poll-lockin.test.ts).
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
  assertPollOpen,
  buildDecidedLineup,
  deleteLineup,
  loadSchedulingMatch,
  resolveLineupChannelId,
} from './lineup-scheduling-poll-card.test.js';
import { archiveOwnLeftoverLineups } from '../lineup-leftovers.js';

/**
 * Title prefixes of the lineups this file creates. Each title is exactly
 * `<prefix>${Date.now()}`; only those stamped before RUN_STARTED_AT are
 * archived as leftovers of an earlier run (lineup-leftovers.ts).
 */
const OWN_TITLE_PREFIXES = ['Re-decide Card '] as const;

/** Lineups stamped at or after this instant belong to the current run. */
const RUN_STARTED_AT = Date.now();

/** Messages snapshotted before the lineup exists (a full fetch window). */
const FENCE_SNAPSHOT_COUNT = 100;

/** True only for a message this run posted. */
type Fence = (m: SimpleMessage) => boolean;

/**
 * Snapshot the channel before this run posts anything; admit only messages
 * newer than the newest one already there. Snowflakes grow with time, so this
 * excludes every snapshotted id AND any older ghost a later read reaches once
 * other messages are deleted and the 100-message window slides back.
 */
async function snapshotFence(channelId: string): Promise<Fence> {
  const msgs = await readLastMessages(channelId, FENCE_SNAPSHOT_COUNT);
  const newest = msgs.reduce((max, m) => {
    const id = BigInt(m.id);
    return id > max ? id : max;
  }, 0n);
  return (m) => BigInt(m.id) > newest;
}

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

/** Wait for a card THIS run posted linking `path`; name it on timeout. */
async function awaitCard(
  ctx: TestContext,
  channelId: string,
  fresh: Fence,
  path: string,
  label: string,
): Promise<SimpleMessage> {
  try {
    return await pollForEmbed(
      channelId,
      (m) => fresh(m) && cardsLinking([m], path).length > 0,
      ctx.config.timeoutMs,
    );
  } catch {
    throw new Error(`Expected ${label} linking ${path} in ${channelId}; none posted this run`);
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

/**
 * Of the cards THIS run posted, card A is gone and exactly one OPEN card
 * remains, linking match B. Earlier runs' identical cards are fenced out.
 */
async function assertOnlyFreshCard(
  channelId: string,
  fresh: Fence,
  lineupId: number,
  pathA: string,
  pathB: string,
): Promise<void> {
  const msgs = (await readLastMessages(channelId, FENCE_SNAPSHOT_COUNT)).filter(fresh);
  const stale = cardsLinking(msgs, pathA);
  if (stale.length > 0) {
    throw new Error(`Expected no card linking ${pathA} after re-decide, found ${stale.length} posted this run`);
  }
  const open = cardsLinking(msgs, `/community-lineup/${lineupId}/schedule/`).filter(
    (m) => m.embeds.some((e) => (e.author ?? '').includes(POLL_OPEN)),
  );
  const linksB = open.every((m) => cardsLinking([m], pathB).length > 0);
  if (open.length !== 1 || !linksB) {
    throw new Error(
      `Expected exactly 1 ${POLL_OPEN} card posted this run for lineup ${lineupId} linking ${pathB}, found ${open.length}`,
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
    await archiveOwnLeftoverLineups(ctx.api, OWN_TITLE_PREFIXES, RUN_STARTED_AT);
    const channelId = await resolveLineupChannelId(ctx.api, ctx.defaultChannelId);
    const fresh = await snapshotFence(channelId);
    const lineup = await buildDecidedLineup(ctx.api, `Re-decide Card ${Date.now()}`);
    try {
      await awaitProcessing(ctx.api);
      const matchA = await loadSchedulingMatch(ctx.api, lineup.id);
      const pathA = pollPath(lineup.id, matchA.id);
      const cardA = await awaitCard(ctx, channelId, fresh, pathA, 'the first poll card');

      await redecide(ctx, lineup.id);
      await awaitCardDeleted(ctx, channelId, cardA, pathA);

      const matchB = await loadSchedulingMatch(ctx.api, lineup.id);
      if (matchB.id === matchA.id) {
        throw new Error(`Expected the re-decide to replace match ${matchA.id}, got the same id`);
      }
      const pathB = pollPath(lineup.id, matchB.id);
      const cardB = await awaitCard(ctx, channelId, fresh, pathB, 'a fresh poll card');
      const embedB = cardB.embeds.find((e) => (e.description ?? '').includes(pathB));
      if (embedB) assertPollOpen(embedB);
      await assertOnlyFreshCard(channelId, fresh, lineup.id, pathA, pathB);
    } finally {
      await deleteLineup(ctx.api, lineup.id);
    }
  },
};

export const lineupRedecideOrphanCardTests: SmokeTest[] = [redecideDeletesOrphanedCard];
