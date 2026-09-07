/**
 * LFG player-invite smoke (ROK-1455 AC10 / S1, S2).
 *
 * S1 — an invite from a group member lands as an `lfg_player_invite`
 *      notification for the recipient, naming the inviter and the reason.
 * S2 — the decline (pressed through the DEMO endpoint, D15) keeps the
 *      suggestion's `inviteState` at `sent`, refuses a re-invite with the one
 *      opaque body, and is idempotent.
 *
 * WHY THE DM ITSELF IS NOT READ: Discord refuses bot-to-bot DMs (50007), and
 * the only Discord account the smoke can read is the companion bot's. Every DM
 * smoke in this directory therefore asserts the in-app notification row —
 * the canonical mirror the dispatcher writes first — and this one does the
 * same. The decline button's custom id (`lfg:invite-decline:{gameId}`, above
 * the eventId guard) is pinned by the api unit test
 * `notification-embed.lfg-player-invite.spec.ts` (T-B3).
 *
 * The recipient is the DM-recipient demo user (its `discord_id` is the test
 * bot's real snowflake, which the invite pre-check requires). Its invite rows
 * are wiped before AND after each test so the no-repeat horizon and the
 * per-recipient budget cannot fail a re-run against a persistent database.
 */
import { pollForCondition } from '../../helpers/polling.js';
import {
  addGameInterest,
  postLfgIntent,
  seedFixtureUser,
  withdrawLfgIntent,
  type FixtureUser,
} from '../fixtures.js';
import type { ApiClient } from '../api.js';
import type { SmokeTest, TestContext } from '../types.js';

/** `LFG_INVITE_NOTIFICATION_TYPE` — mirrored; the bot has no api dependency. */
const INVITE_TYPE = 'lfg_player_invite';
/** `LFG_INVITE_SKIP_REASON` — the one opaque recipient-scoped refusal (D13). */
const SKIP_REASON = 'unavailable';
/** Enough for the notification INSERT inside the invite transaction. */
const NOTIFICATION_MS = 15_000;
/** The two LFG lifecycle suites scan the last 16 registry games; start past. */
const GAME_SCAN_OFFSET = 16;
const GAME_SCAN_LIMIT = 8;

interface InviteResponse {
  status: 'sent' | 'skipped';
  reason: string | null;
}
interface Suggestion {
  userId: number;
  reasons: string[];
  inviteState: 'none' | 'sent';
}
interface SuggestionsResponse {
  suggestions: Suggestion[];
}
interface NotificationRow {
  type: string;
  title?: string;
  payload?: Record<string, unknown>;
}

async function readActiveCount(ctx: TestContext, gameId: number) {
  try {
    const g = await ctx.api.get<{ activeCount?: number }>(`/lfg/${gameId}`);
    return g.activeCount ?? 0;
  } catch {
    return 0;
  }
}

/** A registry game with NO live group, outside the sibling suites' windows. */
async function pickIdleGame(ctx: TestContext): Promise<{ id: number; name: string }> {
  const res = await ctx.api.get<{ data: { id: number; name: string }[] }>(
    '/admin/settings/games?limit=100',
  );
  const candidates = (res.data ?? [])
    .slice()
    .reverse()
    .slice(GAME_SCAN_OFFSET, GAME_SCAN_OFFSET + GAME_SCAN_LIMIT);
  for (const game of candidates) {
    if ((await readActiveCount(ctx, game.id)) === 0) return game;
  }
  throw new Error(
    `LFG invite: no idle game among ${candidates.length} candidates ` +
      `(offset ${GAME_SCAN_OFFSET}) — every one already has a live group`,
  );
}

function resetInvites(api: ApiClient, userId: number) {
  return api.post<{ deleted: number }>('/admin/test/lfg-invites/reset', {
    userId,
  });
}

function invite(api: ApiClient, gameId: number, userId: number) {
  return api.post<InviteResponse>(`/lfg/${gameId}/invites`, { userId });
}

function declineViaDemo(api: ApiClient, userId: number, gameId: number) {
  return api.post<{ declined: boolean }>('/admin/test/lfg-invite-decline', {
    userId,
    gameId,
  });
}

function expectBody(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
}

interface Arranged {
  inviter: FixtureUser;
  game: { id: number; name: string };
  recipientId: number;
}

/** Idle game, recipient hearts it (so it is a suggestion), inviter raises a hand. */
async function arrange(ctx: TestContext): Promise<Arranged> {
  const recipientId = ctx.dmRecipientUserId;
  await resetInvites(ctx.api, recipientId);
  const inviter = await seedFixtureUser(ctx.api);
  const game = await pickIdleGame(ctx);
  await addGameInterest(ctx.api, recipientId, game.id);
  await postLfgIntent(inviter.api, game.id);
  return { inviter, game, recipientId };
}

async function cleanup(ctx: TestContext, a: Arranged): Promise<void> {
  await withdrawLfgIntent(a.inviter.api, a.game.id);
  await resetInvites(ctx.api, a.recipientId).catch(() => {});
}

const inviteDelivers: SmokeTest = {
  name: 'LFG player invite lands as an lfg_player_invite notification naming inviter + reason (S1)',
  category: 'dm',
  async run(ctx) {
    const a = await arrange(ctx);
    try {
      const sent = await invite(a.inviter.api, a.game.id, a.recipientId);
      expectBody('invite', sent, { status: 'sent', reason: null });

      const row = await pollForCondition(async () => {
        const list = await ctx.api.get<NotificationRow[]>(
          `/admin/test/notifications?userId=${a.recipientId}&type=${INVITE_TYPE}&limit=20`,
        );
        return list.find((n) => n.payload?.gameId === a.game.id) ?? null;
      }, NOTIFICATION_MS);

      const p = row.payload ?? {};
      if (p.inviterUserId !== a.inviter.userId) {
        throw new Error(
          `payload.inviterUserId: expected ${a.inviter.userId}, got ${String(p.inviterUserId)}`,
        );
      }
      if (p.gameName !== a.game.name) {
        throw new Error(
          `payload.gameName: expected "${a.game.name}", got ${JSON.stringify(p.gameName)}`,
        );
      }
      const reasons = Array.isArray(p.reasons) ? (p.reasons as string[]) : [];
      if (!reasons.includes('hearted')) {
        throw new Error(
          `payload.reasons: expected to include "hearted" (the recipient hearted the game), got ${JSON.stringify(reasons)}`,
        );
      }
      if (typeof p.inviterName !== 'string' || p.inviterName.length === 0) {
        throw new Error(`payload.inviterName missing: ${JSON.stringify(p)}`);
      }
    } finally {
      await cleanup(ctx, a);
    }
  },
};

const declineHolds: SmokeTest = {
  name: 'Declining an LFG invite keeps inviteState=sent, refuses a re-invite, and is idempotent (S2)',
  category: 'dm',
  async run(ctx) {
    const a = await arrange(ctx);
    try {
      const sent = await invite(a.inviter.api, a.game.id, a.recipientId);
      expectBody('invite', sent, { status: 'sent', reason: null });

      const declined = await declineViaDemo(ctx.api, a.recipientId, a.game.id);
      expectBody('decline', declined, { declined: true });

      await pollForCondition(async () => {
        const res = await a.inviter.api.get<SuggestionsResponse>(
          `/lfg/${a.game.id}/suggestions`,
        );
        const me = res.suggestions.find((s) => s.userId === a.recipientId);
        return me?.inviteState === 'sent' ? me : null;
      }, NOTIFICATION_MS);

      const again = await invite(a.inviter.api, a.game.id, a.recipientId);
      expectBody('re-invite after decline', again, {
        status: 'skipped',
        reason: SKIP_REASON,
      });

      const repeat = await declineViaDemo(ctx.api, a.recipientId, a.game.id);
      expectBody('second decline', repeat, { declined: false });
    } finally {
      await cleanup(ctx, a);
    }
  },
};

export const lfgInviteTests: SmokeTest[] = [inviteDelivers, declineHolds];
