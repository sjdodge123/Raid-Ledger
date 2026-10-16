/**
 * ROK-1767 — a ban+wipe deletes the bot's grant rows, after which the
 * reconcile treats the roles as hand-assigned and never removes them. So the
 * wipe first takes back every role the bot granted, best-effort.
 */
import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import type { Guild } from 'discord.js';
import { revokeGameRoleGrants } from './users-moderation-game-roles.helpers';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));
const captured = Sentry.captureException as jest.Mock;

const GRANTS = [
  { gameRoleId: 11, roleId: 'role-a', discordUserId: 'd-1' },
  { gameRoleId: 12, roleId: 'role-b', discordUserId: 'd-1' },
];

const auditValues = jest.fn();

function fakeDb(rows: typeof GRANTS) {
  const where = jest.fn().mockResolvedValue(rows);
  const innerJoin = jest.fn(() => ({ where }));
  const from = jest.fn(() => ({ innerJoin }));
  return {
    select: jest.fn(() => ({ from })),
    insert: jest.fn(() => ({ values: auditValues })),
  } as never;
}

/** The activity_log rows written, as { entityId, action, reason }. */
function audits(): { entityId: unknown; action: unknown; reason: unknown }[] {
  return auditValues.mock.calls.map(([v]: [Record<string, unknown>]) => ({
    entityId: v.entityId,
    action: v.action,
    reason: (v.metadata as { reason?: unknown } | undefined)?.reason,
  }));
}

function fakeGuild(removeRole: jest.Mock): Guild {
  return { id: 'g', members: { removeRole } } as unknown as Guild;
}

const logger = { warn: jest.fn() } as unknown as Logger;

beforeEach(() => {
  jest.clearAllMocks();
  auditValues.mockResolvedValue(undefined);
});

describe('revokeGameRoleGrants', () => {
  it('removes every role the bot granted the user', async () => {
    const removeRole = jest.fn().mockResolvedValue(undefined);
    await revokeGameRoleGrants(
      fakeDb(GRANTS),
      fakeGuild(removeRole),
      5,
      logger,
    );
    expect(removeRole.mock.calls.map((c) => c[0])).toEqual([
      expect.objectContaining({ user: 'd-1', role: 'role-a' }),
      expect.objectContaining({ user: 'd-1', role: 'role-b' }),
    ]);
  });

  it('a failed removal is logged + reported, the rest still run, nothing throws', async () => {
    const removeRole = jest
      .fn()
      .mockRejectedValueOnce(new Error('Missing Permissions'))
      .mockResolvedValueOnce(undefined);
    await expect(
      revokeGameRoleGrants(fakeDb(GRANTS), fakeGuild(removeRole), 5, logger),
    ).resolves.toBeUndefined();
    expect(removeRole).toHaveBeenCalledTimes(2);
    expect(captured).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('bot offline with grants outstanding reports it instead of throwing', async () => {
    await expect(
      revokeGameRoleGrants(fakeDb(GRANTS), null, 5, logger),
    ).resolves.toBeUndefined();
    expect(captured).toHaveBeenCalledTimes(1);
  });

  it('no grants: no Discord call, nothing reported', async () => {
    const removeRole = jest.fn();
    await revokeGameRoleGrants(fakeDb([]), fakeGuild(removeRole), 5, logger);
    expect(removeRole).not.toHaveBeenCalled();
    expect(captured).not.toHaveBeenCalled();
  });

  it('writes a role_removed audit row for each successful removal (wipe)', async () => {
    const removeRole = jest.fn().mockResolvedValue(undefined);
    await revokeGameRoleGrants(
      fakeDb(GRANTS),
      fakeGuild(removeRole),
      5,
      logger,
    );
    expect(audits()).toEqual([
      {
        entityId: 11,
        action: 'role_removed',
        reason: 'user banned (data wiped)',
      },
      {
        entityId: 12,
        action: 'role_removed',
        reason: 'user banned (data wiped)',
      },
    ]);
  });

  it('account deletion audits with its own reason', async () => {
    const removeRole = jest.fn().mockResolvedValue(undefined);
    await revokeGameRoleGrants(
      fakeDb(GRANTS.slice(0, 1)),
      fakeGuild(removeRole),
      5,
      logger,
      'deleted',
    );
    expect(audits()).toEqual([
      { entityId: 11, action: 'role_removed', reason: 'account deleted' },
    ]);
  });

  it('a failed removal writes no audit row; a failed audit is reported, not thrown', async () => {
    const removeRole = jest
      .fn()
      .mockRejectedValueOnce(new Error('Missing Permissions'))
      .mockResolvedValueOnce(undefined);
    auditValues.mockRejectedValueOnce(new Error('db down'));
    await expect(
      revokeGameRoleGrants(fakeDb(GRANTS), fakeGuild(removeRole), 5, logger),
    ).resolves.toBeUndefined();
    expect(audits().map((a) => a.entityId)).toEqual([12]);
    expect(captured).toHaveBeenCalledTimes(2);
  });
});
