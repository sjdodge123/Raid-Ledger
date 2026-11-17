/**
 * ROK-2208 §5.7 item 3 (R11, OQ-10) — the inbound event-thread write gate.
 */
import type Redis from 'ioredis';
import { createRedisMock } from '../../../common/testing/redis-mock';
import type { DiscordBotClientService } from '../../../discord-bot/discord-bot-client.service';
import type { SettingsService } from '../../../settings/settings.service';
import {
  HubForumDiscordEventGate,
  eventGateVerdict,
  eventNoticeKey,
  type EventGateFacts,
} from './hub-forum-discord-event-gate';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

const NOW = new Date('2026-11-16T12:00:00Z');
const LATER = new Date('2026-11-17T12:00:00Z');
const EARLIER = new Date('2026-11-15T12:00:00Z');

function facts(over: Partial<EventGateFacts> = {}): EventGateFacts {
  return {
    eventId: 7,
    eventTitle: 'Molten Core',
    writeClosesAt: LATER,
    eventDetachedAt: null,
    signedUp: false,
    ...over,
  };
}

describe('eventGateVerdict', () => {
  it('imports anything in an ordinary (non-event) thread', () => {
    expect(eventGateVerdict(facts({ eventId: null }), NOW)).toBe('import');
  });
  it('imports a signed-up author (RL account or anonymous signup)', () => {
    expect(eventGateVerdict(facts({ signedUp: true }), NOW)).toBe('import');
  });
  it('refuses an author without a writable signup', () => {
    expect(eventGateVerdict(facts(), NOW)).toBe('refuse');
  });
  it('drops silently once the thread is read-only (ended or detached)', () => {
    const ended = facts({ signedUp: true, writeClosesAt: EARLIER });
    expect(eventGateVerdict(ended, NOW)).toBe('drop');
    expect(eventGateVerdict(facts({ eventDetachedAt: EARLIER }), NOW)).toBe(
      'drop',
    );
  });
});

function setup(f: EventGateFacts) {
  const redis = createRedisMock();
  const sendEmbedDM = jest.fn().mockResolvedValue(undefined);
  const client = { sendEmbedDM } as unknown as DiscordBotClientService;
  const settings = {
    get: jest.fn().mockResolvedValue(null),
  } as unknown as SettingsService;
  const gate = new HubForumDiscordEventGate(
    {} as ForumDiscordDb,
    redis.client as unknown as Redis,
    client,
    settings,
  );
  jest.spyOn(gate, 'loadFacts').mockResolvedValue(f);
  return { gate, sendEmbedDM, redis };
}

describe('HubForumDiscordEventGate.admits', () => {
  it('admits a signed-up author without a DM', async () => {
    const { gate, sendEmbedDM } = setup(facts({ signedUp: true }));
    expect(await gate.admits({ threadId: 3 }, '111', NOW)).toBe(true);
    expect(sendEmbedDM).not.toHaveBeenCalled();
  });

  it('admits an anonymous Discord signup (OQ-10)', async () => {
    const { gate } = setup(facts({ signedUp: true }));
    expect(await gate.admits({ threadId: 3 }, 'anon-1', NOW)).toBe(true);
  });

  it('refuses a non-signup and DMs them once with the event link', async () => {
    const { gate, sendEmbedDM } = setup(facts());
    expect(await gate.admits({ threadId: 3 }, '222', NOW)).toBe(false);
    expect(sendEmbedDM).toHaveBeenCalledTimes(1);
    const call = sendEmbedDM.mock.calls[0];
    expect(call?.[0]).toBe('222');
    expect(call?.[1]).toMatchObject({
      data: {
        description: expect.stringMatching(
          /^Only players signed up for Molten Core can post in its discussion\. Join Raid Ledger and sign up: \S+\/events\/7$/,
        ),
      },
    });
  });

  it('sends no second DM for a second post in the same thread', async () => {
    const { gate, sendEmbedDM, redis } = setup(facts());
    await gate.admits({ threadId: 3 }, '222', NOW);
    expect(await gate.admits({ threadId: 3 }, '222', NOW)).toBe(false);
    expect(sendEmbedDM).toHaveBeenCalledTimes(1);
    expect(await redis.client.ttl(eventNoticeKey(3, '222'))).toBeGreaterThan(
      29 * 24 * 3600,
    );
  });

  it('notifies the same user again in a different thread', async () => {
    const { gate, sendEmbedDM } = setup(facts());
    await gate.admits({ threadId: 3 }, '222', NOW);
    await gate.admits({ threadId: 4 }, '222', NOW);
    expect(sendEmbedDM).toHaveBeenCalledTimes(2);
  });

  it('stays silent when the user has DMs closed (50007)', async () => {
    const { gate, sendEmbedDM } = setup(facts());
    sendEmbedDM.mockRejectedValueOnce(
      Object.assign(new Error('Cannot send'), { code: 50007 }),
    );
    await expect(gate.admits({ threadId: 3 }, '222', NOW)).resolves.toBe(false);
  });

  it('review MINOR-2: a Redis outage still refuses, never throws, and sends no DM', async () => {
    const { gate, sendEmbedDM, redis } = setup(facts());
    jest
      .spyOn(redis.client, 'set')
      .mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(gate.admits({ threadId: 3 }, '222', NOW)).resolves.toBe(false);
    expect(sendEmbedDM).not.toHaveBeenCalled();
  });

  it('drops a message in a read-only thread without a DM', async () => {
    const { gate, sendEmbedDM } = setup(facts({ writeClosesAt: EARLIER }));
    expect(await gate.admits({ threadId: 3 }, '222', NOW)).toBe(false);
    expect(sendEmbedDM).not.toHaveBeenCalled();
  });
});
