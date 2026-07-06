import { PermissionsBitField } from 'discord.js';
import { REQUIRED_PERMISSIONS } from './discord-bot-client.helpers';

describe('REQUIRED_PERMISSIONS (ROK-313 AC13)', () => {
  it('includes the Kick Members permission', () => {
    expect(
      REQUIRED_PERMISSIONS.some(
        (p) => p.flag === PermissionsBitField.Flags.KickMembers,
      ),
    ).toBe(true);
  });
});
