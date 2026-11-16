/**
 * ROK-2226 §6.1 — EventDiscussionService: the card summary (404 / none /
 * ready / header-only) and the event-scoped delegation to HubForumService.
 */
import { NotFoundException } from '@nestjs/common';
import type {
  HubForumReplySelect,
  HubForumThreadSelect,
} from '../../../drizzle/schema/hub-forum';
import type { GuildAccessService } from '../../guild-access.service';
import type { HubForumThreadRecord } from '../hub-forum.mappers';
import { findThread, type Db } from '../hub-forum.queries';
import type { HubForumService } from '../hub-forum.service';
import { eventThreadActor } from './event-discussion.access';
import {
  findEventForSync,
  findLiveEventThread,
  newestLiveReplies,
} from './event-discussion.queries';
import {
  DISCUSSION_NOT_FOUND,
  EVENT_NOT_FOUND,
  EventDiscussionService,
} from './event-discussion.service';
import { syncEventDiscussion } from './event-discussion.sync';
import { resolveEventThread } from './forum-thread.context';

jest.mock('../hub-forum.queries', () => ({ findThread: jest.fn() }));
jest.mock('./event-discussion.sync', () => ({
  syncEventDiscussion: jest.fn(),
}));
jest.mock('./forum-thread.context', () => ({ resolveEventThread: jest.fn() }));
jest.mock('./event-discussion.queries', () => ({
  findEventForSync: jest.fn(),
  findLiveEventThread: jest.fn(),
  newestLiveReplies: jest.fn(),
}));

const NOW = new Date('2026-11-16T12:00:00.000Z');
const viewer = { id: 9, role: 'member' } as const;
const LIVE = {
  id: 21,
  guildId: 7,
  title: 'Raid',
  body: 'b',
  writeClosesAt: null,
};
const EVENT = {
  id: 5,
  title: 'Raid',
  creatorId: 3,
  guildId: 7,
  isAdHoc: false,
  end: NOW,
};

function record(replyCount: number): HubForumThreadRecord {
  const thread: HubForumThreadSelect = {
    id: 21,
    guildId: 7,
    authorId: 3,
    title: 'Raid',
    body: 'b',
    pinnedAt: null,
    pinnedBy: null,
    replyCount,
    lastActivityAt: NOW,
    editedAt: null,
    deletedAt: null,
    deletedBy: null,
    deletedAs: null,
    createdAt: NOW,
    updatedAt: NOW,
    eventId: 5,
    eventDetachedAt: null,
    writeClosesAt: null,
  };
  return { thread, author: null, event: null };
}

function reply(id: number): { reply: HubForumReplySelect; author: null } {
  const row: HubForumReplySelect = {
    id,
    threadId: 21,
    guildId: 7,
    authorId: 9,
    body: `r${id}`,
    editedAt: null,
    deletedAt: null,
    deletedBy: null,
    deletedAs: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
  return { reply: row, author: null };
}

function who(facts: { isMember: boolean; isSignedUp: boolean }) {
  return eventThreadActor(viewer.id, {
    ...facts,
    canModerate: false,
    isCreator: false,
  });
}

const scoped = {
  get: jest.fn(),
  createReply: jest.fn(),
  updateReply: jest.fn(),
  deleteReply: jest.fn(),
};
const forum = { forEventScope: jest.fn(() => scoped) };

function build(): EventDiscussionService {
  const db = {} as Db;
  const access = {} as GuildAccessService;
  const svc = new EventDiscussionService(
    db,
    access,
    forum as unknown as HubForumService,
  );
  svc.now = () => NOW;
  return svc;
}

beforeEach(() => {
  jest.mocked(findEventForSync).mockResolvedValue(EVENT);
  jest.mocked(findLiveEventThread).mockResolvedValue(LIVE);
  jest.mocked(findThread).mockResolvedValue(record(4));
  jest.mocked(newestLiveReplies).mockResolvedValue([reply(31), reply(32)]);
});
afterEach(() => jest.clearAllMocks());

describe('ROK-2226 EventDiscussionService.summary', () => {
  it('404s an unknown event before syncing', async () => {
    jest.mocked(findEventForSync).mockResolvedValue(null);
    await expect(build().summary(viewer, 5)).rejects.toThrow(
      new NotFoundException(EVENT_NOT_FOUND),
    );
    expect(syncEventDiscussion).not.toHaveBeenCalled();
  });

  it('runs the lazy sync, then reports none when no live thread exists', async () => {
    jest.mocked(findLiveEventThread).mockResolvedValue(null);
    await expect(build().summary(viewer, 5)).resolves.toEqual({
      state: 'none',
    });
    expect(syncEventDiscussion).toHaveBeenCalledWith(expect.anything(), 5, NOW);
  });

  it('ready: a signed-up reader gets the newest replies and can reply', async () => {
    const w = who({ isMember: true, isSignedUp: true });
    jest.mocked(resolveEventThread).mockResolvedValue({ who: w, lock: null });
    const out = await build().summary(viewer, 5);
    expect(out).toMatchObject({
      state: 'ready',
      guildId: 7,
      threadId: 21,
      replyCount: 4,
      lock: null,
      can: { read: true, reply: true },
    });
    const ids = out.state === 'ready' ? out.latestReplies.map((r) => r.id) : [];
    expect(ids).toEqual([31, 32]);
  });

  it('header-only: a non-reader sees count and header but no replies (ruling 16)', async () => {
    const w = who({ isMember: false, isSignedUp: false });
    jest.mocked(resolveEventThread).mockResolvedValue({ who: w, lock: null });
    const out = await build().summary(viewer, 5);
    expect(out).toMatchObject({
      state: 'ready',
      replyCount: 4,
      latestReplies: [],
      can: { read: false, reply: false },
    });
    expect(newestLiveReplies).not.toHaveBeenCalled();
  });

  it('a locked thread reports the lock and refuses reply even to a signup', async () => {
    const lock = { at: NOW.toISOString(), reason: 'event-ended' as const };
    const w = who({ isMember: true, isSignedUp: true });
    jest.mocked(resolveEventThread).mockResolvedValue({ who: w, lock });
    const out = await build().summary(viewer, 5);
    expect(out).toMatchObject({ lock, can: { read: true, reply: false } });
  });
});

describe('ROK-2226 EventDiscussionService — event-scoped delegation', () => {
  it('routes thread + reply calls through forEventScope on the live thread', async () => {
    const svc = build();
    await svc.thread(viewer, 5, {});
    await svc.createReply(viewer, 5, { body: 'x' });
    await svc.deleteReply(viewer, 5, 31);
    expect(forum.forEventScope).toHaveBeenCalledTimes(3);
    expect(scoped.get).toHaveBeenCalledWith(viewer, 7, 21, {});
    expect(scoped.createReply).toHaveBeenCalledWith(viewer, 7, 21, {
      body: 'x',
    });
    expect(scoped.deleteReply).toHaveBeenCalledWith(viewer, 7, 21, 31);
  });

  it('404s when the event has no live thread', async () => {
    jest.mocked(findLiveEventThread).mockResolvedValue(null);
    await expect(build().createReply(viewer, 5, { body: 'x' })).rejects.toThrow(
      new NotFoundException(DISCUSSION_NOT_FOUND),
    );
    expect(scoped.createReply).not.toHaveBeenCalled();
  });
});
