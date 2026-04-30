/**
 * ROK-1192 — Standalone scheduling poll deadline reminders.
 *
 * AC #13 (smoke): create a standalone poll with `durationHours: 24` and
 * one invited member, advance the poll's deadline to T-1h via the
 * (DEMO_MODE-only) `/admin/test/advance-standalone-poll-deadline`
 * endpoint, await processing, then verify:
 *   - the invited member receives a community_lineup notification with
 *     `payload.subtype === 'standalone_scheduling_poll_reminder'` and
 *     `payload.window === '1h'` and title containing "closing now",
 *   - the notification's matchId/lineupId match the created poll, which
 *     is what `notification-embed.buttons.ts:buildLineupButton` uses to
 *     auto-render a "Vote on a Time" button pointing at
 *     `${clientUrl}/community-lineup/{lineupId}/schedule/{matchId}`.
 *
 * TDD gate: this test must FAIL until the dev agent ships:
 *   - `StandalonePollReminderService` (cron + DM dispatch)
 *   - `/admin/test/advance-standalone-poll-deadline` (DEMO_MODE-only
 *     fast-forward of `phase_deadline` for the lineup)
 *   - `/admin/test/trigger-standalone-poll-reminders` (DEMO_MODE-only
 *     run-now hook for the cron, identical to other `trigger-*` admins)
 *
 * Bot DM rationale: companion bot cannot receive DMs from another bot
 * (Discord API 50007). The in-app notification row is the canonical
 * proof of dispatch — same approach used by `lineup-tiebreaker-open.test.ts`.
 */
import { pollForCondition } from '../../helpers/polling.js';
import { awaitProcessing } from '../fixtures.js';
import type { SmokeTest, TestContext } from '../types.js';
import type { ApiClient } from '../api.js';

interface CreatePollResponse {
  id: number;
  lineupId: number;
  gameId: number;
  gameName: string;
  status: string;
  memberCount: number;
}

interface TestNotification {
  id: number;
  type: string;
  title?: string;
  message?: string;
  payload?: {
    subtype?: string;
    lineupId?: number;
    matchId?: number;
    window?: string;
  } | null;
  createdAt?: string;
}

async function fetchCommunityLineupNotifications(
  api: ApiClient,
  userId: number,
): Promise<TestNotification[]> {
  const res = await api
    .get<TestNotification[]>(
      `/admin/test/notifications?userId=${userId}&type=community_lineup&limit=25`,
    )
    .catch(() => [] as TestNotification[]);
  return Array.isArray(res) ? res : [];
}

/** Wait for the standalone-poll 1h reminder DM to land in `userId`'s notifications. */
async function waitForReminderDM(
  ctx: TestContext,
  userId: number,
  matchId: number,
  lineupId: number,
  timeoutMs: number,
): Promise<TestNotification> {
  return pollForCondition(
    async () => {
      const list = await fetchCommunityLineupNotifications(ctx.api, userId);
      return (
        list.find(
          (n) =>
            n.payload?.subtype === 'standalone_scheduling_poll_reminder' &&
            n.payload?.matchId === matchId &&
            n.payload?.lineupId === lineupId &&
            n.payload?.window === '1h',
        ) ?? null
      );
    },
    timeoutMs,
    { intervalMs: 1500 },
  );
}

/**
 * Fast-forward the lineup's `phase_deadline` so it lands inside the 1h
 * window. The dev agent ships this DEMO_MODE-only endpoint as part of
 * ROK-1192 so the smoke test doesn't have to wait 23 real hours.
 *
 * Body: { lineupId, hoursUntilDeadline } — sets phase_deadline =
 *   now() + hoursUntilDeadline.
 */
async function advancePollDeadline(
  api: ApiClient,
  lineupId: number,
  hoursUntilDeadline: number,
): Promise<void> {
  await api.post('/admin/test/advance-standalone-poll-deadline', {
    lineupId,
    hoursUntilDeadline,
  });
}

/** Trigger the standalone-poll reminder cron once, on demand. */
async function triggerReminderCron(api: ApiClient): Promise<void> {
  await api.post('/admin/test/trigger-standalone-poll-reminders', {});
}

const standalonePoll1hReminderDm: SmokeTest = {
  name: 'Standalone poll fires 1h "Vote on a Time" reminder DM (ROK-1192)',
  category: 'dm',
  async run(ctx: TestContext) {
    if (!ctx.games.length) throw new Error('Need at least 1 configured game');
    const gameId = ctx.games[0].id;

    // 1. Create the poll. `durationHours: 24` → poll's phase_deadline
    //    sits 24h in the future and the invited member is on the
    //    match's member list (a non-voter at this point).
    const poll = await ctx.api.post<CreatePollResponse>('/scheduling-polls', {
      gameId,
      durationHours: 24,
      memberUserIds: [ctx.dmRecipientUserId],
      // No `minVoteThreshold` so the cron isn't pre-empted by completion.
    });

    try {
      // 2. Drain queues so the initial-create notifications settle
      //    before we reset the clock — keeps the assertion targeted at
      //    the deadline reminder, not the create-time DM.
      await awaitProcessing(ctx.api);

      // 3. Fast-forward the deadline into the 1h window.
      await advancePollDeadline(ctx.api, poll.lineupId, 0.5);

      // 4. Run the cron once.
      await triggerReminderCron(ctx.api);
      await awaitProcessing(ctx.api);

      // 5. Poll for the 1h reminder notification on the invited member.
      const dm = await waitForReminderDM(
        ctx,
        ctx.dmRecipientUserId,
        poll.id,
        poll.lineupId,
        ctx.config.timeoutMs,
      );

      // Title copy: spec mandates "Scheduling poll closing now".
      if (!/closing now|1 hour/i.test(dm.title ?? '')) {
        throw new Error(
          `Expected DM title to mention "closing now" / "1 hour", got: ${dm.title ?? '<missing>'}`,
        );
      }

      // The auto-rendered button URL is built by the client at render
      // time; our contract here is the IDs that go into it. Failing one
      // of these means buildLineupButton will produce the wrong URL.
      if (dm.payload?.lineupId !== poll.lineupId) {
        throw new Error(
          `Expected payload.lineupId=${poll.lineupId}, got ${dm.payload?.lineupId}`,
        );
      }
      if (dm.payload?.matchId !== poll.id) {
        throw new Error(
          `Expected payload.matchId=${poll.id}, got ${dm.payload?.matchId}`,
        );
      }
    } finally {
      // Best-effort cleanup — archive the lineup so it doesn't pile up.
      await ctx.api
        .patch(`/lineups/${poll.lineupId}/status`, { status: 'archived' })
        .catch(() => null);
    }
  },
};

export const standalonePollReminderTests: SmokeTest[] = [
  standalonePoll1hReminderDm,
];
