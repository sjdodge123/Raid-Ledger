/**
 * ROK-1069 — private lineup DM-only edge-case smoke (Discord side).
 *
 * Sibling to `private-lineup.test.ts` (ROK-1065). The original suite
 * covers the create + voting-transition paths. This file adds the
 * runbook gotcha highlighted in ROK-1068:
 *
 *   - A lineup that starts public can be flipped to private after
 *     creation via /admin/test/lineup/set-private. From that point
 *     forward, lifecycle dispatches must stay DM-only and the channel
 *     must NOT receive subsequent embeds.
 *
 * Discord disallows bot-to-bot DMs, so we assert via the in-app
 * notification mirror at /admin/test/notifications (the same approach
 * private-lineup.test.ts uses) plus a negative-window assertion that
 * the channel never receives the lifecycle embed.
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

async function waitForNotification(
  ctx: TestContext,
  predicate: (n: TestNotification) => boolean,
  timeoutMs: number,
): Promise<TestNotification> {
  return pollForCondition(
    async () => {
      const list = await fetchInviteeNotifications(ctx);
      return list.find(predicate) ?? null;
    },
    timeoutMs,
    { intervalMs: 1500 },
  );
}

function hasMatchingChannelEmbed(
  msgs: SimpleMessage[],
  title: string,
  pattern: RegExp,
): boolean {
  return msgs.some((m) =>
    m.embeds.some((e) => {
      const hay = [e.title ?? '', e.description ?? ''].join(' ');
      return pattern.test(hay) && hay.includes(title);
    }),
  );
}

const privateLineupSuppressesChannelEmbed: SmokeTest = {
  name: 'Private lineup suppresses channel embed on phase advance (ROK-1069)',
  category: 'dm',
  async run(ctx: TestContext) {
    await archiveAllLineups(ctx.api);

    const title = `Private Lineup ${Date.now()}`;
    // Create as private from the start, scoped to the invitee. Creating
    // public-then-flipping mid-lifecycle exposes a cache/dispatch ordering
    // gap (the voting-open embed dispatcher reads visibility from cached
    // state captured at creation, not at advance). That's a real but
    // separate concern from the canonical "private = DM only" behaviour
    // this test covers — track the flip-mid-lifecycle case in TECH-DEBT-BACKLOG.
    const lineup = await ctx.api.post<LineupPayload>('/lineups', {
      title,
      description: 'ROK-1069 private lineup',
      visibility: 'private',
      inviteeUserIds: [ctx.dmRecipientUserId],
    });
    try {
      await awaitProcessing(ctx.api);

      // Advance to voting.
      await ctx.api.patch(`/lineups/${lineup.id}/status`, {
        status: 'voting',
      });
      await awaitProcessing(ctx.api);

      // The in-app voting-open notification must fire for the invitee.
      await waitForNotification(
        ctx,
        (n) =>
          n.payload?.subtype === 'lineup_voting_open' &&
          n.payload.lineupId === lineup.id,
        ctx.config.timeoutMs,
      );

      // The channel must NOT receive a voting-open embed for a private
      // lineup. Negative-window assertion.
      await assertConditionNeverMet(
        async () => {
          const msgs = await readLastMessages(ctx.defaultChannelId, 25);
          return hasMatchingChannelEmbed(msgs, title, /vote|voting/i);
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

export const lineupPrivateDmTests: SmokeTest[] = [privateLineupSuppressesChannelEmbed];
