/**
 * ROK-1767 — a hard account delete cascades the bot's grant rows away, after
 * which the reconcile reads the roles as hand-assigned and never removes them.
 * So `user.deleting` (awaited before the cascade) takes them back first.
 */
import type { Guild } from 'discord.js';
import { revokeGameRoleGrants } from '../../users/users-moderation-game-roles.helpers';
import { GameRoleAccountDeleteListener } from './game-role-account-delete.listener';

jest.mock('../../users/users-moderation-game-roles.helpers', () => ({
  revokeGameRoleGrants: jest.fn().mockResolvedValue(undefined),
}));
const revoke = revokeGameRoleGrants as jest.Mock;

const db = { tag: 'db' } as never;
const guild = { id: 'g' } as unknown as Guild;

function listener(g: Guild | null): GameRoleAccountDeleteListener {
  const bot = { getGuild: () => g } as never;
  return new GameRoleAccountDeleteListener(db, bot);
}

beforeEach(() => jest.clearAllMocks());

describe('GameRoleAccountDeleteListener', () => {
  it('revokes the deleted user’s bot-granted roles with the delete cause', async () => {
    await listener(guild).onUserDeleting({ userId: 42 });
    expect(revoke).toHaveBeenCalledWith(
      db,
      guild,
      42,
      expect.anything(),
      'deleted',
    );
  });

  it('bot offline: still runs (the helper reports the skipped roles)', async () => {
    await listener(null).onUserDeleting({ userId: 42 });
    expect(revoke).toHaveBeenCalledWith(
      db,
      null,
      42,
      expect.anything(),
      'deleted',
    );
  });
});
