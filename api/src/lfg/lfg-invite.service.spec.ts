/**
 * ROK-1455 — `LfgInviteService` orchestration: the ORDER of the checks, the
 * refusal SHAPE (D13), and the payload the DM renders from (AC7).
 *
 * The limits themselves are SQL counts and live in
 * `lfg-invite-limits.integration.spec.ts` against a real database; this file
 * mocks the helpers so it can pin what a database cannot — that the locks
 * are taken recipient-then-game, that every recipient-scoped refusal is the
 * SAME opaque body, and that nothing is written once a refusal is found.
 */
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
} from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { LfgInviteResponseSchema } from '@raid-ledger/contract';
import type * as schema from '../drizzle/schema';
import type { NotificationService } from '../notifications/notification.service';
import type { SettingsService } from '../settings/settings.service';
import {
  LfgInviteService,
  LFG_INVITE_SENT,
  LFG_INVITE_SKIPPED,
} from './lfg-invite.service';
import * as helpers from './lfg-invite.helpers';
import * as query from './lfg-query.helpers';
import * as suggestions from './lfg-suggestions.helpers';
import { lfgGroupLockKey } from './lfg.constants';
import {
  LFG_INVITE_GROUP_CAP,
  LFG_INVITE_GROUP_CAP_CODE,
  LFG_INVITE_GROUP_CAP_MESSAGE,
  LFG_INVITE_NOTIFICATION_TYPE,
  LFG_INVITE_RECIPIENT_LIMIT,
  LFG_INVITE_SKIP_REASON,
  lfgInviteGameLockKey,
  lfgInviteRecipientLockKey,
} from './lfg-invite.constants';

jest.mock('./lfg-invite.helpers');
jest.mock('./lfg-query.helpers');
jest.mock('./lfg-suggestions.helpers');

const INVITER = 3;
const RECIPIENT = 8;
const GAME = { id: 7, name: 'Deep Rock Galactic', slug: 'deep-rock' };

const mocked = helpers as jest.Mocked<typeof helpers>;
const mockedQuery = query as jest.Mocked<typeof query>;
const mockedSuggestions = suggestions as jest.Mocked<typeof suggestions>;

interface FakeDb {
  execute: jest.Mock;
  select: jest.Mock;
  transaction: jest.Mock;
}

function buildDb(): FakeDb {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () =>
      Promise.resolve([{ username: 'host', displayName: 'Host Display' }]),
  };
  const fake: FakeDb = {
    execute: jest.fn().mockResolvedValue([]),
    select: jest.fn(() => chain),
    transaction: jest.fn(),
  };
  fake.transaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) =>
    fn(fake),
  );
  return fake;
}
let db: FakeDb;
let create: jest.Mock;
let service: LfgInviteService;

/** Every recipient-scoped check passes; the inviter is in the group. */
function allClear() {
  mockedQuery.requireGame.mockResolvedValue(
    GAME as unknown as typeof schema.games.$inferSelect,
  );
  mocked.holdsLiveIntent.mockImplementation((_db, userId) =>
    Promise.resolve(userId === INVITER),
  );
  mocked.countGroupInvitesSince.mockResolvedValue(0);
  mocked.recipientIsEligible.mockResolvedValue(true);
  mocked.recipientHasLinkedDiscord.mockResolvedValue(true);
  mocked.recipientOptedOut.mockResolvedValue(false);
  mocked.findLiveInviteFor.mockResolvedValue(null);
  mocked.countRecipientInvitesSince.mockResolvedValue(0);
  mocked.steamPlaytimeMinutes.mockResolvedValue(null);
  mocked.insertInvite.mockResolvedValue({
    id: 1,
  } as unknown as helpers.LfgInviteRow);
  mockedSuggestions.reasonsForUser.mockResolvedValue(['owns']);
}

beforeEach(() => {
  jest.resetAllMocks();
  db = buildDb();
  create = jest.fn().mockResolvedValue({ id: 'n1' });
  service = new LfgInviteService(
    db as unknown as PostgresJsDatabase<typeof schema>,
    {
      get: jest.fn().mockResolvedValue('https://rl.test/'),
    } as unknown as SettingsService,
    { create } as unknown as NotificationService,
  );
  allClear();
});

describe('LfgInviteService.invite — inviter guards', () => {
  it('rejects a self-invite with 400 before touching the database', async () => {
    await expect(service.invite(INVITER, GAME.id, INVITER)).rejects.toThrow(
      BadRequestException,
    );
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('rejects a caller outside the group with 403', async () => {
    mocked.holdsLiveIntent.mockResolvedValue(false);
    await expect(service.invite(INVITER, GAME.id, RECIPIENT)).rejects.toThrow(
      ForbiddenException,
    );
    expect(db.transaction).not.toHaveBeenCalled();
  });
});

describe('LfgInviteService.invite — the transaction (D4/D5)', () => {
  it('takes the recipient lock FIRST, then the game lock, inside the transaction', async () => {
    await service.invite(INVITER, GAME.id, RECIPIENT);
    const calls = (db.execute.mock.calls as unknown[][]).map((c) =>
      JSON.stringify(c[0]),
    );
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain(lfgInviteRecipientLockKey(RECIPIENT));
    expect(calls[1]).toContain(lfgInviteGameLockKey(GAME.id));
    // Disjoint from the +1 path's key so the two lock families cannot collide.
    expect(lfgInviteGameLockKey(GAME.id)).not.toBe(lfgGroupLockKey(GAME.id));
  });

  it('inserts the row and creates the notification INSIDE the transaction, row first', async () => {
    const order: string[] = [];
    mocked.insertInvite.mockImplementation(() => {
      order.push('insert');
      return Promise.resolve({ id: 1 } as unknown as helpers.LfgInviteRow);
    });
    create.mockImplementation(() => {
      order.push('create');
      return Promise.resolve({ id: 'n1' });
    });
    const res = await service.invite(INVITER, GAME.id, RECIPIENT);
    expect(res).toEqual(LFG_INVITE_SENT);
    expect(order).toEqual(['insert', 'create']);
    expect(mocked.insertInvite).toHaveBeenCalledWith(db, {
      recipientUserId: RECIPIENT,
      inviterUserId: INVITER,
      gameId: GAME.id,
    });
  });

  // The fake db's `transaction` is `fn(fake)` — there is no real transaction
  // here, so this file can only prove PROPAGATION. That the throw actually
  // rolls the `lfg_invites` row back (A4) is a database fact and belongs to
  // `lfg-invite-limits.integration.spec.ts` (M2).
  it('propagates a create() failure out of the transaction callback', async () => {
    create.mockRejectedValue(new Error('dispatch exploded'));
    await expect(service.invite(INVITER, GAME.id, RECIPIENT)).rejects.toThrow(
      'dispatch exploded',
    );
  });
});

describe('LfgInviteService.invite — refusal shape (D13)', () => {
  it('spends the group cap as a 429 carrying the constant message', async () => {
    mocked.countGroupInvitesSince.mockResolvedValue(LFG_INVITE_GROUP_CAP);
    const err = await service
      .invite(INVITER, GAME.id, RECIPIENT)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(429);
    expect((err as HttpException).message).toBe(LFG_INVITE_GROUP_CAP_MESSAGE);
    // F1: the client cannot tell this from the GLOBAL throttler's 429 without
    // a discriminator, and paints the cap notice + locks the panel on both.
    expect((err as HttpException).getResponse()).toEqual({
      statusCode: 429,
      message: LFG_INVITE_GROUP_CAP_MESSAGE,
      code: LFG_INVITE_GROUP_CAP_CODE,
    });
    expect(mocked.insertInvite).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('sends when the group is ONE under the cap', async () => {
    mocked.countGroupInvitesSince.mockResolvedValue(LFG_INVITE_GROUP_CAP - 1);
    await expect(service.invite(INVITER, GAME.id, RECIPIENT)).resolves.toEqual(
      LFG_INVITE_SENT,
    );
  });
});

describe('LfgInviteService.invite — recipient-scoped refusals are opaque (D13)', () => {
  const refusals: [string, () => void][] = [
    ['ineligible', () => mocked.recipientIsEligible.mockResolvedValue(false)],
    [
      'unlinked',
      () => mocked.recipientHasLinkedDiscord.mockResolvedValue(false),
    ],
    ['opted out', () => mocked.recipientOptedOut.mockResolvedValue(true)],
    [
      'already in the group',
      () => mocked.holdsLiveIntent.mockResolvedValue(true),
    ],
    [
      'repeat inside the horizon',
      () =>
        mocked.findLiveInviteFor.mockResolvedValue({
          id: 9,
        } as unknown as helpers.LfgInviteRow),
    ],
    [
      'recipient budget spent',
      () =>
        mocked.countRecipientInvitesSince.mockResolvedValue(
          LFG_INVITE_RECIPIENT_LIMIT,
        ),
    ],
  ];

  it.each(refusals)(
    '%s ⇒ the ONE opaque skipped body, and nothing is written',
    async (_label, arrange) => {
      arrange();
      const res = await service.invite(INVITER, GAME.id, RECIPIENT);
      expect(res).toEqual({
        status: 'skipped',
        reason: LFG_INVITE_SKIP_REASON,
      });
      expect(res).toEqual(LFG_INVITE_SKIPPED);
      expect(mocked.insertInvite).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    },
  );

  it('sends when the recipient is ONE under their budget', async () => {
    mocked.countRecipientInvitesSince.mockResolvedValue(
      LFG_INVITE_RECIPIENT_LIMIT - 1,
    );
    await expect(service.invite(INVITER, GAME.id, RECIPIENT)).resolves.toEqual(
      LFG_INVITE_SENT,
    );
  });

  it('both bodies satisfy the contract schema', () => {
    expect(LfgInviteResponseSchema.safeParse(LFG_INVITE_SENT).success).toBe(
      true,
    );
    expect(LfgInviteResponseSchema.safeParse(LFG_INVITE_SKIPPED).success).toBe(
      true,
    );
  });
});

describe('LfgInviteService.invite — the DM payload (AC7)', () => {
  it('names the inviter, the reasons, the masked group link and the Steam playtime', async () => {
    mocked.steamPlaytimeMinutes.mockResolvedValue(8520);
    await service.invite(INVITER, GAME.id, RECIPIENT);
    expect(mocked.steamPlaytimeMinutes).toHaveBeenCalledWith(
      db,
      RECIPIENT,
      GAME.id,
    );
    expect(create).toHaveBeenCalledWith({
      userId: RECIPIENT,
      type: LFG_INVITE_NOTIFICATION_TYPE,
      title: 'Host Display invited you to play Deep Rock Galactic',
      message: 'Join the group: https://rl.test/lfg/deep-rock',
      payload: {
        gameId: GAME.id,
        gameSlug: 'deep-rock',
        gameName: 'Deep Rock Galactic',
        inviterUserId: INVITER,
        inviterName: 'Host Display',
        reasons: ['owns'],
        url: 'https://rl.test/lfg/deep-rock',
        playtimeMinutes: 8520,
      },
    });
  });

  it('leaves playtimeMinutes OFF the payload when there is no steam_library row (AC6: never "0 hrs")', async () => {
    await service.invite(INVITER, GAME.id, RECIPIENT);
    const input = create.mock.calls[0][0] as {
      payload: Record<string, unknown>;
    };
    expect(input.payload).not.toHaveProperty('playtimeMinutes');
  });

  it('carries empty reasons when the recipient has no surviving signal', async () => {
    mockedSuggestions.reasonsForUser.mockResolvedValue([]);
    await service.invite(INVITER, GAME.id, RECIPIENT);
    const input = create.mock.calls[0][0] as { payload: { reasons: string[] } };
    expect(input.payload.reasons).toEqual([]);
  });

  // ROK-1455 smoke S1 failed as:
  //   payload.reasons: expected to include "hearted" (the recipient hearted
  //   the game), got []
  // The recipient HAD hearted the game; they were simply outside the ranked,
  // capped `listSuggestions` result the payload used to look them up in.
  // Reverting to that lookup makes this case report `[] !== ['hearted']`.
  it('reads the RECIPIENT\'s reasons, not the capped suggestion list they fell out of', async () => {
    mockedSuggestions.reasonsForUser.mockResolvedValue(['hearted']);
    // A full, ranked page of OTHER users — the recipient is not on it.
    mockedSuggestions.listSuggestions.mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => ({
        userId: 100 + i,
        username: `other${i}`,
        displayName: null,
        avatarUrl: null,
        reasons: ['played' as const],
        lastPlayedAt: null,
        inviteState: 'none' as const,
      })),
    );

    await service.invite(INVITER, GAME.id, RECIPIENT);

    const input = create.mock.calls[0][0] as { payload: { reasons: string[] } };
    expect(input.payload.reasons).toEqual(['hearted']);
    expect(mockedSuggestions.reasonsForUser).toHaveBeenCalledWith(
      db,
      GAME.id,
      RECIPIENT,
    );
  });
});

describe('LfgInviteService.decline (D12)', () => {
  it('reports whether a live row was stamped', async () => {
    mocked.declineLiveInvite.mockResolvedValueOnce({
      id: 1,
    } as unknown as helpers.LfgInviteRow);
    await expect(service.decline(RECIPIENT, GAME.id)).resolves.toBe(true);
    mocked.declineLiveInvite.mockResolvedValueOnce(null);
    await expect(service.decline(RECIPIENT, GAME.id)).resolves.toBe(false);
  });
});

/**
 * M1 — the preference read itself, un-mocked. `recipientOptedOut` decides
 * whether a row is EVER written, so a channel it fails to notice spends the
 * group cap, the recipient's 24h budget and the 14-day horizon on a DM that
 * `NotificationService.create` silently drops.
 */
describe('recipientOptedOut — every preference that silences the invite (M1)', () => {
  const actual = jest.requireActual<typeof helpers>('./lfg-invite.helpers');

  /** A db whose only answer is one `user_notification_preferences` row. */
  function prefsDb(prefs: unknown) {
    const chain = {
      from: () => chain,
      where: () => chain,
      limit: () => Promise.resolve(prefs === undefined ? [] : [{ prefs }]),
    };
    return { select: () => chain } as unknown as Parameters<
      typeof actual.recipientOptedOut
    >[0];
  }

  async function optedOut(prefs: unknown): Promise<boolean> {
    return actual.recipientOptedOut(prefsDb(prefs), RECIPIENT);
  }

  it('inApp:false is an opt-out — create() returns null BEFORE dispatchDiscord', async () => {
    const prefs = {
      [LFG_INVITE_NOTIFICATION_TYPE]: { inApp: false, discord: true },
    };
    expect(`inApp:false,discord:true ⇒ optedOut=${await optedOut(prefs)}`).toBe(
      'inApp:false,discord:true ⇒ optedOut=true',
    );
  });

  it('discord:false is still an opt-out', async () => {
    const prefs = {
      [LFG_INVITE_NOTIFICATION_TYPE]: { inApp: true, discord: false },
    };
    await expect(optedOut(prefs)).resolves.toBe(true);
  });

  it('both channels on, a missing key and a missing row all SEND (D2, T-A9)', async () => {
    const on = {
      [LFG_INVITE_NOTIFICATION_TYPE]: { inApp: true, discord: true },
    };
    await expect(optedOut(on)).resolves.toBe(false);
    await expect(optedOut({ lfg_invite: { inApp: false } })).resolves.toBe(
      false,
    );
    await expect(optedOut(undefined)).resolves.toBe(false);
  });
});
