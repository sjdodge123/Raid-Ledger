/**
 * ROK-1175 L2 — pure forum helpers: cursor round trip, preview truncation,
 * `deleted_as` narrowing and the `canFor` permission matrix (Q5/Q8).
 */
import { BadRequestException } from '@nestjs/common';
import {
  HUB_FORUM_EDIT_WINDOW_MS,
  HUB_FORUM_PREVIEW_MAX,
} from '@raid-ledger/contract';
import {
  canFor,
  decodeForumCursor,
  encodeForumCursor,
  forumDeleted,
  forumPreview,
  withinEditWindow,
  type HubForumActor,
  type HubForumOwnedRow,
} from './hub-forum.helpers';

const CREATED = new Date('2026-11-14T10:00:00.000Z');
const SOON = new Date(CREATED.getTime() + 60_000);
const LATE = new Date(CREATED.getTime() + HUB_FORUM_EDIT_WINDOW_MS);

const author: HubForumActor = { userId: 5, canWrite: true, canModerate: false };
const member: HubForumActor = { userId: 6, canWrite: true, canModerate: false };
const officer: HubForumActor = { userId: 7, canWrite: true, canModerate: true };
const leftHub: HubForumActor = {
  userId: 5,
  canWrite: false,
  canModerate: false,
};

function row(over: Partial<HubForumOwnedRow> = {}): HubForumOwnedRow {
  return { authorId: 5, createdAt: CREATED, deletedAt: null, ...over };
}

describe('forum cursor', () => {
  it('round-trips the µs timestamp text and id', () => {
    const pos = { at: '2026-11-14T10:00:00.123456Z', id: 42 };
    expect(decodeForumCursor(encodeForumCursor(pos))).toEqual(pos);
  });

  it('rejects a foreign cursor with a 400', () => {
    const bad = Buffer.from('nope').toString('base64url');
    expect(() => decodeForumCursor(bad)).toThrow(BadRequestException);
  });
});

describe('forumPreview', () => {
  it('strips markdown and collapses whitespace to one line', () => {
    expect(forumPreview('# Raid\n\n**Bring** _flasks_\n- one')).toBe(
      'Raid Bring flasks • one',
    );
  });

  it('keeps a body at exactly the max untouched', () => {
    const exact = 'a'.repeat(HUB_FORUM_PREVIEW_MAX);
    expect(forumPreview(exact)).toBe(exact);
  });

  it('cuts a longer body to the max code points ending in an ellipsis', () => {
    const out = forumPreview('😀'.repeat(HUB_FORUM_PREVIEW_MAX + 5));
    expect(Array.from(out)).toHaveLength(HUB_FORUM_PREVIEW_MAX);
    expect(out.endsWith('😀…')).toBe(true);
  });
});

describe('forumDeleted', () => {
  it('passes the two known values and maps anything else to null', () => {
    expect(forumDeleted('author')).toBe('author');
    expect(forumDeleted('moderator')).toBe('moderator');
    expect(forumDeleted(null)).toBeNull();
    expect(forumDeleted('admin')).toBeNull();
  });
});

describe('withinEditWindow', () => {
  it('is open just before 24 h and closed at 24 h', () => {
    expect(withinEditWindow(CREATED, new Date(LATE.getTime() - 1))).toBe(true);
    expect(withinEditWindow(CREATED, LATE)).toBe(false);
  });
});

describe('canFor', () => {
  const thread = { now: SOON, pinnable: true };

  it('lets the author edit + delete but not pin their live thread', () => {
    expect(canFor(author, row(), thread)).toEqual({
      edit: true,
      delete: true,
      pin: false,
    });
  });

  it('closes author edit after the window but keeps delete', () => {
    expect(canFor(author, row(), { ...thread, now: LATE })).toEqual({
      edit: false,
      delete: true,
      pin: false,
    });
  });

  it('gives another member nothing', () => {
    expect(canFor(member, row(), thread)).toEqual({
      edit: false,
      delete: false,
      pin: false,
    });
  });

  it('lets a moderator delete + pin but never rewrite another member', () => {
    expect(canFor(officer, row(), thread)).toEqual({
      edit: false,
      delete: true,
      pin: true,
    });
  });

  it('never offers pin on a reply', () => {
    expect(canFor(officer, row(), { now: SOON, pinnable: false }).pin).toBe(
      false,
    );
  });

  it('gives an author who can no longer write (visitor) nothing', () => {
    expect(canFor(leftHub, row(), thread)).toEqual({
      edit: false,
      delete: false,
      pin: false,
    });
  });

  it('offers nothing on a deleted row, even to its author or a moderator', () => {
    const gone = row({ deletedAt: SOON });
    const none = { edit: false, delete: false, pin: false };
    expect(canFor(author, gone, thread)).toEqual(none);
    expect(canFor(officer, gone, thread)).toEqual(none);
  });

  it('gives nobody ownership of a wiped author row', () => {
    const orphan = row({ authorId: null });
    expect(canFor(member, orphan, thread).delete).toBe(false);
  });
});
