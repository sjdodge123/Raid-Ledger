/**
 * ROK-2208 §5.7 item 4 (R12) — the event-thread lock sweep (unit).
 */
import type { DiscordBotClientService } from '../../../discord-bot/discord-bot-client.service';
import {
  HubForumDiscordEventLockGateway,
  HubForumDiscordEventLockSweep,
  type LockChange,
} from './hub-forum-discord-event-lock';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

const NOW = new Date('2026-11-16T12:00:00Z');

function fakePost() {
  const calls: string[] = [];
  const post = {
    isThread: () => true,
    setLocked: jest.fn((v: boolean) => {
      calls.push(`locked:${v}`);
      return Promise.resolve();
    }),
    setArchived: jest.fn((v: boolean) => {
      calls.push(`archived:${v}`);
      return Promise.resolve();
    }),
  };
  const guild = { channels: { fetch: jest.fn().mockResolvedValue(post) } };
  const client = {
    isConnected: () => true,
    getGuild: () => guild,
  } as unknown as DiscordBotClientService;
  return { client, calls };
}

describe('HubForumDiscordEventLockGateway.setReadOnly', () => {
  it('locks then archives a read-only post', async () => {
    const { client, calls } = fakePost();
    await new HubForumDiscordEventLockGateway(client).setReadOnly('9', true);
    expect(calls).toEqual(['locked:true', 'archived:true']);
  });

  it('unarchives then unlocks a reopened post', async () => {
    const { client, calls } = fakePost();
    await new HubForumDiscordEventLockGateway(client).setReadOnly('9', false);
    expect(calls).toEqual(['archived:false', 'locked:false']);
  });
});

function setup(rounds: LockChange[][], connected = true) {
  const sets: unknown[] = [];
  const db = {
    update: jest.fn(() => ({
      set: (v: unknown) => {
        sets.push(v);
        return { where: jest.fn().mockResolvedValue(undefined) };
      },
    })),
  } as unknown as ForumDiscordDb;
  const gateway = { setReadOnly: jest.fn().mockResolvedValue(undefined) };
  const client = {
    isConnected: () => connected,
  } as unknown as DiscordBotClientService;
  const sweep = new HubForumDiscordEventLockSweep(
    db,
    gateway as unknown as HubForumDiscordEventLockGateway,
    client,
  );
  const due = jest.spyOn(sweep, 'due');
  for (const r of rounds) due.mockResolvedValueOnce(r);
  due.mockResolvedValue([]);
  return { sweep, gateway, sets };
}

const row = (readOnly: boolean): LockChange => ({
  linkId: 1,
  discordThreadId: '9',
  readOnly,
});

describe('HubForumDiscordEventLockSweep.sweep', () => {
  it('locks + archives once and records the lock', async () => {
    const { sweep, gateway, sets } = setup([[row(true)]]);
    expect(await sweep.sweep(NOW)).toBe(1);
    expect(await sweep.sweep(NOW)).toBe(0);
    expect(gateway.setReadOnly).toHaveBeenCalledTimes(1);
    expect(gateway.setReadOnly).toHaveBeenCalledWith('9', true);
    expect(sets).toEqual([{ discordLockedAt: NOW }]);
  });

  it('unlocks a rescheduled post and clears the record', async () => {
    const { sweep, gateway, sets } = setup([[row(false)]]);
    expect(await sweep.sweep(NOW)).toBe(1);
    expect(gateway.setReadOnly).toHaveBeenCalledWith('9', false);
    expect(sets).toEqual([{ discordLockedAt: null }]);
  });

  it('leaves the record alone when Discord fails (retried next tick)', async () => {
    const { sweep, gateway, sets } = setup([[row(true)]]);
    gateway.setReadOnly.mockRejectedValueOnce(new Error('boom'));
    expect(await sweep.sweep(NOW)).toBe(0);
    expect(sets).toEqual([]);
  });

  it('does nothing while the bot is offline', async () => {
    const { sweep, gateway } = setup([[row(true)]], false);
    expect(await sweep.sweep(NOW)).toBe(0);
    expect(gateway.setReadOnly).not.toHaveBeenCalled();
  });
});
