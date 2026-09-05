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
    expect(preflightLfgBoard(guildDenying())).toEqual({ ok: true, missing: [] });
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

  it('reports every board permission when the bot is not in a guild', () => {
    const result = preflightLfgBoard(null);

    expect(result.ok).toBe(false);
    expect(result.missing).toEqual([...LFG_BOARD_REQUIRED_LABELS]);
  });
});
