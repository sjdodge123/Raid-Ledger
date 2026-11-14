/**
 * ROK-1175 L2 — row → contract mapping: every output parses against the
 * contract schema, and deleted rows are blanked in every view (Q8).
 */
import {
  HubForumReplySchema,
  HubForumThreadSchema,
  HubForumThreadSummarySchema,
  type HubForumCan,
} from '@raid-ledger/contract';
import type {
  HubForumReplySelect,
  HubForumThreadSelect,
} from '../../drizzle/schema/hub-forum';
import type { HubPostPersonRow } from '../posts/hub-posts.helpers';
import {
  toForumReply,
  toForumThread,
  toThreadSummary,
} from './hub-forum.mappers';

const AT = new Date('2026-11-14T10:00:00.000Z');
const LATER = new Date('2026-11-14T11:00:00.000Z');
const CAN: HubForumCan = { edit: true, delete: true, pin: false };

const person: HubPostPersonRow = {
  userId: 5,
  username: 'thrall',
  displayName: null,
  avatar: null,
  customAvatarUrl: null,
  discordId: null,
};

function thread(
  over: Partial<HubForumThreadSelect> = {},
): HubForumThreadSelect {
  return {
    id: 9,
    guildId: 2,
    authorId: 5,
    title: 'Raid night',
    body: '**Bring** flasks',
    pinnedAt: null,
    pinnedBy: null,
    replyCount: 3,
    lastActivityAt: LATER,
    editedAt: null,
    deletedAt: null,
    deletedBy: null,
    deletedAs: null,
    createdAt: AT,
    updatedAt: AT,
    ...over,
  };
}

function reply(over: Partial<HubForumReplySelect> = {}): HubForumReplySelect {
  return {
    id: 4,
    threadId: 9,
    guildId: 2,
    authorId: 5,
    body: 'see you there',
    editedAt: null,
    deletedAt: null,
    deletedBy: null,
    deletedAs: null,
    createdAt: AT,
    updatedAt: AT,
    ...over,
  };
}

describe('toThreadSummary', () => {
  it('maps a live thread with a plain preview and ISO dates', () => {
    const out = toThreadSummary({ thread: thread(), author: person });
    expect(HubForumThreadSummarySchema.parse(out)).toEqual({
      id: 9,
      title: 'Raid night',
      preview: 'Bring flasks',
      author: { userId: 5, displayName: 'thrall', avatarUrl: null },
      createdAt: AT.toISOString(),
      lastActivityAt: LATER.toISOString(),
      replyCount: 3,
      pinnedAt: null,
      deleted: null,
    });
  });

  it('blanks title + preview of a deleted thread and says who removed it', () => {
    const gone = thread({
      deletedAt: LATER,
      deletedAs: 'moderator',
      deletedBy: 7,
    });
    const out = toThreadSummary({ thread: gone, author: person });
    expect(out).toMatchObject({ title: '', preview: '', deleted: 'moderator' });
  });

  it('maps a wiped author to null and a pin to its ISO time', () => {
    const pinned = thread({ authorId: null, pinnedAt: LATER, pinnedBy: 7 });
    const out = toThreadSummary({ thread: pinned, author: null });
    expect(out.author).toBeNull();
    expect(out.pinnedAt).toBe(LATER.toISOString());
  });
});

describe('toForumReply', () => {
  it('maps a live, edited reply', () => {
    const out = toForumReply(
      { reply: reply({ editedAt: LATER }), author: person },
      CAN,
    );
    expect(HubForumReplySchema.parse(out)).toMatchObject({
      id: 4,
      body: 'see you there',
      editedAt: LATER.toISOString(),
      deleted: null,
      can: CAN,
    });
  });

  it('blanks a deleted reply body', () => {
    const gone = reply({ deletedAt: LATER, deletedAs: 'author', deletedBy: 5 });
    const out = toForumReply({ reply: gone, author: person }, CAN);
    expect(out).toMatchObject({ body: '', deleted: 'author' });
  });
});

describe('toForumThread', () => {
  it('adds the root body, can and the replies page', () => {
    const replies = [toForumReply({ reply: reply(), author: null }, CAN)];
    const out = toForumThread({ thread: thread(), author: person }, CAN, {
      replies,
      nextReplyCursor: 'abc',
    });
    const parsed = HubForumThreadSchema.parse(out);
    expect(parsed).toMatchObject({ body: '**Bring** flasks', can: CAN });
    expect(parsed.replies).toEqual(replies);
    expect(parsed.nextReplyCursor).toBe('abc');
  });

  it('blanks the root body of a deleted thread', () => {
    const gone = thread({
      deletedAt: LATER,
      deletedAs: 'author',
      deletedBy: 5,
    });
    const out = toForumThread({ thread: gone, author: person }, CAN, {
      replies: [],
      nextReplyCursor: null,
    });
    expect(out).toMatchObject({ title: '', body: '', preview: '' });
  });
});
