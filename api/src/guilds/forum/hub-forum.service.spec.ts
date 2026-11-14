/**
 * ROK-1175 L3 — HubForumService: the member check before any read or write,
 * `canFor` before edit/delete (L2 writes never check), 409 on a reply to a
 * removed thread, author-vs-moderator removal, conditional PATCH spreads.
 */
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type {
  HubForumReplySelect,
  HubForumThreadSelect,
} from '../../drizzle/schema/hub-forum';
import type { GuildAccessService } from '../guild-access.service';
import {
  FORUM_EDIT_WINDOW_CLOSED,
  FORUM_NOT_AUTHOR,
  FORUM_NOT_MEMBER,
} from './hub-forum.access';
import {
  findReply,
  findThread,
  latestThreads,
  listReplies,
  listThreads,
  type Db,
} from './hub-forum.queries';
import {
  FORUM_PIN_LIMIT,
  FORUM_THREAD_CLOSED,
  HubForumService,
} from './hub-forum.service';
import * as writes from './hub-forum.writes';

jest.mock('./hub-forum.queries', () => ({
  findThread: jest.fn(),
  findReply: jest.fn(),
  listReplies: jest.fn(),
  listThreads: jest.fn(),
  latestThreads: jest.fn(),
}));
jest.mock('./hub-forum.writes', () => ({
  insertThread: jest.fn(),
  updateThread: jest.fn(),
  softDeleteThread: jest.fn(),
  setThreadPin: jest.fn(),
  pinThread: jest.fn(),
  insertReply: jest.fn(),
  updateReply: jest.fn(),
  softDeleteReply: jest.fn(),
}));

const NOW = new Date('2026-11-14T12:00:00.000Z');
const OLD = new Date(NOW.getTime() - 25 * 3_600_000);
const author = { id: 3, role: 'member' } as const;
const other = { id: 4, role: 'member' } as const;

function thread(
  over: Partial<HubForumThreadSelect> = {},
): HubForumThreadSelect {
  return {
    id: 21,
    guildId: 7,
    authorId: 3,
    title: 'Raid comp',
    body: 'Thoughts?',
    pinnedAt: null,
    pinnedBy: null,
    replyCount: 0,
    lastActivityAt: NOW,
    editedAt: null,
    deletedAt: null,
    deletedBy: null,
    deletedAs: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function reply(over: Partial<HubForumReplySelect> = {}): HubForumReplySelect {
  return {
    id: 31,
    threadId: 21,
    guildId: 7,
    authorId: 3,
    body: 'Agreed',
    editedAt: null,
    deletedAt: null,
    deletedBy: null,
    deletedAs: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function build(canView = true, canEdit = false): HubForumService {
  const fake: Pick<GuildAccessService, 'canView' | 'canEdit'> = {
    canView: jest.fn().mockResolvedValue(canView),
    canEdit: jest.fn().mockResolvedValue(canEdit),
  };
  const db: Partial<Db> = {};
  const service = new HubForumService(db as Db, fake as GuildAccessService);
  service.now = () => NOW;
  return service;
}

beforeEach(() => {
  jest.mocked(findThread).mockResolvedValue({ thread: thread(), author: null });
  jest.mocked(findReply).mockResolvedValue({ reply: reply(), author: null });
  jest.mocked(listReplies).mockResolvedValue({ records: [], next: null });
  jest.mocked(writes.insertThread).mockResolvedValue(thread());
  jest.mocked(writes.updateThread).mockResolvedValue(thread());
  jest.mocked(writes.softDeleteThread).mockResolvedValue(thread());
  jest.mocked(writes.setThreadPin).mockResolvedValue(thread());
  jest.mocked(writes.pinThread).mockResolvedValue(thread());
  jest.mocked(writes.insertReply).mockResolvedValue(reply());
  jest.mocked(writes.softDeleteReply).mockResolvedValue(reply());
});
afterEach(() => jest.clearAllMocks());

describe('ROK-1175 HubForumService — visitors (Q1)', () => {
  it.each([
    ['list', (s: HubForumService) => s.list(other, 7, {})],
    ['latest', (s: HubForumService) => s.latest(other, 7)],
    ['get', (s: HubForumService) => s.get(other, 7, 21, {})],
    [
      'createThread',
      (s: HubForumService) =>
        s.createThread(other, 7, { title: 't', body: 'b' }),
    ],
    [
      'createReply',
      (s: HubForumService) => s.createReply(other, 7, 21, { body: 'b' }),
    ],
    ['deleteThread', (s: HubForumService) => s.deleteThread(other, 7, 21)],
  ])('%s → 403 before any lookup', async (_l, run) => {
    await expect(run(build(false))).rejects.toThrow(
      new ForbiddenException(FORUM_NOT_MEMBER),
    );
    expect(findThread).not.toHaveBeenCalled();
    expect(writes.insertThread).not.toHaveBeenCalled();
  });
});

describe('ROK-1175 HubForumService — edits (Q5)', () => {
  it('the author edits only the title; body is not sent to the write', async () => {
    await build().updateThread(author, 7, 21, { title: 'New title' });
    expect(writes.updateThread).toHaveBeenCalledWith(
      {},
      { guildId: 7, threadId: 21 },
      { title: 'New title', now: NOW },
    );
  });

  it('25 h later the author gets "Edit window closed" and nothing is written', async () => {
    jest
      .mocked(findThread)
      .mockResolvedValue({ thread: thread({ createdAt: OLD }), author: null });
    await expect(
      build().updateThread(author, 7, 21, { body: 'x' }),
    ).rejects.toThrow(FORUM_EDIT_WINDOW_CLOSED);
    expect(writes.updateThread).not.toHaveBeenCalled();
  });

  it('an officer cannot edit a member reply', async () => {
    await expect(
      build(true, true).updateReply(other, 7, 21, 31, { body: 'x' }),
    ).rejects.toThrow(FORUM_NOT_AUTHOR);
    expect(writes.updateReply).not.toHaveBeenCalled();
  });
});

describe('ROK-1175 HubForumService — removal (Q8)', () => {
  it('an officer removes a member thread as moderator', async () => {
    await build(true, true).deleteThread(other, 7, 21);
    expect(writes.softDeleteThread).toHaveBeenCalledWith(
      {},
      { guildId: 7, threadId: 21 },
      { by: 4, as: 'moderator', now: NOW },
    );
  });

  it('the author removes their own reply as author', async () => {
    await build().deleteReply(author, 7, 21, 31);
    expect(writes.softDeleteReply).toHaveBeenCalledWith(
      {},
      { guildId: 7, threadId: 21, replyId: 31 },
      { by: 3, as: 'author', now: NOW },
    );
  });

  it('another member cannot remove the thread', async () => {
    await expect(build().deleteThread(other, 7, 21)).rejects.toThrow(
      ForbiddenException,
    );
    expect(writes.softDeleteThread).not.toHaveBeenCalled();
  });

  it('a reply to a removed thread is 409', async () => {
    jest.mocked(writes.insertReply).mockResolvedValue(undefined);
    await expect(
      build().createReply(author, 7, 21, { body: 'late' }),
    ).rejects.toThrow(new ConflictException(FORUM_THREAD_CLOSED));
  });

  it('a thread of another hub is 404', async () => {
    jest.mocked(findThread).mockResolvedValue(undefined);
    await expect(build().get(author, 7, 21, {})).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('ROK-1175 HubForumService — views', () => {
  it('the author sees edit + delete on a fresh thread, no pin; an officer sees pin', async () => {
    expect((await build().get(author, 7, 21, {})).can).toEqual({
      edit: true,
      delete: true,
      pin: false,
    });
    expect((await build(true, true).get(other, 7, 21, {})).can).toEqual({
      edit: false,
      delete: true,
      pin: true,
    });
  });

  it('pin stamps the actor under the 50-pin cap; unpin clears', async () => {
    await build(true, true).setPin(other, 7, 21, true);
    await build(true, true).setPin(other, 7, 21, false);
    expect(jest.mocked(writes.pinThread).mock.calls.map((c) => c[2])).toEqual([
      { by: 4, now: NOW },
    ]);
    expect(jest.mocked(writes.pinThread).mock.calls[0]?.[3]).toBe(50);
    expect(
      jest.mocked(writes.setThreadPin).mock.calls.map((c) => c[2]),
    ).toEqual([null]);
  });

  it('a pin past the cap is 409 "Unpin a thread first"', async () => {
    jest.mocked(writes.pinThread).mockResolvedValue('full');
    const err = await build(true, true)
      .setPin(other, 7, 21, true)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).message).toBe(FORUM_PIN_LIMIT);
    expect(FORUM_PIN_LIMIT).toContain('Unpin a thread first');
  });

  it('list, latest and pin skip the canEdit lookup', async () => {
    jest.mocked(listThreads).mockResolvedValue({
      records: [],
      next: null,
      pinned: [],
    });
    jest.mocked(latestThreads).mockResolvedValue({ records: [], total: 0 });
    const fake = {
      canView: jest.fn().mockResolvedValue(true),
      canEdit: jest.fn().mockResolvedValue(true),
    };
    const s = new HubForumService({} as Db, fake as never);
    await s.list(other, 7, {});
    await s.latest(other, 7);
    await s.setPin(other, 7, 21, true);
    expect(fake.canView).toHaveBeenCalledTimes(3);
    expect(fake.canEdit).not.toHaveBeenCalled();
  });
});
