/**
 * ROK-2208 §5.7 item 3 (R11, OQ-10) — the inbound event-thread write gate,
 * widened to poll and lineup threads by ROK-2272 S8 (R7).
 */
import type Redis from 'ioredis';
import { createRedisMock } from '../../../common/testing/redis-mock';
import type { DiscordBotClientService } from '../../../discord-bot/discord-bot-client.service';
import type { SettingsService } from '../../../settings/settings.service';
import {
  HubForumDiscordEventGate,
  subjectGateVerdict,
  eventNoticeKey,
  type SubjectGateFacts,
} from './hub-forum-discord-event-gate';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

const NOW = new Date('2026-11-16T12:00:00Z');
const LATER = new Date('2026-11-17T12:00:00Z');
const EARLIER = new Date('2026-11-15T12:00:00Z');

function facts(over: Partial<SubjectGateFacts> = {}): SubjectGateFacts {
  return {
    subject: { kind: 'event', id: 7 },
    title: 'Molten Core',
    path: '/events/7',
    writeClosesAt: LATER,
    eventDetachedAt: null,
    participant: false,
    ...over,
  };
}

describe('subjectGateVerdict', () => {
  it('imports anything in an ordinary (non-event) thread', () => {
    expect(subjectGateVerdict(facts({ subject: null }), NOW)).toBe('import');
  });
  it('imports a signed-up author (RL account or anonymous signup)', () => {
    expect(subjectGateVerdict(facts({ participant: true }), NOW)).toBe(
      'import',
    );
  });
  it('refuses an author without a writable signup', () => {
    expect(subjectGateVerdict(facts(), NOW)).toBe('refuse');
  });
  it('drops silently once the thread is read-only (ended or detached)', () => {
    const ended = facts({ participant: true, writeClosesAt: EARLIER });
    expect(subjectGateVerdict(ended, NOW)).toBe('drop');
    expect(subjectGateVerdict(facts({ eventDetachedAt: EARLIER }), NOW)).toBe(
      'drop',
    );
  });
});

function setup(f: SubjectGateFacts) {
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
    const { gate, sendEmbedDM } = setup(facts({ participant: true }));
    expect(await gate.admits({ threadId: 3 }, '111', NOW)).toBe(true);
    expect(sendEmbedDM).not.toHaveBeenCalled();
  });

  it('admits an anonymous Discord signup (OQ-10)', async () => {
    const { gate } = setup(facts({ participant: true }));
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

const POLL = facts({
  subject: { kind: 'poll', id: 12 },
  title: 'Valheim',
  path: '/community-lineup/4/schedule/12',
});
const LINEUP = facts({
  subject: { kind: 'lineup', id: 4 },
  title: 'Friday picks',
  path: '/community-lineup/4',
});

describe('ROK-2272 S8 — subjectGateVerdict for poll and lineup threads', () => {
  it.each([
    ['poll', POLL],
    ['lineup', LINEUP],
  ])('%s: imports a participant, refuses an outsider', (_k, f) => {
    expect(subjectGateVerdict({ ...f, participant: true }, NOW)).toBe('import');
    expect(subjectGateVerdict(f, NOW)).toBe('refuse');
  });

  it.each([
    ['poll', POLL],
    ['lineup', LINEUP],
  ])('%s: drops when closed or detached, even for a participant', (_k, f) => {
    const p = { ...f, participant: true };
    expect(subjectGateVerdict({ ...p, writeClosesAt: EARLIER }, NOW)).toBe(
      'drop',
    );
    expect(subjectGateVerdict({ ...p, eventDetachedAt: EARLIER }, NOW)).toBe(
      'drop',
    );
  });
});

/** The refusal DM's description, matched against `re`. */
function expectDm(send: jest.Mock, re: RegExp): void {
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0]?.[1]).toMatchObject({
    data: { description: expect.stringMatching(re) },
  });
}

describe('ROK-2272 S8 — poll and lineup refusal DMs', () => {
  it('DMs a poll outsider the poll copy with the schedule link', async () => {
    const { gate, sendEmbedDM } = setup(POLL);
    expect(await gate.admits({ threadId: 9 }, '333', NOW)).toBe(false);
    expectDm(
      sendEmbedDM,
      /^Only players who voted in Valheim can post in its discussion\. Join Raid Ledger and vote: \S+\/community-lineup\/4\/schedule\/12$/,
    );
  });

  it('DMs a lineup outsider the lineup copy with the lineup link', async () => {
    const { gate, sendEmbedDM } = setup(LINEUP);
    expect(await gate.admits({ threadId: 9 }, '333', NOW)).toBe(false);
    expectDm(
      sendEmbedDM,
      /^Only players who nominated or voted in Friday picks can post in its discussion\. Join Raid Ledger and take part: \S+\/community-lineup\/4$/,
    );
  });

  it('notices a poll outsider once per (thread, user)', async () => {
    const { gate, sendEmbedDM, redis } = setup(POLL);
    await gate.admits({ threadId: 9 }, '333', NOW);
    expect(await gate.admits({ threadId: 9 }, '333', NOW)).toBe(false);
    expect(sendEmbedDM).toHaveBeenCalledTimes(1);
    expect(await redis.client.get(eventNoticeKey(9, '333'))).toBe('1');
  });

  it('admits a poll participant without a DM', async () => {
    const { gate, sendEmbedDM } = setup({ ...POLL, participant: true });
    expect(await gate.admits({ threadId: 9 }, '333', NOW)).toBe(true);
    expect(sendEmbedDM).not.toHaveBeenCalled();
  });
});
