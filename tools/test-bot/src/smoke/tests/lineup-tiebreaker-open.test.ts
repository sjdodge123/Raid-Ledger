/**
 * ROK-1117 — Tiebreaker open Discord smoke tests.
 *
 * AC:
 *   - Public lineup: when a tiebreaker is started, every expected voter
 *     (loadExpectedVoters) gets a community_lineup notification with
 *     `subtype === 'lineup_tiebreaker_open'`, AND a channel embed is
 *     posted to the lineup's bound channel.
 *   - Private lineup: when a tiebreaker is started, invitees + creator
 *     get the DM, channel embed is suppressed.
 *
 * TDD gate: these tests must FAIL until the dev agent wires
 * `LineupNotificationService.notifyTiebreakerOpen` from
 * `TiebreakerService.start()`.
 *
 * Strategy mirrors `private-lineup.test.ts`: we poll
 * `/admin/test/notifications?userId=<invitee>&type=community_lineup`
 * for the new notification subtype, and `pollForEmbed` for the channel
 * embed. The companion bot can't receive DMs from another bot, so the
 * in-app notification row is the canonical proof of dispatch.
 */
import { readLastMessages } from '../../helpers/messages.js';
import {
  awaitProcessing,
  assertConditionNeverMet,
} from '../fixtures.js';
import {
  pollForCondition,
  pollForEmbed,
} from '../../helpers/polling.js';
import type { SmokeTest, TestContext } from '../types.js';
import type { ApiClient } from '../api.js';

interface LineupPayload {
  id: number;
  title?: string;
  visibility?: string;
  invitees?: unknown[];
  [k: string]: unknown;
}

interface TestNotification {
  id: number;
  type: string;
  title?: string;
  message?: string;
  payload?: { subtype?: string; lineupId?: number; tiebreakerId?: number } | null;
  createdAt?: string;
}

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

async function fetchNotifications(
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

async function waitForTiebreakerDM(
  ctx: TestContext,
  userId: number,
  lineupId: number,
  timeoutMs: number,
): Promise<TestNotification> {
  return pollForCondition(
    async () => {
      const list = await fetchNotifications(ctx.api, userId);
      return (
        list.find(
          (n) =>
            n.payload?.subtype === 'lineup_tiebreaker_open' &&
            n.payload.lineupId === lineupId,
        ) ?? null
      );
    },
    timeoutMs,
    { intervalMs: 1500 },
  );
}

/** Build a public lineup ready for a tiebreaker.
 *
 * For PUBLIC lineups, `loadExpectedVoters` returns nominators ∪ voters.
 * The smoke bot's `dmRecipientUserId` must be in that set, otherwise no
 * tiebreaker-open DM is dispatched to them. We use the DEMO_MODE-only
 * `/admin/test/nominate-game` endpoint to record a nomination on the
 * dmRecipientUserId's behalf so they show up as a participant.
 */
async function buildPublicLineupWithTie(
  api: ApiClient,
  title: string,
  dmRecipientUserId: number,
): Promise<{ lineup: LineupPayload; gameIds: number[] }> {
  const created = await api.post<LineupPayload>('/lineups', {
    title,
    description: 'ROK-1117 tiebreaker-open smoke',
    buildingDurationHours: 720,
    votingDurationHours: 720,
    decidedDurationHours: 720,
    matchThreshold: 10,
  });

  const gamesRes = await api.get<{ data: { id: number }[] }>(
    '/games/configured',
  );
  const gameIds = (gamesRes?.data ?? []).slice(0, 4).map((g) => g.id);
  if (gameIds.length < 2) {
    throw new Error(`Need at least 2 configured games, got ${gameIds.length}`);
  }

  // Admin nominates the first three games; dmRecipientUserId nominates the
  // fourth via the DEMO_MODE-only test endpoint so they enter the public
  // expected-voters set (loadExpectedVoters returns nominators ∪ voters).
  // The (lineupId, gameId) uniqueness constraint means each game can only be
  // nominated once, so the two paths must operate on different games.
  for (const gid of gameIds.slice(0, gameIds.length - 1)) {
    await api.post(`/lineups/${created.id}/nominate`, { gameId: gid });
  }
  const dmRecipientGame = gameIds[gameIds.length - 1];
  if (dmRecipientGame !== undefined) {
    await api.post('/admin/test/nominate-game', {
      lineupId: created.id,
      gameId: dmRecipientGame,
      userId: dmRecipientUserId,
    });
  }

  await api.patch(`/lineups/${created.id}/status`, { status: 'voting' });

  // Cast equal votes on top 2 to force a tie.
  await api.post(`/lineups/${created.id}/vote`, { gameId: gameIds[0] });
  await api.post(`/lineups/${created.id}/vote`, { gameId: gameIds[1] });

  return { lineup: created, gameIds };
}

// ── AC 1: Public lineup tiebreaker → DMs + channel embed ───────────────

const publicTiebreakerOpenDmsAndEmbed: SmokeTest = {
  name: 'Public tiebreaker open DMs participants and posts channel embed (ROK-1117)',
  category: 'dm',
  async run(ctx: TestContext) {
    await archiveAllLineups(ctx.api);

    const title = `Public TB Open ${Date.now()}`;
    const { lineup } = await buildPublicLineupWithTie(
      ctx.api,
      title,
      ctx.dmRecipientUserId,
    );

    try {
      // Start the tiebreaker — this is the trigger under test.
      const tb = await ctx.api.post<{ id: number; status: string }>(
        `/lineups/${lineup.id}/tiebreaker`,
        { mode: 'veto', roundDurationHours: 24 },
      );
      await awaitProcessing(ctx.api);

      // (a) Expected-voter DM landed for the test bot's user.
      await waitForTiebreakerDM(
        ctx,
        ctx.dmRecipientUserId,
        lineup.id,
        ctx.config.timeoutMs,
      );

      // (b) Channel embed for tiebreaker-open posted to the bound channel.
      // We match on the tiebreaker title pattern (Veto / Bracket).
      await pollForEmbed(
        ctx.defaultChannelId,
        (m) =>
          m.embeds.some((e) => {
            const hay = [e.title ?? '', e.description ?? ''].join(' ');
            return /tiebreaker/i.test(hay) && /veto|cast your veto/i.test(hay);
          }),
        ctx.config.timeoutMs,
      );

      void tb;
    } finally {
      await deleteLineup(ctx.api, lineup.id);
    }
  },
};

// ── AC 2: Private lineup tiebreaker → DM only, channel embed suppressed ─

const privateTiebreakerOpenSuppressesChannel: SmokeTest = {
  name: 'Private tiebreaker open DMs invitee and suppresses channel embed (ROK-1117)',
  category: 'dm',
  async run(ctx: TestContext) {
    await archiveAllLineups(ctx.api);

    const title = `Private TB Open ${Date.now()}`;
    const created = await ctx.api.post<LineupPayload>('/lineups', {
      title,
      description: 'ROK-1117 private tiebreaker smoke',
      visibility: 'private',
      inviteeUserIds: [ctx.dmRecipientUserId],
      buildingDurationHours: 720,
      votingDurationHours: 720,
      decidedDurationHours: 720,
      matchThreshold: 10,
    });
    const lineupId = created.id;

    try {
      const gamesRes = await ctx.api.get<{ data: { id: number }[] }>(
        '/games/configured',
      );
      const gameIds = (gamesRes?.data ?? []).slice(0, 4).map((g) => g.id);
      if (gameIds.length < 2) {
        throw new Error(`Need ≥2 configured games, got ${gameIds.length}`);
      }
      for (const gid of gameIds) {
        await ctx.api.post(`/lineups/${lineupId}/nominate`, { gameId: gid });
      }
      await ctx.api.patch(`/lineups/${lineupId}/status`, { status: 'voting' });
      await ctx.api.post(`/lineups/${lineupId}/vote`, { gameId: gameIds[0] });
      await ctx.api.post(`/lineups/${lineupId}/vote`, { gameId: gameIds[1] });

      await ctx.api.post(`/lineups/${lineupId}/tiebreaker`, {
        mode: 'bracket',
        roundDurationHours: 24,
      });
      await awaitProcessing(ctx.api);

      // (a) Invitee receives the tiebreaker-open DM.
      await waitForTiebreakerDM(
        ctx,
        ctx.dmRecipientUserId,
        lineupId,
        ctx.config.timeoutMs,
      );

      // (b) Channel must NOT receive a tiebreaker-open embed.
      await assertConditionNeverMet(
        async () => {
          const msgs = await readLastMessages(ctx.defaultChannelId, 25);
          return msgs.some((m) =>
            m.embeds.some((e) => {
              const hay = [e.title ?? '', e.description ?? ''].join(' ');
              return /tiebreaker/i.test(hay) && hay.includes(title);
            }),
          );
        },
        8_000,
        `Channel received a tiebreaker-open embed for private lineup "${title}" — expected none`,
        { intervalMs: 2000 },
      );
    } finally {
      await deleteLineup(ctx.api, lineupId);
    }
  },
};

export const lineupTiebreakerOpenTests: SmokeTest[] = [
  publicTiebreakerOpenDmsAndEmbed,
  privateTiebreakerOpenSuppressesChannel,
];
