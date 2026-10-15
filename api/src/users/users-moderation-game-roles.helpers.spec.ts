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
  { roleId: 'role-a', discordUserId: 'd-1' },
  { roleId: 'role-b', discordUserId: 'd-1' },
];

function fakeDb(rows: typeof GRANTS) {
  const where = jest.fn().mockResolvedValue(rows);
  const innerJoin = jest.fn(() => ({ where }));
  const from = jest.fn(() => ({ innerJoin }));
  return { select: jest.fn(() => ({ from })) } as never;
}

function fakeGuild(removeRole: jest.Mock): Guild {
  return { id: 'g', members: { removeRole } } as unknown as Guild;
}

const logger = { warn: jest.fn() } as unknown as Logger;

beforeEach(() => jest.clearAllMocks());

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
});
