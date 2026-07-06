/**
 * Unit tests for the moderation cascade orchestration (ROK-313 §9.5).
 * The DB writes, audit insert, cache invalidation, token revoke, signup cancel
 * and data wipe are all mocked so these tests assert ORDER and GATING only:
 *   - lockout ordering (DB write precedes invalidateAuthUser, §9.1),
 *   - audit gated on the write RETURNING a row (no double-log on retry, §9.10 #4),
 *   - Discord kick fires only for a real linked ID + when requested,
 *   - ban wipe-vs-reassign branch.
 * It deliberately does NOT import UsersService, so it is independent of the
 * DiscordBotClientService.kickMember integration point owned by the discord agent.
 */
import { Logger } from '@nestjs/common';
import {
  runBan,
  runKick,
  runUnban,
  runUnkick,
  type ModerationDeps,
} from './users-moderation-orchestration.helpers';
import * as writes from './users-moderation.helpers';
import * as audit from './users-admin-actions.helpers';
import * as wipe from './users-delete.helpers';
import * as authCache from '../auth/auth-user-cache';
import * as signupCancel from '../events/signup-cancel-batch.helpers';

jest.mock('./users-moderation.helpers');
jest.mock('./users-admin-actions.helpers');
jest.mock('./users-delete.helpers');
jest.mock('../auth/auth-user-cache');
jest.mock('../events/signup-cancel-batch.helpers');

const kickUserById = writes.kickUserById as jest.Mock;
const unkickUserById = writes.unkickUserById as jest.Mock;
const banUserById = writes.banUserById as jest.Mock;
const unbanUserById = writes.unbanUserById as jest.Mock;
const insertAdminAction = audit.insertAdminAction as jest.Mock;
const wipeUserData = wipe.wipeUserData as jest.Mock;
const reassignPugSlots = wipe.reassignPugSlots as jest.Mock;
const invalidateAuthUser = authCache.invalidateAuthUser as jest.Mock;
const cancelAll = signupCancel.cancelAllUpcomingSignupsForUser as jest.Mock;

const ACTOR = 9;
const TARGET = { id: 5, username: 'Bob', discordId: '123456789' };

function makeDeps(overrides: Partial<ModerationDeps> = {}): ModerationDeps {
  return {
    db: {
      transaction: jest.fn((cb: (tx: unknown) => unknown) =>
        Promise.resolve(cb({})),
      ),
    } as never,
    logger: {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as Logger,
    refreshTokenService: {
      revokeAllForUser: jest.fn().mockResolvedValue(undefined),
    } as never,
    rosterService: {} as never,
    discord: { kickMember: jest.fn().mockResolvedValue(true) },
    ...overrides,
  };
}

beforeEach(() => jest.clearAllMocks());

describe('runKick', () => {
  it('locks out, audits, and Discord-kicks a real linked user in order', async () => {
    kickUserById.mockResolvedValue({ ...TARGET });
    const deps = makeDeps();

    const res = await runKick(deps, {
      userId: TARGET.id,
      actorId: ACTOR,
      reason: 'spam',
      kickFromDiscord: true,
    });

    expect(res).toEqual({ success: true, message: 'Bob has been kicked.' });
    expect(invalidateAuthUser).toHaveBeenCalledWith(TARGET.id);
    expect(deps.refreshTokenService!.revokeAllForUser).toHaveBeenCalledWith(
      TARGET.id,
    );
    expect(insertAdminAction).toHaveBeenCalledTimes(1);
    expect(insertAdminAction).toHaveBeenCalledWith(
      deps.db,
      expect.objectContaining({
        action: 'kick',
        actorId: ACTOR,
        targetId: TARGET.id,
        reason: 'spam',
        metadata: JSON.stringify({ discordKicked: true }),
      }),
    );
    expect(deps.discord.kickMember).toHaveBeenCalledWith('123456789', 'spam');
    // §9.1 ordering invariant: DB write precedes cache invalidation.
    expect(kickUserById.mock.invocationCallOrder[0]).toBeLessThan(
      invalidateAuthUser.mock.invocationCallOrder[0],
    );
  });

  it('is idempotent — no row means no lockout, no audit, no Discord kick', async () => {
    kickUserById.mockResolvedValue(undefined);
    const deps = makeDeps();

    const res = await runKick(deps, {
      userId: TARGET.id,
      actorId: ACTOR,
      kickFromDiscord: true,
    });

    expect(res.success).toBe(true);
    expect(invalidateAuthUser).not.toHaveBeenCalled();
    expect(deps.refreshTokenService!.revokeAllForUser).not.toHaveBeenCalled();
    expect(insertAdminAction).not.toHaveBeenCalled();
    expect(deps.discord.kickMember).not.toHaveBeenCalled();
  });

  it('does not Discord-kick when not requested', async () => {
    kickUserById.mockResolvedValue({ ...TARGET });
    const deps = makeDeps();
    await runKick(deps, {
      userId: TARGET.id,
      actorId: ACTOR,
      kickFromDiscord: false,
    });
    expect(deps.discord.kickMember).not.toHaveBeenCalled();
    expect(insertAdminAction).toHaveBeenCalledWith(
      deps.db,
      expect.objectContaining({
        metadata: JSON.stringify({ discordKicked: false }),
      }),
    );
  });

  it('skips the Discord kick for a synthetic local:/unlinked: id', async () => {
    kickUserById.mockResolvedValue({ ...TARGET, discordId: 'local:5' });
    const deps = makeDeps();
    await runKick(deps, {
      userId: TARGET.id,
      actorId: ACTOR,
      kickFromDiscord: true,
    });
    expect(deps.discord.kickMember).not.toHaveBeenCalled();
  });

  it('a failed audit write does not abort the cascade or throw', async () => {
    kickUserById.mockResolvedValue({ ...TARGET });
    insertAdminAction.mockRejectedValueOnce(new Error('db down'));
    const deps = makeDeps();
    const res = await runKick(deps, {
      userId: TARGET.id,
      actorId: ACTOR,
      kickFromDiscord: true,
    });
    expect(res.success).toBe(true);
    expect(deps.discord.kickMember).toHaveBeenCalledWith(
      '123456789',
      undefined,
    );
  });
});

describe('runBan', () => {
  it('non-wipe: lockout, audit, cancel signups, reassign pug slots (no wipe)', async () => {
    banUserById.mockResolvedValue({ ...TARGET });
    cancelAll.mockResolvedValue(2);
    const deps = makeDeps();

    const res = await runBan(deps, {
      userId: TARGET.id,
      actorId: ACTOR,
      reason: 'abuse',
      wipeData: false,
      kickFromDiscord: false,
    });

    expect(res).toEqual({ success: true, message: 'Bob has been banned.' });
    expect(invalidateAuthUser).toHaveBeenCalledWith(TARGET.id);
    expect(deps.refreshTokenService!.revokeAllForUser).toHaveBeenCalledWith(
      TARGET.id,
    );
    expect(insertAdminAction).toHaveBeenCalledWith(
      deps.db,
      expect.objectContaining({
        action: 'ban',
        metadata: JSON.stringify({ dataWiped: false, discordKicked: false }),
      }),
    );
    expect(cancelAll).toHaveBeenCalledWith(
      deps.db,
      deps.rosterService,
      TARGET.id,
    );
    expect(reassignPugSlots).toHaveBeenCalledWith(deps.db, TARGET.id, ACTOR);
    expect(wipeUserData).not.toHaveBeenCalled();
    // Lockout precedes the best-effort cascade.
    expect(invalidateAuthUser.mock.invocationCallOrder[0]).toBeLessThan(
      cancelAll.mock.invocationCallOrder[0],
    );
  });

  it('wipe: runs wipeUserData inside a transaction instead of reassign-only', async () => {
    banUserById.mockResolvedValue({ ...TARGET });
    cancelAll.mockResolvedValue(0);
    const deps = makeDeps();

    await runBan(deps, {
      userId: TARGET.id,
      actorId: ACTOR,
      wipeData: true,
      kickFromDiscord: false,
    });

    expect(deps.db.transaction).toHaveBeenCalledTimes(1);
    expect(wipeUserData).toHaveBeenCalledWith(
      expect.anything(),
      TARGET.id,
      ACTOR,
    );
    expect(reassignPugSlots).not.toHaveBeenCalled();
    expect(insertAdminAction).toHaveBeenCalledWith(
      deps.db,
      expect.objectContaining({
        metadata: JSON.stringify({ dataWiped: true, discordKicked: false }),
      }),
    );
  });

  it('wipe failure keeps the ban and audits dataWiped:false (no throw)', async () => {
    banUserById.mockResolvedValue({ ...TARGET });
    cancelAll.mockResolvedValue(0);
    wipeUserData.mockRejectedValueOnce(new Error('boom'));
    const deps = makeDeps();

    const res = await runBan(deps, {
      userId: TARGET.id,
      actorId: ACTOR,
      wipeData: true,
      kickFromDiscord: false,
    });

    expect(res.success).toBe(true); // ban kept, no 500
    // Audit records the TRUE (failed) wipe result, not the requested flag.
    expect(insertAdminAction).toHaveBeenCalledWith(
      deps.db,
      expect.objectContaining({
        metadata: JSON.stringify({ dataWiped: false, discordKicked: false }),
      }),
    );
  });

  it('is idempotent — already banned (no row) skips audit and cascade', async () => {
    banUserById.mockResolvedValue(undefined);
    const deps = makeDeps();

    const res = await runBan(deps, {
      userId: TARGET.id,
      actorId: ACTOR,
      wipeData: true,
      kickFromDiscord: true,
    });

    expect(res.success).toBe(true);
    expect(invalidateAuthUser).not.toHaveBeenCalled();
    expect(insertAdminAction).not.toHaveBeenCalled();
    expect(cancelAll).not.toHaveBeenCalled();
    expect(wipeUserData).not.toHaveBeenCalled();
    expect(deps.discord.kickMember).not.toHaveBeenCalled();
  });
});

describe('runUnkick / runUnban', () => {
  it('unkick clears + invalidates + audits when a kick existed', async () => {
    unkickUserById.mockResolvedValue({ ...TARGET });
    const deps = makeDeps();
    const res = await runUnkick(deps, TARGET.id, ACTOR);
    expect(res.success).toBe(true);
    expect(invalidateAuthUser).toHaveBeenCalledWith(TARGET.id);
    expect(insertAdminAction).toHaveBeenCalledWith(
      deps.db,
      expect.objectContaining({ action: 'unkick', targetId: TARGET.id }),
    );
  });

  it('unkick on a non-kicked user does not audit', async () => {
    unkickUserById.mockResolvedValue(undefined);
    const deps = makeDeps();
    await runUnkick(deps, TARGET.id, ACTOR);
    expect(insertAdminAction).not.toHaveBeenCalled();
    expect(invalidateAuthUser).not.toHaveBeenCalled();
  });

  it('unban clears + invalidates + audits when a ban existed', async () => {
    unbanUserById.mockResolvedValue({ ...TARGET });
    const deps = makeDeps();
    const res = await runUnban(deps, TARGET.id, ACTOR);
    expect(res.success).toBe(true);
    expect(invalidateAuthUser).toHaveBeenCalledWith(TARGET.id);
    expect(insertAdminAction).toHaveBeenCalledWith(
      deps.db,
      expect.objectContaining({ action: 'unban', targetId: TARGET.id }),
    );
  });

  it('unban on a non-banned user does not audit', async () => {
    unbanUserById.mockResolvedValue(undefined);
    const deps = makeDeps();
    await runUnban(deps, TARGET.id, ACTOR);
    expect(insertAdminAction).not.toHaveBeenCalled();
  });
});
