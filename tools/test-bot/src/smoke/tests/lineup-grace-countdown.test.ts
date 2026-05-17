/**
 * ROK-1253 — Grace-countdown smoke test (AC-T5).
 * ROK-1296 — adapted for submission-presence quorum: a vote-toggle no
 * longer breaks quorum (submission stamps persist). The equivalent
 * quorum-break action under the new semantics is `addInvitee` — adding
 * an unsubmitted voter grows the expected set and re-evaluates quorum
 * synchronously (see `LineupsService.addInvitees` ROK-1296 hook).
 *
 * Verifies the end-to-end behavior of the pre-advance grace window
 * against the live API + Discord bot:
 *
 *   1. Three-person private lineup is created and force-advanced into
 *      voting.
 *   2. Each invitee casts their single vote AND calls submit-votes →
 *      quorum closes → `pendingAdvanceAt` becomes a populated ISO string
 *      on GET /lineups/:id without the status flipping.
 *   3. A 4th invitee is added (unsubmitted) → `pendingAdvanceAt` is
 *      cleared synchronously by the `addInvitees → maybeAutoAdvance`
 *      hook and the lineup stays in voting.
 *   4. The new invitee votes AND submits → `pendingAdvanceAt` populates
 *      again → after the short grace window elapses the BullMQ job fires
 *      and the lineup transitions to `decided`.
 *
 * The grace TTL is shortened via `POST /admin/test/set-setting` (a
 * DEMO_MODE-only endpoint that the dev for ROK-1253 must add — its
 * absence is part of the TDD failure surface). We reset the setting
 * in `finally` so a short value never bleeds into other tests.
 *
 * CLAUDE.md rules followed:
 *   - Uses pollForCondition exclusively; no fixed-delay waits.
 *   - Setting override via the existing settings-override admin/test
 *     endpoint pattern, not a one-off flush.
 */
import { pollForCondition } from '../../helpers/polling.js';
import { awaitProcessing } from '../fixtures.js';
import type { SmokeTest, TestContext } from '../types.js';
import type { ApiClient } from '../api.js';

const GRACE_KEY = 'lineup_auto_advance_grace_ms';
const GRACE_MS = 3000;

interface LineupPayload {
  id: number;
  status: string;
  visibility?: string;
  invitees?: unknown[];
  pendingAdvanceAt?: string | null;
  autoAdvancePausedAt?: string | null;
  entries?: { gameId: number }[];
  [k: string]: unknown;
}

/** Best-effort archival of any active lineup so create succeeds. */
async function archiveAllLineups(api: ApiClient): Promise<void> {
  try {
    const res = await api.get<
      { id: number }[] | { id: number } | null
    >('/lineups/active');
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

/**
 * Push a setting override via the demo-test endpoint. The dev for
 * ROK-1253 must surface this endpoint; if it returns 404 the test
 * fails-by-construction.
 */
async function setSetting(
  api: ApiClient,
  key: string,
  value: string | null,
): Promise<void> {
  await api.post('/admin/test/set-setting', { key, value });
}

/** Fetch full lineup detail. */
async function fetchLineup(
  api: ApiClient,
  lineupId: number,
): Promise<LineupPayload> {
  return api.get<LineupPayload>(`/lineups/${lineupId}`);
}

const graceCountdown: SmokeTest = {
  name: 'Grace countdown surfaces, clears on un-vote, advances after re-vote (ROK-1253)',
  category: 'flow',
  async run(ctx: TestContext) {
    await archiveAllLineups(ctx.api);
    await setSetting(ctx.api, GRACE_KEY, String(GRACE_MS));

    // Three-person private lineup. The companion bot's user is one
    // invitee; the admin (logged in via ctx.api) is the second seat.
    // We need a third human to drive a 3-voter quorum, so we use one
    // of the demo users provisioned by the test bot.
    const otherInviteeId = pickThirdParticipant(ctx);
    if (!otherInviteeId) {
      throw new Error(
        'No third demo user available for the 3-person quorum — check ctx.demoUserIds',
      );
    }

    const title = `Grace Countdown ${Date.now()}`;
    const lineup = await ctx.api.post<LineupPayload>('/lineups', {
      title,
      description: 'Grace window smoke',
      visibility: 'private',
      inviteeUserIds: [ctx.dmRecipientUserId, otherInviteeId],
      votesPerPlayer: 1,
    });

    try {
      // Each participant nominates a game so building quorum can be
      // bypassed by force-advancing. The shared smoke fixture only
      // surfaces the MMO game in `ctx.games`, so fetch 2 distinct games
      // from the admin games endpoint directly. CI demo seed always has
      // enough — operator tested with the same endpoint.
      const gamesRes = await ctx.api.get<{ data: { id: number }[] }>(
        '/admin/settings/games?limit=2',
      );
      const games = gamesRes?.data ?? [];
      if (games.length < 2) {
        throw new Error(
          `Smoke needs ≥2 seeded games; /admin/settings/games returned ${games.length}`,
        );
      }
      const gameA = games[0].id;
      const gameB = games[1].id;

      // Admin and the two invitees each nominate a game. We use the
      // admin/test/nominate-game shortcut so we don't need separate
      // JWTs for the invitee users.
      await ctx.api.post('/admin/test/nominate-game', {
        lineupId: lineup.id,
        gameId: gameA,
        userId: ctx.testUserId,
      });
      await ctx.api.post('/admin/test/nominate-game', {
        lineupId: lineup.id,
        gameId: gameB,
        userId: ctx.dmRecipientUserId,
      });

      // Force-advance into voting (the grace-window behavior we care
      // about is the voting → decided transition).
      await ctx.api.patch(`/lineups/${lineup.id}/status`, {
        status: 'voting',
      });
      await awaitProcessing(ctx.api);

      // Cast every voter's single vote.
      const voterIds = [ctx.testUserId, ctx.dmRecipientUserId, otherInviteeId];
      for (const userId of voterIds) {
        await ctx.api.post('/admin/test/cast-vote', {
          lineupId: lineup.id,
          gameId: gameA,
          userId,
        });
      }

      // ROK-1296: quorum is now driven by submit-presence, so each voter
      // must explicitly submit-votes. The third submit closes quorum.
      for (const userId of voterIds) {
        await ctx.api.post('/admin/test/submit-votes', {
          lineupId: lineup.id,
          userId,
        });
      }

      // After the third submit: pendingAdvanceAt populates and status
      // STAYS 'voting' (grace window in effect).
      await pollForCondition(
        async () => {
          const detail = await fetchLineup(ctx.api, lineup.id);
          if (
            typeof detail.pendingAdvanceAt === 'string' &&
            detail.status === 'voting'
          ) {
            return detail;
          }
          return null;
        },
        10_000,
        { intervalMs: 500 },
      );

      // ROK-1296 quorum-break: add a fourth invitee (unsubmitted) → the
      // `addInvitees → maybeAutoAdvance` hook clears pendingAdvanceAt
      // synchronously because the expected-voter set just grew by one.
      const fourthInviteeId = pickFourthParticipant(ctx, voterIds);
      if (!fourthInviteeId) {
        throw new Error(
          'No fourth demo user available to break quorum — check ctx.demoUserIds',
        );
      }
      await ctx.api.post(`/lineups/${lineup.id}/invitees`, {
        userIds: [fourthInviteeId],
      });

      // pendingAdvanceAt clears synchronously.
      await pollForCondition(
        async () => {
          const detail = await fetchLineup(ctx.api, lineup.id);
          if (detail.pendingAdvanceAt == null && detail.status === 'voting') {
            return detail;
          }
          return null;
        },
        8_000,
        { intervalMs: 500 },
      );

      // 4th invitee votes + submits → quorum closes again, grace re-schedules.
      await ctx.api.post('/admin/test/cast-vote', {
        lineupId: lineup.id,
        gameId: gameA,
        userId: fourthInviteeId,
      });
      await ctx.api.post('/admin/test/submit-votes', {
        lineupId: lineup.id,
        userId: fourthInviteeId,
      });

      // After grace elapses (~3s + worker tick), the lineup advances
      // to `decided`.
      await pollForCondition(
        async () => {
          const detail = await fetchLineup(ctx.api, lineup.id);
          return detail.status === 'decided' ? detail : null;
        },
        20_000,
        { intervalMs: 750 },
      );
    } finally {
      await setSetting(ctx.api, GRACE_KEY, null).catch(() => null);
      await deleteLineup(ctx.api, lineup.id);
    }
  },
};

/** Pick a demo user that is NOT the admin or the DM-recipient. */
function pickThirdParticipant(ctx: TestContext): number | undefined {
  if (!ctx.demoUserIds?.length) return undefined;
  return ctx.demoUserIds.find(
    (id) => id !== ctx.testUserId && id !== ctx.dmRecipientUserId,
  );
}

/** Pick a demo user not already in the voter set (ROK-1296 quorum-break). */
function pickFourthParticipant(
  ctx: TestContext,
  exclude: number[],
): number | undefined {
  if (!ctx.demoUserIds?.length) return undefined;
  const excludeSet = new Set(exclude);
  return ctx.demoUserIds.find((id) => !excludeSet.has(id));
}

export const lineupGraceCountdownTests: SmokeTest[] = [graceCountdown];
