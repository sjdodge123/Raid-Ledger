/**
 * ROK-1632 AC3 — "Everyone's in" creator DM.
 *
 * When ONE proposed time carries a YES from EVERY member of a scheduling
 * poll (n > 1), the poll's creator gets a DM: title `Everyone's in for
 * {game}`, message `All {n} members said yes to <t:UNIX:f>. Lock it in.`,
 * and a payload that widens the Discord button from "Vote on a Time" to a
 * one-click Lock link. Once per poll per time.
 *
 * Asserts (spec §5.4):
 *   1. a `community_lineup` notification lands for the POLL CREATOR with
 *      `payload.subtype === 'scheduling_poll_unanimous_time'`;
 *   2. the title is exactly the AC's copy and the message carries the slot's
 *      own `<t:…:f>` token plus the real member count;
 *   3. `payload.slotId` is the unanimous slot and `payload.lockLabel` is a
 *      non-empty string — together these are what make
 *      `notification-embed.buttons.ts:buildLineupButton` render the **Lock**
 *      button (`?lock=<slotId>`) beside the plain poll link;
 *   4. `payload.lineupId` / `payload.matchId` deep-link the poll;
 *   5. un-voting and re-voting a member produces NO second notification
 *      (the permanent `sched-poll-unanimous:<matchId>:<slotId>` claim).
 *
 * Bot DM rationale: the companion bot cannot receive a DM from another bot
 * (Discord API 50007), so the in-app `notifications` row — not a read of the
 * rendered embed — is the canonical proof of dispatch. Same approach as
 * `standalone-poll-reminders.test.ts` and `lineup-tiebreaker-open.test.ts`.
 * That is also why the Lock button is asserted through the payload fields
 * that build its URL rather than by parsing the button href: the `?lock=` /
 * `?src=discord` (ROK-1550) assembly happens at render time, downstream of
 * everything this tier can observe.
 *
 * Deterministic waits only — `pollForCondition` + `awaitProcessing`, never a
 * fixed timer (`npm run lint:no-sleep`).
 */
import { pollForCondition } from '../../helpers/polling.js';
import { awaitProcessing, seedFixtureUser } from '../fixtures.js';
import type { FixtureUser } from '../fixtures.js';
import type { SmokeTest, TestContext } from '../types.js';
import type { ApiClient } from '../api.js';

/** Fixture slots 1..7 are taken by the LFG/LFM smokes; 8 + 9 are ours. */
const MEMBER_A_SLOT = 8;
const MEMBER_B_SLOT = 9;

/** The payload discriminator (`scheduling-unanimous.helpers.ts`). */
const UNANIMOUS_SUBTYPE = 'scheduling_poll_unanimous_time';

/** `All {n} members said yes to <t:{unix}:f>. Lock it in.` */
const MESSAGE_RE = /^All (\d+) members said yes to <t:(\d+):f>\. Lock it in\.$/;

interface CreatePollResponse {
  id: number;
  lineupId: number;
  gameName: string;
}

interface SlotVoter {
  userId: number;
}

interface PollSlot {
  id: number;
  proposedTime: string;
  votes?: SlotVoter[];
}

interface TestNotification {
  id: number;
  title?: string;
  message?: string;
  payload?: {
    subtype?: string;
    lineupId?: number;
    matchId?: number;
    slotId?: number;
    lockLabel?: string;
  } | null;
}

/** The creator's recent community_lineup notifications (empty on error). */
async function fetchNotifications(
  api: ApiClient,
  userId: number,
): Promise<TestNotification[]> {
  const res = await api
    .get<TestNotification[]>(
      `/admin/test/notifications?userId=${userId}&type=community_lineup&limit=50`,
    )
    .catch(() => [] as TestNotification[]);
  return Array.isArray(res) ? res : [];
}

/**
 * This run's unanimous notifications for `slotId`. Ghost ids (rows that
 * existed before the votes were cast) are excluded: CI reseeds the same
 * lineup/match ids every run, so a prior run's row must never satisfy the
 * probe — nor inflate the once-ness count.
 */
function unanimousRows(
  list: TestNotification[],
  ghostIds: Set<number>,
  matchId: number,
  slotId: number,
): TestNotification[] {
  return list.filter(
    (n) =>
      !ghostIds.has(n.id) &&
      n.payload?.subtype === UNANIMOUS_SUBTYPE &&
      n.payload?.matchId === matchId &&
      n.payload?.slotId === slotId,
  );
}

/** Wait until the creator holds this run's unanimous notification. */
async function waitForUnanimousDm(
  ctx: TestContext,
  ghostIds: Set<number>,
  matchId: number,
  slotId: number,
): Promise<TestNotification> {
  return pollForCondition(
    async () => {
      const list = await fetchNotifications(ctx.api, ctx.testUserId);
      return unanimousRows(list, ghostIds, matchId, slotId)[0] ?? null;
    },
    ctx.config.timeoutMs,
    { intervalMs: 1500 },
  );
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

/** Read one slot off the poll page (with its YES voters). */
async function readSlot(
  api: ApiClient,
  base: string,
  slotId: number,
): Promise<PollSlot> {
  const page = await api.get<{ slots: PollSlot[] }>(base);
  const slot = (page.slots ?? []).find((s) => s.id === slotId);
  if (!slot) throw new Error(`Slot ${slotId} missing from ${base}`);
  return slot;
}

/**
 * Cast `slotId` as `member`, asserting the toggle landed on the wanted
 * stance — a silent toggle-OFF would break unanimity and turn every later
 * assertion into a confusing timeout.
 */
async function voteYes(
  member: FixtureUser,
  base: string,
  slotId: number,
  want: boolean,
): Promise<void> {
  const res = await member.api.post<{ voted: boolean }>(`${base}/vote`, {
    slotId,
  });
  if (res.voted !== want) {
    throw new Error(
      `Expected user ${member.userId}'s toggle on slot ${slotId} to leave ` +
        `voted=${want}, got ${JSON.stringify(res)}`,
    );
  }
}

/** Every assertion on the DM's copy (title + the templated message). */
function assertCopy(
  dm: TestNotification,
  gameName: string,
  slot: PollSlot,
): void {
  const expectedTitle = `Everyone's in for ${gameName}`;
  if (dm.title !== expectedTitle) {
    throw new Error(
      `Expected DM title "${expectedTitle}", got "${dm.title ?? '<missing>'}"`,
    );
  }
  const match = MESSAGE_RE.exec(dm.message ?? '');
  if (!match) {
    throw new Error(
      `Expected message "All {n} members said yes to <t:UNIX:f>. Lock it in.",` +
        ` got "${dm.message ?? '<missing>'}"`,
    );
  }
  const expectedUnix = Math.floor(Date.parse(slot.proposedTime) / 1000);
  if (Number(match[2]) !== expectedUnix) {
    throw new Error(
      `Expected the <t:…:f> token to name slot ${slot.id} ` +
        `(${expectedUnix}, ${slot.proposedTime}), got ${match[2]}`,
    );
  }
  const stated = Number(match[1]);
  const yesVotes = slot.votes?.length ?? 0;
  if (stated !== yesVotes || stated < 2) {
    throw new Error(
      `Expected the DM to say all ${yesVotes} members said yes ` +
        `(and >1, the n>1 floor), got ${stated}`,
    );
  }
}

/** The payload fields `buildLineupButton` turns into the Lock link. */
function assertLockPayload(
  dm: TestNotification,
  poll: CreatePollResponse,
  slotId: number,
): void {
  const p = dm.payload ?? {};
  if (p.slotId !== slotId) {
    throw new Error(
      `Expected payload.slotId=${slotId} (drives ?lock=<slotId>), got ${String(p.slotId)}`,
    );
  }
  if (typeof p.lockLabel !== 'string' || p.lockLabel.trim() === '') {
    throw new Error(
      `Expected a non-empty payload.lockLabel (the Lock button's label), got ${JSON.stringify(p.lockLabel)}`,
    );
  }
  if (p.lineupId !== poll.lineupId || p.matchId !== poll.id) {
    throw new Error(
      `Expected payload to deep-link lineup ${poll.lineupId} / match ${poll.id}, ` +
        `got ${String(p.lineupId)} / ${String(p.matchId)}`,
    );
  }
}

/**
 * Un-vote then re-vote one member and prove no SECOND notification follows.
 * The re-vote is confirmed on the poll page before counting, so the vote
 * write (which is what fires the un-awaited `checkMatch`) has definitely
 * committed; `awaitProcessing` then drains the notification queue.
 */
async function assertOnlyOnce(
  ctx: TestContext,
  member: FixtureUser,
  ids: { base: string; slotId: number; matchId: number },
  ghostIds: Set<number>,
): Promise<void> {
  await voteYes(member, ids.base, ids.slotId, false);
  await awaitProcessing(ctx.api);
  await voteYes(member, ids.base, ids.slotId, true);
  await pollForCondition(
    async () => {
      const slot = await readSlot(ctx.api, ids.base, ids.slotId);
      return (slot.votes ?? []).some((v) => v.userId === member.userId)
        ? slot
        : null;
    },
    ctx.config.timeoutMs,
    { intervalMs: 1000 },
  );
  await awaitProcessing(ctx.api);

  const rows = unanimousRows(
    await fetchNotifications(ctx.api, ctx.testUserId),
    ghostIds,
    ids.matchId,
    ids.slotId,
  );
  if (rows.length !== 1) {
    throw new Error(
      `Expected exactly 1 unanimous notification after an undo+redo ` +
        `(the permanent sched-poll-unanimous:${ids.matchId}:${ids.slotId} claim), got ${rows.length}`,
    );
  }
}

const unanimousTimeDmsTheCreator: SmokeTest = {
  name: "ROK-1632 AC3: a time every member said yes to DMs the poll's creator",
  category: 'dm',
  async run(ctx: TestContext) {
    const gameId = await resolveGameId(ctx);
    const memberA = await seedFixtureUser(ctx.api, 3, MEMBER_A_SLOT);
    const memberB = await seedFixtureUser(ctx.api, 3, MEMBER_B_SLOT);

    // The admin creates the poll, so `community_lineups.created_by` — the
    // DM's recipient — is `ctx.testUserId`.
    const poll = await ctx.api.post<CreatePollResponse>('/scheduling-polls', {
      gameId,
      durationHours: 24,
      memberUserIds: [memberA.userId, memberB.userId],
    });
    const base = `/lineups/${poll.lineupId}/schedule/${poll.id}`;

    try {
      await awaitProcessing(ctx.api);
      // Everything the creator already holds is a ghost of an earlier run.
      const ghostIds = new Set(
        (await fetchNotifications(ctx.api, ctx.testUserId)).map((n) => n.id),
      );

      // Suggesting auto-votes YES as the admin and enrols them as a member.
      const proposedTime = new Date(Date.now() + 7 * 86_400_000).toISOString();
      const { id: slotId } = await ctx.api.post<{ id: number }>(
        `${base}/suggest`,
        { proposedTime },
      );

      // …and now EVERY other member says yes to that same time.
      await voteYes(memberA, base, slotId, true);
      await voteYes(memberB, base, slotId, true);
      await awaitProcessing(ctx.api);

      const dm = await waitForUnanimousDm(ctx, ghostIds, poll.id, slotId);
      const slot = await readSlot(ctx.api, base, slotId);
      assertCopy(dm, poll.gameName, slot);
      assertLockPayload(dm, poll, slotId);

      await assertOnlyOnce(
        ctx,
        memberB,
        { base, slotId, matchId: poll.id },
        ghostIds,
      );
    } finally {
      // Shared guild — never leave an open poll behind (it keeps a live card
      // in the game channel and pollutes the next run's banner).
      await ctx.api
        .post(`${base}/cancel`, { reason: 'smoke cleanup ROK-1632' })
        .catch(() => null);
      await ctx.api
        .patch(`/lineups/${poll.lineupId}/status`, { status: 'archived' })
        .catch(() => null);
    }
  },
};

export const schedulingUnanimousDmTests: SmokeTest[] = [
  unanimousTimeDmsTheCreator,
];
