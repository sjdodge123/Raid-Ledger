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
import { syncExpiredPolls } from '../subject-discussion/poll-discussion.deadline';

jest.mock('../subject-discussion/poll-discussion.deadline', () => ({
  syncExpiredPolls: jest.fn(),
}));
const deadline = jest.mocked(syncExpiredPolls);

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
  deadline.mockReset();
  deadline.mockResolvedValue(0);
  const sets: unknown[] = [];
  const deletes = jest.fn(() => ({
    where: jest.fn().mockResolvedValue(undefined),
  }));
  const db = {
    delete: deletes,
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
  return { sweep, gateway, sets, outbound, registry, due, deletes };
}

const row = (readOnly: boolean): LockChange => ({
  linkId: 1,
  guildId: 7,
  threadId: 3,
  discordThreadId: '9',
  readOnly,
});

describe('HubForumDiscordEventLockSweep.sweep', () => {
  it('ROK-2292 D7: a lock drops the post starter row; a reopen keeps it', async () => {
    const locked = setup([[row(true)]]);
    await locked.sweep.sweep(NOW);
    expect(locked.deletes).toHaveBeenCalledTimes(1);
    const reopened = setup([[row(false)]]);
    await reopened.sweep.sweep(NOW);
    expect(reopened.deletes).not.toHaveBeenCalled();
  });

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

  it('a hub-pass throw still runs the registry pass, then rejects with it (MAJOR-1)', async () => {
    const { sweep, registry, due } = setup([]);
    const err = new Error('db down');
    due.mockRejectedValueOnce(err);
    registry.sweep.mockResolvedValueOnce(1);
    await expect(sweep.sweep(NOW)).rejects.toBe(err);
    expect(registry.sweep).toHaveBeenCalledWith(NOW);
  });

  it('a registry-pass throw still applies the hub pass, then rejects with it (MAJOR-1)', async () => {
    const { sweep, registry, gateway, sets } = setup([[row(true)]]);
    const err = new Error('boom');
    registry.sweep.mockRejectedValueOnce(err);
    await expect(sweep.sweep(NOW)).rejects.toBe(err);
    expect(gateway.setReadOnly).toHaveBeenCalledWith('9', true);
    expect(sets).toEqual([{ discordLockedAt: NOW }]);
  });

  it('both passes throw: rejects with the FIRST (hub) error', async () => {
    const { sweep, registry, due } = setup([]);
    const first = new Error('hub down');
    due.mockRejectedValueOnce(first);
    registry.sweep.mockRejectedValueOnce(new Error('registry down'));
    await expect(sweep.sweep(NOW)).rejects.toBe(first);
    expect(registry.sweep).toHaveBeenCalledTimes(1);
  });

  it('a per-row Discord failure stays logged-and-skipped (no rejection)', async () => {
    const { sweep, gateway, registry } = setup([[row(true)]]);
    gateway.setReadOnly.mockRejectedValueOnce(new Error('50013'));
    registry.sweep.mockResolvedValueOnce(1);
    expect(await sweep.sweep(NOW)).toBe(1);
  });

  it('offline bot runs neither pass', async () => {
    const { sweep, registry } = setup([[row(true)]], false);
    expect(await sweep.sweep(NOW)).toBe(0);
    expect(registry.sweep).not.toHaveBeenCalled();
  });
});

describe('ROK-2272 S8: the poll-deadline pass', () => {
  it('runs first, with the sweep db and now, before hub and registry', async () => {
    const { sweep, registry, due } = setup([]);
    const order: string[] = [];
    deadline.mockImplementationOnce(() => {
      order.push('poll-deadline');
      return Promise.resolve(4);
    });
    due.mockImplementationOnce(() => {
      order.push('hub');
      return Promise.resolve([]);
    });
    registry.sweep.mockImplementationOnce(() => {
      order.push('registry');
      return Promise.resolve(0);
    });
    expect(await sweep.sweep(NOW)).toBe(0);
    expect(order).toEqual(['poll-deadline', 'hub', 'registry']);
    expect(deadline).toHaveBeenCalledWith(expect.anything(), NOW);
  });

  it('its count is not part of the posts-flipped total', async () => {
    const { sweep, registry } = setup([[row(true)]]);
    deadline.mockResolvedValueOnce(5);
    registry.sweep.mockResolvedValueOnce(2);
    expect(await sweep.sweep(NOW)).toBe(3);
  });

  it('a throw still runs hub + registry, then rejects with it', async () => {
    const { sweep, registry, gateway } = setup([[row(true)]]);
    const err = new Error('poll db down');
    deadline.mockRejectedValueOnce(err);
    await expect(sweep.sweep(NOW)).rejects.toBe(err);
    expect(gateway.setReadOnly).toHaveBeenCalledWith('9', true);
    expect(registry.sweep).toHaveBeenCalledWith(NOW);
  });

  it('deadline + hub both throw: rejects with the FIRST (deadline) error', async () => {
    const { sweep, due } = setup([]);
    const first = new Error('poll db down');
    deadline.mockRejectedValueOnce(first);
    due.mockRejectedValueOnce(new Error('hub down'));
    await expect(sweep.sweep(NOW)).rejects.toBe(first);
  });

  it('runs while the bot is offline; the Discord passes still do not', async () => {
    const { sweep, registry, gateway } = setup([[row(true)]], false);
    expect(await sweep.sweep(NOW)).toBe(0);
    expect(deadline).toHaveBeenCalledWith(expect.anything(), NOW);
    expect(gateway.setReadOnly).not.toHaveBeenCalled();
    expect(registry.sweep).not.toHaveBeenCalled();
  });

  it('an offline throw is still rethrown', async () => {
    const { sweep } = setup([], false);
    const err = new Error('poll db down');
    deadline.mockRejectedValueOnce(err);
    await expect(sweep.sweep(NOW)).rejects.toBe(err);
  });
});
