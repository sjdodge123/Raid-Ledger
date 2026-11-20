/**
 * ROK-2208 §5.7 item 4 (R12) — the event-thread lock sweep (unit).
 */
import type { DiscordBotClientService } from '../../../discord-bot/discord-bot-client.service';
import {
  HubForumDiscordEventLockGateway,
  HubForumDiscordEventLockSweep,
  type LockChange,
} from './hub-forum-discord-event-lock';
import type { EventPlanningPostsLockSweep } from './event-planning-posts.lock';
import type { HubForumDiscordOutboundService } from './hub-forum-discord-outbound.service';
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
  const outbound = { apply: jest.fn().mockResolvedValue(undefined) };
  const registry = { sweep: jest.fn().mockResolvedValue(0) };
  const sweep = new HubForumDiscordEventLockSweep(
    db,
    gateway as unknown as HubForumDiscordEventLockGateway,
    client,
    outbound as unknown as HubForumDiscordOutboundService,
    registry as unknown as EventPlanningPostsLockSweep,
  );
  const due = jest.spyOn(sweep, 'due');
  for (const r of rounds) due.mockResolvedValueOnce(r);
  due.mockResolvedValue([]);
  return { sweep, gateway, sets, outbound, registry, due };
}

const row = (readOnly: boolean): LockChange => ({
  linkId: 1,
  guildId: 7,
  threadId: 3,
  discordThreadId: '9',
  readOnly,
});

describe('HubForumDiscordEventLockSweep.sweep', () => {
  it('locks + archives once and records the lock', async () => {
    const { sweep, gateway, sets, outbound } = setup([[row(true)]]);
    expect(await sweep.sweep(NOW)).toBe(1);
    expect(await sweep.sweep(NOW)).toBe(0);
    expect(gateway.setReadOnly).toHaveBeenCalledTimes(1);
    expect(gateway.setReadOnly).toHaveBeenCalledWith('9', true);
    expect(sets).toEqual([{ discordLockedAt: NOW }]);
    expect(outbound.apply).not.toHaveBeenCalled();
  });

  it('unlocks a rescheduled post, clears the record, then re-drives its title (MINOR-1)', async () => {
    const { sweep, gateway, sets, outbound } = setup([[row(false)]]);
    expect(await sweep.sweep(NOW)).toBe(1);
    expect(gateway.setReadOnly).toHaveBeenCalledWith('9', false);
    expect(sets).toEqual([{ discordLockedAt: null }]);
    expect(outbound.apply).toHaveBeenCalledWith({
      guildId: 7,
      threadId: 3,
      op: 'thread.updated',
      actorId: 0,
    });
  });

  it('a failed re-drive still counts the reopen (the lock state is recorded)', async () => {
    const { sweep, outbound, sets } = setup([[row(false)]]);
    outbound.apply.mockRejectedValueOnce(new Error('db down'));
    expect(await sweep.sweep(NOW)).toBe(1);
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

describe('ROK-2272 S4a: the registry pass', () => {
  it('adds the registry count to the hub count', async () => {
    const { sweep, registry } = setup([[row(true)]]);
    registry.sweep.mockResolvedValueOnce(2);
    expect(await sweep.sweep(NOW)).toBe(3);
    expect(registry.sweep).toHaveBeenCalledWith(NOW);
  });

  it('a hub-pass throw does not stop the registry pass', async () => {
    const { sweep, registry, due } = setup([]);
    due.mockRejectedValueOnce(new Error('db down'));
    registry.sweep.mockResolvedValueOnce(1);
    expect(await sweep.sweep(NOW)).toBe(1);
  });

  it('a registry-pass throw keeps the hub count', async () => {
    const { sweep, registry } = setup([[row(true)]]);
    registry.sweep.mockRejectedValueOnce(new Error('boom'));
    expect(await sweep.sweep(NOW)).toBe(1);
  });

  it('offline bot runs neither pass', async () => {
    const { sweep, registry } = setup([[row(true)]], false);
    expect(await sweep.sweep(NOW)).toBe(0);
    expect(registry.sweep).not.toHaveBeenCalled();
  });
});
