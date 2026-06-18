/**
 * ROK-1363 — deadline-driven voting-open DM smoke (Discord side).
 *
 * Bug: the deadline-expiry phase trigger (`executeTransition`) did a bare
 * status UPDATE that bypassed `runStatusTransition`, so a private lineup that
 * reached `voting` because its BUILDING DEADLINE expired (not because nomination
 * quorum was met) never DMed its invitees "Time to vote" — the quorum/grace
 * path already fired it, the deadline path silently didn't.
 *
 * The fix routes the deadline path through the same orchestrator. This smoke
 * exercises the DEADLINE trigger specifically (via the DEMO_MODE
 * `/admin/test/lineup/fire-deadline-transition` hook that drives the phase job
 * directly), then asserts the invitee received the voting-open notification.
 *
 * Sibling to `lineup-private-dm.test.ts`, which covers the same DM but on the
 * quorum/operator (PATCH /status) path. Discord disallows bot-to-bot DMs, so we
 * assert via the in-app notification mirror at /admin/test/notifications.
 */
import { awaitProcessing } from '../fixtures.js';
import { pollForCondition } from '../../helpers/polling.js';
import type { SmokeTest, TestContext } from '../types.js';
import type { ApiClient } from '../api.js';

interface LineupPayload {
  id: number;
  title?: string;
  [k: string]: unknown;
}

interface TestNotification {
  id: number;
  type: string;
  payload?: { subtype?: string; lineupId?: number } | null;
}

async function archiveAllLineups(api: ApiClient): Promise<void> {
  try {
    const res = await api.get<{ id: number }[] | { id: number } | null>(
      '/lineups/active',
    );
    const list = Array.isArray(res) ? res : res ? [res] : [];
    for (const row of list) {
      if (!row?.id) continue;
      await api
        .patch(`/lineups/${row.id}/status`, { status: 'archived' })
        .catch(() => null);
    }
  } catch {
    /* no active lineups */
  }
}

async function deleteLineup(api: ApiClient, id: number): Promise<void> {
  await api.delete(`/lineups/${id}`).catch(() => {
    return api
      .patch(`/lineups/${id}/status`, { status: 'archived' })
      .catch(() => null);
  });
}

async function waitForVotingOpenNotification(
  ctx: TestContext,
  lineupId: number,
  timeoutMs: number,
): Promise<TestNotification> {
  return pollForCondition(
    async () => {
      const list = await ctx.api
        .get<TestNotification[]>(
          `/admin/test/notifications?userId=${ctx.dmRecipientUserId}&type=community_lineup&limit=25`,
        )
        .catch(() => [] as TestNotification[]);
      const rows = Array.isArray(list) ? list : [];
      return (
        rows.find(
          (n) =>
            n.payload?.subtype === 'lineup_voting_open' &&
            n.payload.lineupId === lineupId,
        ) ?? null
      );
    },
    timeoutMs,
    { intervalMs: 1500 },
  );
}

const deadlineVotingOpenDmsInvitee: SmokeTest = {
  name: 'Deadline-driven building→voting DMs invitee the voting-open notification (ROK-1363)',
  category: 'dm',
  async run(ctx: TestContext) {
    await archiveAllLineups(ctx.api);

    const title = `Deadline Voting ${Date.now()}`;
    const lineup = await ctx.api.post<LineupPayload>('/lineups', {
      title,
      description: 'ROK-1363 deadline voting-open DM',
      visibility: 'private',
      inviteeUserIds: [ctx.dmRecipientUserId],
    });
    try {
      // Seed a nomination so the voting phase has at least one game to vote on.
      await ctx.api
        .post('/admin/test/nominate-game', {
          lineupId: lineup.id,
          gameId: 1,
          userId: ctx.dmRecipientUserId,
        })
        .catch(() => null);
      await awaitProcessing(ctx.api);

      // Drive the DEADLINE path (not quorum/operator): fire the phase-transition
      // job directly. Quorum is intentionally NOT met — only the deadline
      // trigger is exercised.
      await ctx.api.post('/admin/test/lineup/fire-deadline-transition', {
        lineupId: lineup.id,
        targetStatus: 'voting',
      });
      await awaitProcessing(ctx.api);

      // The invitee must receive the voting-open notification from the deadline
      // path — the exact DM the bug suppressed.
      await waitForVotingOpenNotification(ctx, lineup.id, ctx.config.timeoutMs);
    } finally {
      await deleteLineup(ctx.api, lineup.id);
    }
  },
};

export const lineupDeadlineVotingDmTests: SmokeTest[] = [
  deadlineVotingOpenDmsInvitee,
];
