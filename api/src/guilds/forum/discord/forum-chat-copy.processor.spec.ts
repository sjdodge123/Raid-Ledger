/**
 * ROK-2297 D2 — the copy job: threads are synced before they are read, the
 * RL copy runs once, and each new row is mirrored in insert order, one
 * awaited send at a time; a failed send never stops the rest.
 */
import type { Job, Queue } from 'bullmq';
import { copyForumChat } from '../chat-copy/forum-chat-copy.writes';
import { findLiveEventThread } from '../event-discussion/event-discussion.queries';
import { syncEventDiscussion } from '../event-discussion/event-discussion.sync';
import type { HubForumChange } from '../hub-forum.emit';
import type { Db } from '../hub-forum.queries';
import { findLivePollThread } from '../subject-discussion/poll-discussion.queries';
import { syncPollDiscussion } from '../subject-discussion/poll-discussion.sync';
import type { QueueHealthService } from '../../../queue/queue-health.service';
import { ForumChatCopyProcessor } from './forum-chat-copy.processor';
import type { ChatCopyJobData } from './forum-chat-copy.queue';
import type { HubForumDiscordOutboundService } from './hub-forum-discord-outbound.service';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));
jest.mock('../chat-copy/forum-chat-copy.writes');
jest.mock('../event-discussion/event-discussion.queries');
jest.mock('../event-discussion/event-discussion.sync');
jest.mock('../subject-discussion/poll-discussion.queries');
jest.mock('../subject-discussion/poll-discussion.sync');

const copy = jest.mocked(copyForumChat);
const eventThread = jest.mocked(findLiveEventThread);
const pollThread = jest.mocked(findLivePollThread);
const syncEvent = jest.mocked(syncEventDiscussion);
const syncPoll = jest.mocked(syncPollDiscussion);

const DB = {} as unknown as Db;
const thread = (id: number) => ({
  id,
  guildId: 7,
  title: 't',
  body: '',
  writeClosesAt: null,
});

function job(direction: ChatCopyJobData['direction']): Job<ChatCopyJobData> {
  const data = { direction, matchId: 4, eventId: 12 };
  return {
    id: 'j',
    data,
    attemptsMade: 0,
    opts: { attempts: 3 },
  } as Job<ChatCopyJobData>;
}

function setup(apply: (c: HubForumChange) => Promise<void>) {
  const log: string[] = [];
  const outbound = { apply: jest.fn(apply) };
  const processor = new ForumChatCopyProcessor(
    {} as Queue,
    DB,
    outbound as unknown as HubForumDiscordOutboundService,
    {} as QueueHealthService,
  );
  return { processor, outbound, log };
}

beforeEach(() => {
  jest.resetAllMocks();
  syncEvent.mockResolvedValue('noop');
  syncPoll.mockResolvedValue('noop');
  eventThread.mockResolvedValue(thread(100));
  pollThread.mockResolvedValue(thread(200));
});

describe('ForumChatCopyProcessor', () => {
  it('syncs both threads before reading them, then copies src → dst', async () => {
    const order: string[] = [];
    syncEvent.mockImplementation(
      () => (order.push('syncEvent'), Promise.resolve('noop')),
    );
    syncPoll.mockImplementation(
      () => (order.push('syncPoll'), Promise.resolve('noop')),
    );
    eventThread.mockImplementation(
      () => (order.push('findEvent'), Promise.resolve(thread(100))),
    );
    copy.mockResolvedValue(null);
    const { processor } = setup(() => Promise.resolve());
    await processor.process(job('poll-to-event'));
    expect(order.indexOf('findEvent')).toBeGreaterThan(
      order.indexOf('syncPoll'),
    );
    expect(order.indexOf('findEvent')).toBeGreaterThan(
      order.indexOf('syncEvent'),
    );
    expect(copy).toHaveBeenCalledWith(DB, {
      srcThreadId: 200,
      dstThreadId: 100,
    });
  });

  it('event → poll copies the event thread into the poll thread', async () => {
    copy.mockResolvedValue(null);
    const { processor } = setup(() => Promise.resolve());
    await processor.process(job('event-to-poll'));
    expect(copy).toHaveBeenCalledWith(DB, {
      srcThreadId: 100,
      dstThreadId: 200,
    });
  });

  it('sends each row in insert order, one awaited send at a time', async () => {
    copy.mockResolvedValue({
      guildId: 7,
      threadId: 200,
      replyIds: [9, 10, 11],
    });
    let inFlight = 0;
    const seen: { replyId: number | undefined; inFlight: number }[] = [];
    const { processor, outbound } = setup(async (c) => {
      inFlight += 1;
      seen.push({ replyId: c.replyId, inFlight });
      await Promise.resolve();
      inFlight -= 1;
    });
    await processor.process(job('event-to-poll'));
    expect(seen).toEqual([
      { replyId: 9, inFlight: 1 },
      { replyId: 10, inFlight: 1 },
      { replyId: 11, inFlight: 1 },
    ]);
    expect(outbound.apply).toHaveBeenCalledWith({
      guildId: 7,
      op: 'reply.created',
      threadId: 200,
      replyId: 9,
      actorId: 0,
    });
  });

  it('one failed send does not stop the rest', async () => {
    copy.mockResolvedValue({
      guildId: 7,
      threadId: 200,
      replyIds: [9, 10, 11],
    });
    const { processor, outbound } = setup((c) =>
      c.replyId === 10 ? Promise.reject(new Error('429')) : Promise.resolve(),
    );
    await expect(
      processor.process(job('event-to-poll')),
    ).resolves.toBeUndefined();
    const sent = outbound.apply.mock.calls.map(([c]) => c.replyId);
    expect(sent).toEqual([9, 10, 11]);
  });

  it('a missing target thread copies and sends nothing', async () => {
    pollThread.mockResolvedValue(null);
    const { processor, outbound } = setup(() => Promise.resolve());
    await processor.process(job('event-to-poll'));
    expect(copy).not.toHaveBeenCalled();
    expect(outbound.apply).not.toHaveBeenCalled();
  });

  it('an already-copied pair (null) sends nothing', async () => {
    copy.mockResolvedValue(null);
    const { processor, outbound } = setup(() => Promise.resolve());
    await processor.process(job('poll-to-event'));
    expect(outbound.apply).not.toHaveBeenCalled();
  });

  it('an RL copy failure is rethrown for the BullMQ retry', async () => {
    copy.mockRejectedValue(new Error('deadlock'));
    const { processor, outbound } = setup(() => Promise.resolve());
    await expect(processor.process(job('poll-to-event'))).rejects.toThrow(
      'deadlock',
    );
    expect(outbound.apply).not.toHaveBeenCalled();
  });
});
