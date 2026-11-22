/**
 * ROK-2297 D2 — the copy triggers only enqueue, and only for a poll with an
 * event: a plain poll opening or an eventless lock-in queues nothing.
 */
import type { Db } from '../hub-forum.queries';
import { ForumChatCopyListener } from './forum-chat-copy.listener';
import {
  chatCopyJobId,
  type ChatCopyJobData,
  type ForumChatCopyQueue,
} from './forum-chat-copy.queue';

/** A db whose match lookup returns `rows`. */
function dbReturning(rows: { eventId: number | null }[]): Db {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(rows),
  };
  return { select: () => chain } as unknown as Db;
}

function setup(rows: { eventId: number | null }[]) {
  const enqueue = jest.fn((data: ChatCopyJobData) => {
    void data;
    return Promise.resolve(true);
  });
  const queue = { enqueue } as unknown as ForumChatCopyQueue;
  return { listener: new ForumChatCopyListener(dbReturning(rows), queue), enqueue };
}

describe('ForumChatCopyListener', () => {
  it('POLL_OPENED without a linked event queues nothing', async () => {
    const { listener, enqueue } = setup([{ eventId: null }]);
    await listener.onOpened({ matchId: 4 });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('POLL_OPENED for a reschedule poll queues event → poll', async () => {
    const { listener, enqueue } = setup([{ eventId: 12 }]);
    await listener.onOpened({ matchId: 4 });
    expect(enqueue).toHaveBeenCalledWith({
      direction: 'event-to-poll',
      matchId: 4,
      eventId: 12,
    });
  });

  it('POLL_LOCKED_IN with eventId null queues nothing', async () => {
    const { listener, enqueue } = setup([]);
    await listener.onLockedIn({ matchId: 4, eventId: null });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('POLL_LOCKED_IN with an event queues poll → event', async () => {
    const { listener, enqueue } = setup([]);
    await listener.onLockedIn({ matchId: 4, eventId: 12 });
    expect(enqueue).toHaveBeenCalledWith({
      direction: 'poll-to-event',
      matchId: 4,
      eventId: 12,
    });
  });

  it('a lookup failure is swallowed (never thrown into the emitter)', async () => {
    const enqueue = jest.fn();
    const db = {
      select: () => {
        throw new Error('db down');
      },
    } as unknown as Db;
    const queue = { enqueue } as unknown as ForumChatCopyQueue;
    const listener = new ForumChatCopyListener(db, queue);
    await expect(listener.onOpened({ matchId: 4 })).resolves.toBeUndefined();
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe('chatCopyJobId', () => {
  const pair: ChatCopyJobData = {
    direction: 'poll-to-event',
    matchId: 4,
    eventId: 12,
  };

  it('is the same for the same pair (dedup) and differs by direction', () => {
    expect(chatCopyJobId(pair)).toBe(chatCopyJobId({ ...pair }));
    const back = chatCopyJobId({ ...pair, direction: 'event-to-poll' });
    expect(back).not.toBe(chatCopyJobId(pair));
  });

  it('never contains ":" (BullMQ rejects it in custom ids)', () => {
    expect(chatCopyJobId(pair)).not.toContain(':');
  });
});
