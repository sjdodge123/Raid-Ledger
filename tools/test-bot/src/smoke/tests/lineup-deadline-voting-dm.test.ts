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

/** The extension is written synchronously by the deadline job — a short poll. */
const EXTEND_ACTIVITY_TIMEOUT_MS = 20_000;

/** Negative bound: long enough that a real DM would have landed, short enough not to pad the suite. */
const NO_VOTING_DM_WINDOW_MS = 6_000;

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

/**
 * Seed `count` distinct nominations (ROK-1443).
 *
 * `BUILDING_DEADLINE_MIN_NOMINATIONS` is 2: at the building deadline, fewer
 * than two nominations extends the window once instead of advancing to
 * voting. Entries are unique per (lineup, game) and `ctx.games` only surfaces
 * the MMO game, so pull distinct ids from the admin games endpoint — the same
 * pattern `lineup-grace-countdown` uses.
 */
async function seedNominations(
  ctx: TestContext,
  lineupId: number,
  count: number,
): Promise<void> {
  const res = await ctx.api.get<{ data: { id: number }[] }>(
    `/admin/settings/games?limit=${count}`,
  );
  const games = res?.data ?? [];
  if (games.length < count) {
    throw new Error(
      `Smoke needs >=${count} seeded games for the ROK-1443 nomination floor; /admin/settings/games returned ${games.length}`,
    );
  }
  const userIds = [ctx.dmRecipientUserId, ctx.testUserId];
  for (let i = 0; i < count; i += 1) {
    await ctx.api.post('/admin/test/nominate-game', {
      lineupId,
      gameId: games[i].id,
      userId: userIds[i % userIds.length],
    });
  }
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
      // ROK-1443: the building deadline now has a nomination FLOOR of 2, so
      // seed two — one nomination would EXTEND instead of advancing and this
      // DM would never be sent (that branch is the sibling test below).
      await seedNominations(ctx, lineup.id, 2);
      await awaitProcessing(ctx.api);

      // Drive the DEADLINE path (not quorum/operator): fire the phase-transition
      // job directly. Auto-advance quorum (default 4) is intentionally NOT met —
      // only the deadline trigger is exercised.
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

/**
 * ROK-1443 operator ruling, the other branch: below the nomination floor the
 * building deadline EXTENDS once (activity row + channel notice) and voting
 * does NOT open — so no voting-open notification may be delivered.
 */
const belowFloorDeadlineExtendsInsteadOfOpeningVoting: SmokeTest = {
  name: 'Building deadline below the nomination floor extends instead of opening voting (ROK-1443)',
  category: 'dm',
  async run(ctx: TestContext) {
    await archiveAllLineups(ctx.api);

    const lineup = await ctx.api.post<LineupPayload>('/lineups', {
      title: `Deadline Extend ${Date.now()}`,
      description: 'ROK-1443 below-floor deadline extends once',
      visibility: 'private',
      inviteeUserIds: [ctx.dmRecipientUserId],
    });
    try {
      await seedNominations(ctx, lineup.id, 1);
      await awaitProcessing(ctx.api);

      await ctx.api.post('/admin/test/lineup/fire-deadline-transition', {
        lineupId: lineup.id,
        targetStatus: 'voting',
      });
      await awaitProcessing(ctx.api);

      await pollForCondition(
        async () => {
          const res = await ctx.api
            .get<{ data: { action: string }[] }>(
              `/lineups/${lineup.id}/activity`,
            )
            .catch(() => null);
          const extended = (res?.data ?? []).find(
            (row) => row.action === 'lineup_deadline_extended',
          );
          return extended ?? null;
        },
        EXTEND_ACTIVITY_TIMEOUT_MS,
        { intervalMs: 1000 },
      );

      const leaked = await waitForVotingOpenNotification(
        ctx,
        lineup.id,
        NO_VOTING_DM_WINDOW_MS,
      ).catch(() => null);
      if (leaked) {
        throw new Error(
          `Expected NO voting-open notification for below-floor lineup ${lineup.id} (deadline should have extended), but notification ${leaked.id} was delivered`,
        );
      }
    } finally {
      await deleteLineup(ctx.api, lineup.id);
    }
  },
};

export const lineupDeadlineVotingDmTests: SmokeTest[] = [
  deadlineVotingOpenDmsInvitee,
  belowFloorDeadlineExtendsInsteadOfOpeningVoting,
];
