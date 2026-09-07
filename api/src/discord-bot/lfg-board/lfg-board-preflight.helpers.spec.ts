import { PermissionsBitField, type Guild } from 'discord.js';
import {
  LFG_BOARD_REQUIRED_LABELS,
  preflightLfgBoard,
} from './lfg-board-preflight.helpers';

/** A guild whose bot member has every permission except those denied. */
const guildDenying = (...denied: bigint[]): Guild =>
  ({
    members: {
      me: { permissions: { has: (f: bigint): boolean => !denied.includes(f) } },
    },
  }) as unknown as Guild;

describe('preflightLfgBoard (ROK-1471 D5 / AC12)', () => {
  it('passes when every board permission is granted', () => {
    expect(preflightLfgBoard(guildDenying())).toEqual({
      ok: true,
      missing: [],
    });
  });

  it('names the missing thread permission and nothing else', () => {
    const guild = guildDenying(PermissionsBitField.Flags.SendMessagesInThreads);

    expect(preflightLfgBoard(guild)).toEqual({
      ok: false,
      missing: ['Send Messages in Threads'],
    });
  });

  it('ignores permissions the board does not need', () => {
    const guild = guildDenying(PermissionsBitField.Flags.KickMembers);

    expect(preflightLfgBoard(guild)).toEqual({ ok: true, missing: [] });
  });

  it('reports Manage Roles when the write-overwrite grant is missing', () => {
    // ROK-1493 D9/AC5: the board writes a channel overwrite on the forum, and
    // that needs Manage Roles. A guild missing it must see the label in the
    // toggle's advisory warning, not discover it as a log line nobody reads.
    const guild = guildDenying(PermissionsBitField.Flags.ManageRoles);

    expect(preflightLfgBoard(guild)).toEqual({
      ok: false,
      missing: ['Manage Roles'],
    });
  });

  it('reports every board permission when the bot is not in a guild', () => {
    const result = preflightLfgBoard(null);

    expect(result.ok).toBe(false);
    expect(result.missing).toEqual([...LFG_BOARD_REQUIRED_LABELS]);
  });
});
