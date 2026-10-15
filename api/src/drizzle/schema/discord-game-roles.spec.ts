/**
 * ROK-1767 — reconciliation runs per game, so two games sharing one Discord
 * role would each remove members the other still wants. The controller's
 * pre-check refuses the second link; this unique key closes the race between
 * two concurrent link requests.
 */
import { getTableConfig } from 'drizzle-orm/pg-core';
import { discordGameRoles } from './discord-game-roles';

describe('discord_game_roles schema', () => {
  it('makes role_id unique so one Discord role links to at most one game', () => {
    const { columns } = getTableConfig(discordGameRoles);
    const roleId = columns.find((c) => c.name === 'role_id');
    expect({ isUnique: roleId?.isUnique, name: roleId?.uniqueName }).toEqual({
      isUnique: true,
      name: 'discord_game_roles_role_id_unique',
    });
  });
});
