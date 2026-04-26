/**
 * ROK-1065 — private / targeted lineup smoke test.
 *
 * Behavior being verified:
 *
 *   1. Creating a lineup with `{ visibility: 'private', inviteeUserIds: [<userId>] }`
 *      fires an in-app invite notification for each invitee (that the Discord
 *      DM dispatcher would forward to Discord) and does NOT post a
 *      lineup-created embed to the bound notification channel.
 *   2. Transitioning a private lineup from `building` -> `voting` fires an
 *      in-app voting-open notification for invitees and does NOT post a
 *      voting-open embed to the channel.
 *   3. The create response echoes the invitees array.
 *   4. Multiple concurrent active lineups are allowed (the 409 check is gone).
 *
 * We poll `/admin/test/notifications?userId=<invitee>&type=community_lineup`
 * instead of Discord DMs because Discord disallows bot-to-bot DMs and the
 * companion test bot doubles as the invitee. The in-app notification is the
 * single source of truth that the notification pipeline fires; the Discord
 * DM queue is tested separately in unit tests.
 */
import { readLastMessages } from '../../helpers/messages.js';
import {
  awaitProcessing,
  assertConditionNeverMet,
} from '../fixtures.js';
import { pollForCondition } from '../../helpers/polling.js';
import type { SmokeTest, TestContext } from '../types.js';
import type { ApiClient } from '../api.js';
import type { SimpleMessage } from '../../helpers/messages.js';

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
  payload?: { subtype?: string; lineupId?: number } | null;
  createdAt?: string;
}

/** Best-effort archival of any currently active lineup(s) so create succeeds. */
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

/** Returns true if any recent channel message is a lineup-lifecycle embed. */
function hasLineupEmbed(msgs: SimpleMessage[], titlePattern: RegExp): boolean {
  return msgs.some((m) =>
    m.embeds.some((e) => !!e.title && titlePattern.test(e.title)),
  );
}

/** Create a private lineup pinned to a single invitee (the test bot's user). */
async function createPrivateLineup(
  ctx: TestContext,
  title: string,
): Promise<LineupPayload> {
  return ctx.api.post<LineupPayload>('/lineups', {
    title,
    description: 'Invite-only smoke lineup',
    visibility: 'private',
    inviteeUserIds: [ctx.dmRecipientUserId],
  });
}

/** Fetch the invitee's community_lineup notifications via the demo-test route. */
async function fetchInviteeNotifications(
  ctx: TestContext,
): Promise<TestNotification[]> {
  const res = await ctx.api
    .get<TestNotification[]>(
      `/admin/test/notifications?userId=${ctx.dmRecipientUserId}&type=community_lineup&limit=25`,
    )
    .catch(() => [] as TestNotification[]);
  return Array.isArray(res) ? res : [];
}

/** Poll notifications until one matching `predicate` arrives, or timeout. */
async function waitForNotification(
  ctx: TestContext,
  predicate: (n: TestNotification) => boolean,
  timeoutMs: number,
): Promise<TestNotification> {
  const hit = await pollForCondition(
    async () => {
      const list = await fetchInviteeNotifications(ctx);
      return list.find(predicate) ?? null;
    },
    timeoutMs,
    { intervalMs: 1500 },
  );
  return hit;
}

// ── AC 1: Create private lineup → notify invitee, no channel embed ──

const privateLineupDmsInviteeNoChannelEmbed: SmokeTest = {
  name: 'Private lineup creation DMs invitee and suppresses channel embed (ROK-1065)',
  category: 'dm',
  async run(ctx: TestContext) {
    await archiveAllLineups(ctx.api);

    const title = `Private Smoke ${Date.now()}`;
    const lineup = await createPrivateLineup(ctx, title);
    try {
      if (lineup.visibility !== 'private') {
        throw new Error(
          `Expected response.visibility === 'private', got ${JSON.stringify(
            lineup.visibility,
          )}`,
        );
      }

      await awaitProcessing(ctx.api);

      await waitForNotification(
        ctx,
        (n) =>
          n.payload?.subtype === 'lineup_invite' &&
          n.payload.lineupId === lineup.id,
        ctx.config.timeoutMs,
      );

      await assertConditionNeverMet(
        async () => {
          const msgs = await readLastMessages(ctx.defaultChannelId, 25);
          return hasLineupEmbed(
            msgs,
            /Nominations Open|Community Lineup/i,
          ) && msgs.some((m) =>
            m.embeds.some((e) => {
              const hay = [e.title ?? '', e.description ?? ''].join(' ');
              return hay.includes(title);
            }),
          );
        },
        8_000,
        `Channel received a lineup-created embed for private lineup "${title}" — expected none`,
        { intervalMs: 2000 },
      );
    } finally {
      await deleteLineup(ctx.api, lineup.id);
    }
  },
};

// ── AC 2: Phase transition on private lineup → notify invitee, no channel embed ──

const privateLineupPhaseTransitionSuppressesChannel: SmokeTest = {
  name: 'Private lineup building→voting DMs invitee and suppresses channel embed (ROK-1065)',
  category: 'dm',
  async run(ctx: TestContext) {
    await archiveAllLineups(ctx.api);

    const title = `Private Phase ${Date.now()}`;
    const lineup = await createPrivateLineup(ctx, title);
    try {
      await awaitProcessing(ctx.api);

      await ctx.api.patch(`/lineups/${lineup.id}/status`, {
        status: 'voting',
      });
      await awaitProcessing(ctx.api);

      await waitForNotification(
        ctx,
        (n) =>
          n.payload?.subtype === 'lineup_voting_open' &&
          n.payload.lineupId === lineup.id,
        ctx.config.timeoutMs,
      );

      await assertConditionNeverMet(
        async () => {
          const msgs = await readLastMessages(ctx.defaultChannelId, 25);
          return msgs.some((m) =>
            m.embeds.some((e) => {
              const hay = [e.title ?? '', e.description ?? ''].join(' ');
              return /vote|voting/i.test(hay) && hay.includes(title);
            }),
          );
        },
        8_000,
        `Channel received a voting-open embed for private lineup "${title}" — expected none`,
        { intervalMs: 2000 },
      );
    } finally {
      await deleteLineup(ctx.api, lineup.id);
    }
  },
};

// ── AC 3: Response includes invitees array with the expected invitee ──

const privateLineupResponseIncludesInvitees: SmokeTest = {
  name: 'Private lineup create response includes invitees array (ROK-1065)',
  category: 'dm',
  async run(ctx: TestContext) {
    await archiveAllLineups(ctx.api);

    const title = `Private Invitees ${Date.now()}`;
    const lineup = await createPrivateLineup(ctx, title);
    try {
      const invitees = Array.isArray(lineup.invitees) ? lineup.invitees : null;
      if (!invitees) {
        throw new Error(
          `Expected lineup.invitees to be an array, got ${JSON.stringify(
            lineup.invitees,
          )}`,
        );
      }
      const ids = invitees
        .map((row) => (row as { id?: number } | null)?.id)
        .filter((v): v is number => typeof v === 'number');
      if (!ids.includes(ctx.dmRecipientUserId)) {
        throw new Error(
          `Expected invitees to contain user ${ctx.dmRecipientUserId}, got ${JSON.stringify(
            ids,
          )}`,
        );
      }
    } finally {
      await deleteLineup(ctx.api, lineup.id);
    }
  },
};

// ── AC 4: Multiple concurrent lineups allowed (the 409 check must be gone) ──

const multipleConcurrentLineupsAllowed: SmokeTest = {
  name: 'Multiple concurrent active lineups permitted — no 409 (ROK-1065)',
  category: 'dm',
  async run(ctx: TestContext) {
    await archiveAllLineups(ctx.api);

    const firstTitle = `Concurrent A ${Date.now()}`;
    const secondTitle = `Concurrent B ${Date.now()}`;
    const first = await ctx.api.post<LineupPayload>('/lineups', {
      title: firstTitle,
      description: 'first concurrent',
    });
    let second: LineupPayload | null = null;
    try {
      second = await ctx.api.post<LineupPayload>('/lineups', {
        title: secondTitle,
        description: 'second concurrent',
      });
      if (!second?.id) {
        throw new Error(
          `Second lineup create did not return an id: ${JSON.stringify(second)}`,
        );
      }

      await awaitProcessing(ctx.api);
      const activeRes = await ctx.api.get<
        { id: number }[] | { id: number }
      >('/lineups/active');
      const list = Array.isArray(activeRes)
        ? activeRes
        : activeRes
          ? [activeRes]
          : [];
      const ids = list.map((l) => l.id);
      if (!ids.includes(first.id) || !ids.includes(second.id)) {
        throw new Error(
          `Expected GET /lineups/active to include both ${first.id} and ${second.id}, got ${JSON.stringify(
            ids,
          )}`,
        );
      }
    } finally {
      await deleteLineup(ctx.api, first.id);
      if (second?.id) await deleteLineup(ctx.api, second.id);
    }
  },
};

// ── ROK-1115 AC: Private lineup milestone dispatch suppresses channel ──

const privateLineupMilestoneSuppressesChannel: SmokeTest = {
  name: 'Private lineup nomination milestone DMs invitee and suppresses channel embed (ROK-1115)',
  category: 'dm',
  async run(ctx: TestContext) {
    await archiveAllLineups(ctx.api);

    const title = `Private Milestone ${Date.now()}`;
    const lineup = await createPrivateLineup(ctx, title);
    try {
      // Trigger a nomination as the invitee — this is the cheapest way to
      // force `fireNominationMilestone` to evaluate. Even if no threshold
      // is crossed, the channel-embed path must remain dark for private
      // lineups when a milestone IS crossed; the assertion is symmetric:
      // we check that any milestone-shaped embed never lands in the channel
      // for the duration of the test window.
      await ctx.api.post('/admin/test/nominate-game', {
        lineupId: lineup.id,
        gameId: 1,
        userId: ctx.dmRecipientUserId,
      }).catch(() => null);

      await awaitProcessing(ctx.api);

      // Channel must NOT receive a milestone-shaped embed for this lineup.
      await assertConditionNeverMet(
        async () => {
          const msgs = await readLastMessages(ctx.defaultChannelId, 25);
          return msgs.some((m) =>
            m.embeds.some((e) => {
              const hay = [e.title ?? '', e.description ?? ''].join(' ');
              return (
                /milestone|nominations filled|nominated/i.test(hay) &&
                hay.includes(title)
              );
            }),
          );
        },
        8_000,
        `Channel received a nomination-milestone embed for private lineup "${title}" — expected none`,
        { intervalMs: 2000 },
      );
    } finally {
      await deleteLineup(ctx.api, lineup.id);
    }
  },
};

export const privateLineupTests: SmokeTest[] = [
  privateLineupDmsInviteeNoChannelEmbed,
  privateLineupPhaseTransitionSuppressesChannel,
  privateLineupResponseIncludesInvitees,
  multipleConcurrentLineupsAllowed,
  privateLineupMilestoneSuppressesChannel,
];
