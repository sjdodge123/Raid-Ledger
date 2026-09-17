/**
 * ROK-1549 / ROK-1604 — the scheduling-poll card follows the poll live.
 *
 *   1. Vote → the author line's voter count moves (S1-AC5), and the open card
 *      carries its `Closes <t:…:R>` deadline line (S1-AC3).
 *   2. Cancel with a reason → `■ POLL CANCELLED` + `**Reason:** …` +
 *      `View poll ↗` (S1-AC3/AC4).
 *   3. Deadline passes unlocked → the expiry sweep re-renders
 *      `■ POLL EXPIRED` with `Leading time was <t:…:f>` and the new-poll hint
 *      (S3-AC3).
 *
 * The lock-in half (`LOCKED IN · <time>` + linked event leaves RESCHEDULING)
 * lives in `reschedule-poll-lockin.test.ts` next to the ROK-1392 regression.
 *
 * Every re-render goes through the debounced `scheduling-poll-embed-sync`
 * queue (2s delay), so each mutation is followed by `awaitProcessing` before
 * any Discord assertion. Deterministic waits only — never fixed timers.
 */
import { pollForEmbed, waitForEmbedUpdate } from '../../helpers/polling.js';
import { readLastMessages } from '../../helpers/messages.js';
import type { SimpleEmbed, SimpleMessage } from '../../helpers/messages.js';
import { awaitProcessing, channelForGame } from '../fixtures.js';
import type { SmokeTest, TestContext } from '../types.js';

/** Author-line separator the embed helpers render (`·`). */
const SEP = '·';

/** Discord caps a fetch at 100 — covers many runs' leftover cards. */
const GHOST_SNAPSHOT_COUNT = 100;

interface CreatePollResponse {
  id: number;
  lineupId: number;
}

interface PollSlot {
  id: number;
  proposedTime: string;
}

/** One poll under test: its ids, its card channel and prior-run ghosts. */
interface PollUnderTest {
  poll: CreatePollResponse;
  channelId: string;
  ghostIds: Set<string>;
  href: string;
}

/** Resolve a configured gameId (MMO binding → /games/configured). */
async function resolveGameId(ctx: TestContext): Promise<number> {
  const fromCtx = ctx.games[0]?.id ?? ctx.mmoGameId;
  if (fromCtx) return fromCtx;
  const res = await ctx.api.get<{ data: { id: number }[] }>('/games/configured');
  const id = res?.data?.[0]?.id;
  if (!id) throw new Error('Need at least one configured game for the poll');
  return id;
}

/**
 * Create a public standalone poll with a 24h deadline. Snapshots the card
 * channel FIRST: CI seeds the same lineup/match ids every run, so a prior
 * run's card with an identical href must never satisfy a probe.
 */
async function createPoll(ctx: TestContext): Promise<PollUnderTest> {
  const gameId = await resolveGameId(ctx);
  const channelId = channelForGame(ctx, gameId);
  const ghostIds = new Set(
    (await readLastMessages(channelId, GHOST_SNAPSHOT_COUNT)).map((m) => m.id),
  );
  const poll = await ctx.api.post<CreatePollResponse>('/scheduling-polls', {
    gameId,
    durationHours: 24,
  });
  const href = `/community-lineup/${poll.lineupId}/schedule/${poll.id}`;
  return { poll, channelId, ghostIds, href };
}

/** This poll's embed in a message, or undefined (ghosts never match). */
function cardOf(put: PollUnderTest, m: SimpleMessage): SimpleEmbed | undefined {
  if (put.ghostIds.has(m.id)) return undefined;
  return m.embeds.find((e) => (e.description ?? '').includes(put.href));
}

/** Wait (poll + edit listener) until THIS poll's card satisfies `check`. */
async function waitForCard(
  ctx: TestContext,
  put: PollUnderTest,
  check: (e: SimpleEmbed) => boolean,
): Promise<SimpleEmbed> {
  const matches = (m: SimpleMessage): boolean => {
    const card = cardOf(put, m);
    return card !== undefined && check(card);
  };
  const msg = await waitForEmbedUpdate(
    put.channelId,
    matches,
    ctx.config.timeoutMs,
  );
  const card = cardOf(put, msg);
  if (!card) throw new Error(`Poll card ${put.href} vanished after match`);
  return card;
}

/** Suggest a slot a week out (auto-votes as the admin); returns the slot. */
async function suggestSlot(
  ctx: TestContext,
  put: PollUnderTest,
): Promise<PollSlot> {
  const proposedTime = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const base = `/lineups/${put.poll.lineupId}/schedule/${put.poll.id}`;
  const { id } = await ctx.api.post<{ id: number }>(`${base}/suggest`, {
    proposedTime,
  });
  const page = await ctx.api.get<{ slots: PollSlot[] }>(base);
  const slot = (page.slots ?? []).find((s) => s.id === id);
  if (!slot) throw new Error(`Suggested slot ${id} missing from ${base}`);
  return slot;
}

/** Archive the poll's lineup so polls don't pile up. */
async function archive(ctx: TestContext, put: PollUnderTest): Promise<void> {
  await ctx.api
    .patch(`/lineups/${put.poll.lineupId}/status`, { status: 'archived' })
    .catch(() => null);
}

/** `POLL OPEN · N voter(s)` exactly — `1 voter` must not match `11 voters`. */
function openWithVoters(n: number): (e: SimpleEmbed) => boolean {
  const label = `POLL OPEN ${SEP} ${n} voter${n === 1 ? '' : 's'}`;
  return (e) => (e.author ?? '').endsWith(label);
}

/** Discord timestamp token the card renders for a slot instant. */
function slotToken(iso: string): string {
  return `<t:${Math.floor(new Date(iso).getTime() / 1000)}:f>`;
}

/** Throw a readable failure when a card body lacks a required fragment. */
function assertIncludes(card: SimpleEmbed, fragment: string, why: string): void {
  if (!(card.description ?? '').includes(fragment)) {
    throw new Error(
      `${why}: expected "${fragment}" in the card, got "${card.description}"`,
    );
  }
}

const voteMovesTheCount: SmokeTest = {
  name: 'ROK-1549: a vote moves the poll card voter count; open card shows its deadline',
  category: 'embed',
  async run(ctx) {
    const put = await createPoll(ctx);
    try {
      await awaitProcessing(ctx.api);
      // The post-send refresh stamps the deadline line onto the fresh card.
      await pollForEmbed(
        put.channelId,
        (m) => {
          const card = cardOf(put, m);
          return !!card && openWithVoters(0)(card) &&
            (card.description ?? '').includes('Closes <t:');
        },
        ctx.config.timeoutMs,
      );

      const slot = await suggestSlot(ctx, put); // auto-votes → 1 voter
      await awaitProcessing(ctx.api);
      await waitForCard(ctx, put, openWithVoters(1));

      const base = `/lineups/${put.poll.lineupId}/schedule/${put.poll.id}`;
      const res = await ctx.api.post<{ voted: boolean }>(`${base}/vote`, {
        slotId: slot.id,
      });
      if (res.voted !== false) {
        throw new Error(`Expected the toggle to remove the vote, got ${JSON.stringify(res)}`);
      }
      await awaitProcessing(ctx.api);
      await waitForCard(ctx, put, openWithVoters(0));
    } finally {
      await archive(ctx, put);
    }
  },
};

const cancelShowsReason: SmokeTest = {
  name: 'ROK-1549: cancelling a poll renders POLL CANCELLED with the reason',
  category: 'embed',
  async run(ctx) {
    const put = await createPoll(ctx);
    try {
      await awaitProcessing(ctx.api);
      await pollForEmbed(
        put.channelId,
        (m) => cardOf(put, m) !== undefined,
        ctx.config.timeoutMs,
      );

      const reason = `Smoke ROK 1549 ${Date.now()}`;
      await ctx.api.post(
        `/lineups/${put.poll.lineupId}/schedule/${put.poll.id}/cancel`,
        { reason },
      );
      await awaitProcessing(ctx.api);

      const card = await waitForCard(
        ctx,
        put,
        (e) => (e.author ?? '').includes('POLL CANCELLED'),
      );
      assertIncludes(card, `**Reason:** ${reason}`, 'S1-AC3 cancel reason');
      assertIncludes(card, `[View poll ↗](`, 'Q6 terminal link label');
    } finally {
      await archive(ctx, put);
    }
  },
};

const expiredShowsLeadingTime: SmokeTest = {
  name: 'ROK-1604: an unlocked poll past its deadline renders POLL EXPIRED with the leading time',
  category: 'embed',
  async run(ctx) {
    const put = await createPoll(ctx);
    try {
      await awaitProcessing(ctx.api);
      await pollForEmbed(
        put.channelId,
        (m) => cardOf(put, m) !== undefined,
        ctx.config.timeoutMs,
      );
      const slot = await suggestSlot(ctx, put); // one vote → a leading time
      await awaitProcessing(ctx.api);
      await waitForCard(ctx, put, openWithVoters(1));

      // Deadline 6 minutes ago. The lineup's archive job stays delayed to the
      // ORIGINAL (24h) deadline, so it cannot race the sweep.
      await ctx.api.post('/admin/test/advance-standalone-poll-deadline', {
        lineupId: put.poll.lineupId,
        hoursUntilDeadline: -0.1,
      });
      await ctx.api.post('/admin/test/scheduling-poll/run-expiry-sweep', {});
      await awaitProcessing(ctx.api);

      const card = await waitForCard(
        ctx,
        put,
        (e) => (e.author ?? '').includes('POLL EXPIRED'),
      );
      assertIncludes(
        card,
        `Leading time was ${slotToken(slot.proposedTime)}`,
        'S3-AC3 leading time',
      );
      assertIncludes(card, 'start a new poll', 'S3-AC3 new-poll hint');
      assertIncludes(card, `[View poll ↗](`, 'Q6 terminal link label');
    } finally {
      await archive(ctx, put);
    }
  },
};

export const schedulingPollEmbedLifecycleTests: SmokeTest[] = [
  voteMovesTheCount,
  cancelShowsReason,
  expiredShowsLeadingTime,
];
