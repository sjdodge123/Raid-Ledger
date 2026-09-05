/**
 * ROK-1374 — tie hold Discord smoke tests (scenarios 28–30).
 *
 * A completed vote with no decidable winner used to go silent: the grace job
 * swallowed `TIEBREAKER_REQUIRED`, cleared the countdown and told nobody. The
 * tie hold now announces ONE channel message and edits that same message for
 * the rest of the tie's life (D6/D7).
 *
 * What these assert:
 *   28. Public tie → exactly one message; no `<@`, no "you own", no ownership
 *       counts. The embed is viewer-independent by construction (AC8/AC9).
 *   29. A pick edits the SAME message id to the decided state and posts no
 *       second message (AC8/D7).
 *   30. Private tie → DM only, channel embed suppressed (AC10/E22).
 *
 * Drive path: `/admin/test/lineup/fire-deadline-transition` runs the deadline job
 * that Lane A1 taught to record the tie, so no new DEMO_MODE hook is needed.
 */
import { readLastMessages, type SimpleMessage } from '../../helpers/messages.js';
import { awaitProcessing, assertConditionNeverMet } from '../fixtures.js';
import { pollForCondition, pollForEmbed } from '../../helpers/polling.js';
import type { SmokeTest, TestContext } from '../types.js';
import type { ApiClient } from '../api.js';

const GRACE_KEY = 'lineup_auto_advance_grace_ms';
const GRACE_MS = 3000;

interface LineupPayload {
  id: number;
  title?: string;
  [k: string]: unknown;
}

interface TestNotification {
  payload?: { subtype?: string; lineupId?: number } | null;
}

async function archiveAllLineups(api: ApiClient): Promise<void> {
  const res = await api
    .get<{ id: number }[] | { id: number } | null>('/lineups/active')
    .catch(() => null);
  const list = Array.isArray(res) ? res : res ? [res] : [];
  for (const row of list) {
    if (!row?.id) continue;
    await api.patch(`/lineups/${row.id}/status`, { status: 'archived' }).catch(
      () => null,
    );
  }
}

async function deleteLineup(api: ApiClient, id: number): Promise<void> {
  await api.delete(`/lineups/${id}`).catch(() =>
    api.patch(`/lineups/${id}/status`, { status: 'archived' }).catch(() => null),
  );
}

/** Everything an embed renders, flattened — the tie copy lives on the author. */
function embedText(msg: SimpleMessage): string {
  return msg.embeds
    .map((e) => [e.title ?? '', e.author ?? '', e.description ?? ''].join(' '))
    .join(' ');
}

/** The tie message for THIS lineup: TIED/DECIDED/EXPIRED plus the title. */
function isTieEmbed(msg: SimpleMessage, title: string): boolean {
  const text = embedText(msg);
  return /TIED|DECIDED|EXPIRED/.test(text) && text.includes(title);
}

/**
 * Build a lineup, nominate, open voting, and split the votes evenly so the
 * top two games tie. Two games with one vote each is the operator's exact
 * reported scenario.
 */
async function buildTiedLineup(
  ctx: TestContext,
  title: string,
  opts: { visibility: 'public' | 'private' },
): Promise<{ lineupId: number; gameIds: number[] }> {
  const body: Record<string, unknown> = {
    title,
    description: 'ROK-1374 tie hold smoke',
    buildingDurationHours: 720,
    votingDurationHours: 720,
    decidedDurationHours: 720,
    matchThreshold: 10,
  };
  if (opts.visibility === 'private') {
    body.visibility = 'private';
    body.inviteeUserIds = [ctx.dmRecipientUserId];
  }
  const created = await ctx.api.post<LineupPayload>('/lineups', body);
  const gamesRes = await ctx.api.get<{ data: { id: number }[] }>(
    '/games/configured',
  );
  const gameIds = (gamesRes?.data ?? []).slice(0, 3).map((g) => g.id);
  if (gameIds.length < 2) {
    throw new Error(`Need at least 2 configured games, got ${gameIds.length}`);
  }
  for (const gid of gameIds.slice(0, 2)) {
    await ctx.api.post(`/lineups/${created.id}/nominate`, { gameId: gid });
  }
  await ctx.api.post('/admin/test/nominate-game', {
    lineupId: created.id,
    gameId: gameIds[gameIds.length - 1],
    userId: ctx.dmRecipientUserId,
  });
  await ctx.api.patch(`/lineups/${created.id}/status`, { status: 'voting' });
  await ctx.api.post(`/lineups/${created.id}/vote`, { gameId: gameIds[0] });
  await ctx.api.post('/admin/test/cast-vote', {
    lineupId: created.id,
    gameId: gameIds[1],
    userId: ctx.dmRecipientUserId,
  });
  return { lineupId: created.id, gameIds };
}

/** Run the deadline job that records the tie (Lane A1's executeTransition). */
async function driveTie(ctx: TestContext, lineupId: number): Promise<void> {
  // ROK-1363's hook lives on the `admin/test/lineup` controller.
  await ctx.api.post('/admin/test/lineup/fire-deadline-transition', {
    lineupId,
    targetStatus: 'decided',
  });
  await awaitProcessing(ctx.api);
}

/** Poll the in-app notification row — bots cannot read another bot's DMs. */
async function waitForTieDM(
  ctx: TestContext,
  lineupId: number,
  subtype: string,
): Promise<TestNotification> {
  return pollForCondition(
    async () => {
      const list = await ctx.api
        .get<TestNotification[]>(
          `/admin/test/notifications?userId=${ctx.dmRecipientUserId}` +
            '&type=community_lineup&limit=25',
        )
        .catch(() => [] as TestNotification[]);
      return (
        (Array.isArray(list) ? list : []).find(
          (n) => n.payload?.subtype === subtype && n.payload.lineupId === lineupId,
        ) ?? null
      );
    },
    ctx.config.timeoutMs,
    { intervalMs: 1500 },
  );
}

// ── 28: one message, and it renders the same for everyone ──────────────

const publicTieAnnouncesOnce: SmokeTest = {
  name: 'Public tie announces one viewer-independent embed (ROK-1374 AC8/AC9)',
  category: 'embed',
  async run(ctx: TestContext) {
    await archiveAllLineups(ctx.api);
    const title = `Tie Hold ${Date.now()}`;
    const { lineupId } = await buildTiedLineup(ctx, title, {
      visibility: 'public',
    });
    try {
      await driveTie(ctx, lineupId);
      const msg = await pollForEmbed(
        ctx.defaultChannelId,
        (m) => isTieEmbed(m, title),
        ctx.config.timeoutMs,
      );
      // Claim the id BEFORE the first assertion so `finally` always cleans up.
      const messageId = msg.id;
      const text = embedText(msg);
      if (!/TIED/.test(text)) {
        throw new Error(`Tie embed ${messageId} is not in the TIED state`);
      }
      if (text.includes('<@')) {
        throw new Error(`Tie embed ${messageId} carries a mention: ${text}`);
      }
      if (/you own/i.test(text)) {
        throw new Error(`Tie embed ${messageId} carries per-viewer copy`);
      }
      if (/\bown(s|ed)?\b.*\d+\s*\/\s*\d+/i.test(text)) {
        throw new Error(`Tie embed ${messageId} carries ownership counts`);
      }
      await assertConditionNeverMet(
        async () => {
          const msgs = await readLastMessages(ctx.defaultChannelId, 25);
          return msgs.filter((m) => isTieEmbed(m, title)).length > 1;
        },
        8_000,
        `A second tie message appeared for "${title}" — D7 allows exactly one`,
        { intervalMs: 2000 },
      );
    } finally {
      await deleteLineup(ctx.api, lineupId);
    }
  },
};

// ── 29: the pick EDITS that same message ───────────────────────────────

const tiePickEditsSameMessage: SmokeTest = {
  name: 'Picking a tied game edits the same tie message (ROK-1374 AC8/D7)',
  category: 'embed',
  async run(ctx: TestContext) {
    await archiveAllLineups(ctx.api);
    await ctx.api.post('/admin/test/set-setting', {
      key: GRACE_KEY,
      value: String(GRACE_MS),
    });
    const title = `Tie Pick ${Date.now()}`;
    const { lineupId, gameIds } = await buildTiedLineup(ctx, title, {
      visibility: 'public',
    });
    try {
      await driveTie(ctx, lineupId);
      const announced = await pollForEmbed(
        ctx.defaultChannelId,
        (m) => isTieEmbed(m, title),
        ctx.config.timeoutMs,
      );
      const messageId = announced.id;

      await ctx.api.post(`/lineups/${lineupId}/tiebreaker/pick`, {
        gameId: gameIds[0],
      });
      await awaitProcessing(ctx.api);

      const edited = await pollForCondition(
        async () => {
          const msgs = await readLastMessages(ctx.defaultChannelId, 25);
          const same = msgs.find((m) => m.id === messageId);
          return same && /DECIDED/.test(embedText(same)) ? same : null;
        },
        ctx.config.timeoutMs,
        { intervalMs: 1500 },
      );
      if (edited.id !== messageId) {
        throw new Error(
          `Expected message ${messageId} to be edited, got ${edited.id}`,
        );
      }
      await assertConditionNeverMet(
        async () => {
          const msgs = await readLastMessages(ctx.defaultChannelId, 25);
          return msgs.filter((m) => isTieEmbed(m, title)).length > 1;
        },
        8_000,
        `The pick posted a SECOND message for "${title}" — D7 requires an edit`,
        { intervalMs: 2000 },
      );
    } finally {
      await ctx.api
        .post('/admin/test/set-setting', { key: GRACE_KEY, value: null })
        .catch(() => null);
      await deleteLineup(ctx.api, lineupId);
    }
  },
};

// ── 30: a private tie is DM-only ───────────────────────────────────────

const privateTieSuppressesChannel: SmokeTest = {
  name: 'Private tie DMs the roster and posts no channel embed (ROK-1374 AC10)',
  category: 'dm',
  async run(ctx: TestContext) {
    await archiveAllLineups(ctx.api);
    const title = `Private Tie ${Date.now()}`;
    const { lineupId } = await buildTiedLineup(ctx, title, {
      visibility: 'private',
    });
    try {
      await driveTie(ctx, lineupId);
      await waitForTieDM(ctx, lineupId, 'lineup_tie_detected');
      await assertConditionNeverMet(
        async () => {
          const msgs = await readLastMessages(ctx.defaultChannelId, 25);
          return msgs.some((m) => isTieEmbed(m, title));
        },
        8_000,
        `Channel received a tie embed for private lineup "${title}"`,
        { intervalMs: 2000 },
      );
    } finally {
      await deleteLineup(ctx.api, lineupId);
    }
  },
};

export const lineupTieTests: SmokeTest[] = [
  publicTieAnnouncesOnce,
  tiePickEditsSameMessage,
  privateTieSuppressesChannel,
];
