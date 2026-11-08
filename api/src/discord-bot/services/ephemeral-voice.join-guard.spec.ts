/**
 * ROK-2119 — the private-voice join-guard never sends an expected Discord
 * refusal to Sentry: a member the bot cannot move is skipped (one warning per
 * event+member), and a 50013/50001 thrown by the disconnect anyway is a warning.
 */
import { DiscordAPIError, type Guild } from 'discord.js';
import { disconnectMember } from './ephemeral-voice.discord-ops';
import {
  clearJoinGuardWarnings,
  guardDisconnect,
} from './ephemeral-voice.join-guard';

jest.mock('./scheduled-event.helpers', () => ({
  timedDiscordCall: (_label: string, fn: () => unknown) => fn(),
}));

function discordError(code: number): DiscordAPIError {
  const err: DiscordAPIError = Object.create(DiscordAPIError.prototype);
  Object.defineProperty(err, 'code', { value: code });
  Object.defineProperty(err, 'message', { value: `Discord ${code}` });
  return err;
}

interface FakeMember {
  manageable: boolean;
  voice: { channelId: string | null; channel: unknown; disconnect: jest.Mock };
}

function makeGuild(opts: { manageable?: boolean; canMove?: boolean } = {}): {
  guild: Guild;
  member: FakeMember;
} {
  const perms = { has: jest.fn().mockReturnValue(opts.canMove ?? true) };
  const member: FakeMember = {
    manageable: opts.manageable ?? true,
    voice: {
      channelId: 'vc-1',
      channel: { permissionsFor: jest.fn().mockReturnValue(perms) },
      disconnect: jest.fn().mockResolvedValue(undefined),
    },
  };
  const guild = {
    members: {
      cache: new Map([['m1', member]]),
      fetch: jest.fn(),
      me: { permissions: perms },
    },
  } as unknown as Guild;
  return { guild, member };
}

const logger = (): { warn: jest.Mock } => ({ warn: jest.fn() });

beforeEach(() => clearJoinGuardWarnings());

describe('disconnectMember pre-check (ROK-2119)', () => {
  it('skips a member above the bot in the role hierarchy', async () => {
    const { guild, member } = makeGuild({ manageable: false });
    await expect(disconnectMember(guild, 'm1')).resolves.toBe('unmanageable');
    expect(member.voice.disconnect).not.toHaveBeenCalled();
  });

  it('skips when the bot lacks Move Members on the channel', async () => {
    const { guild, member } = makeGuild({ canMove: false });
    await expect(disconnectMember(guild, 'm1')).resolves.toBe('unmanageable');
    expect(member.voice.disconnect).not.toHaveBeenCalled();
  });

  it('disconnects a member the bot can move', async () => {
    const { guild, member } = makeGuild();
    await expect(disconnectMember(guild, 'm1')).resolves.toBe('disconnected');
    expect(member.voice.disconnect).toHaveBeenCalledTimes(1);
  });
});

describe('guardDisconnect (ROK-2119)', () => {
  it('warns once per event+member for an unmanageable member', async () => {
    const { guild } = makeGuild({ manageable: false });
    const log = logger();
    await guardDisconnect(guild, 7, 'm1', log);
    await guardDisconnect(guild, 7, 'm1', log);
    expect(log.warn).toHaveBeenCalledTimes(1);
    await guardDisconnect(guild, 8, 'm1', log);
    expect(log.warn).toHaveBeenCalledTimes(2);
  });

  it.each([50013, 50001])(
    'treats a %s thrown by the disconnect as expected (warn, no throw)',
    async (code) => {
      const { guild, member } = makeGuild();
      member.voice.disconnect.mockRejectedValue(discordError(code));
      const log = logger();
      await expect(guardDisconnect(guild, 7, 'm1', log)).resolves.toBe(
        'unmanageable',
      );
      expect(log.warn).toHaveBeenCalledTimes(1);
    },
  );

  it('rethrows any other error so the caller captures it', async () => {
    const { guild, member } = makeGuild();
    member.voice.disconnect.mockRejectedValue(new Error('boom'));
    await expect(guardDisconnect(guild, 7, 'm1', logger())).rejects.toThrow(
      'boom',
    );
  });
});
