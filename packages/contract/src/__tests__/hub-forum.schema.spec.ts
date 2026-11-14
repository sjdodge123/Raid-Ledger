/**
 * Hub Forum shapes (ROK-1175): thread title bounds, bodies through the Posts
 * markdown validator, PATCH needing a field, list paging, strict response
 * shapes, and the Core manifest entries for the tab and the widget.
 */
import { describe, expect, it } from 'vitest';
import {
  CreateHubForumReplySchema,
  CreateHubForumThreadSchema,
  HUB_FORUM_EDIT_WINDOW_MS,
  HUB_FORUM_PAGE_DEFAULT,
  HUB_FORUM_PAGE_MAX,
  HUB_FORUM_TITLE_MAX,
  HubForumLatestSchema,
  HubForumListQuerySchema,
  HubForumReplySchema,
  HubForumThreadSchema,
  HubForumThreadSummarySchema,
  UpdateHubForumReplySchema,
  UpdateHubForumThreadSchema,
  type HubForumThreadSummary,
} from '../hub-forum.schema.js';
import { HUB_POST_BODY_MAX } from '../hub-posts.schema.js';
import { HUB_PLUGIN_MANIFESTS, hubManifestProblems } from '../plugin-hub-manifests.js';

const at = '2026-11-14T08:00:00.000Z';
const summary: HubForumThreadSummary = {
  id: 1,
  title: 'Raid comps',
  preview: 'Who brings the healers?',
  author: { userId: 7, displayName: 'Ana', avatarUrl: null },
  createdAt: at,
  lastActivityAt: at,
  replyCount: 0,
  pinnedAt: null,
  deleted: null,
};
const can = { edit: true, delete: true, pin: false };

describe('constants (operator rulings Q5, Q6)', () => {
  it('title 120, body shares the Posts 4000 cap, 24 h edit window', () => {
    expect(HUB_FORUM_TITLE_MAX).toBe(120);
    expect(HUB_POST_BODY_MAX).toBe(4000);
    expect(HUB_FORUM_EDIT_WINDOW_MS).toBe(86_400_000);
  });
});

describe('CreateHubForumThreadSchema', () => {
  it('trims title and body', () => {
    const parsed = CreateHubForumThreadSchema.parse({ title: '  Raid comps ', body: '  hi  ' });
    expect(parsed).toEqual({ title: 'Raid comps', body: 'hi' });
  });

  it.each(['', '    ', 'x'.repeat(HUB_FORUM_TITLE_MAX + 1)])('rejects title of length %#', (title) => {
    expect(CreateHubForumThreadSchema.safeParse({ title, body: 'hi' }).success).toBe(false);
  });

  it('accepts a 120-char title and a 4000-char body', () => {
    const r = CreateHubForumThreadSchema.safeParse({ title: 't'.repeat(120), body: 'x'.repeat(4000) });
    expect(r.success).toBe(true);
  });

  it.each(['', '   ', 'x'.repeat(HUB_POST_BODY_MAX + 1)])('rejects body of length %#', (body) => {
    expect(CreateHubForumThreadSchema.safeParse({ title: 'ok', body }).success).toBe(false);
  });

  it('requires a title (no first-line-as-title, Q6)', () => {
    expect(CreateHubForumThreadSchema.safeParse({ body: 'hi' }).success).toBe(false);
  });

  it('refuses HTML with the Posts composer message', () => {
    const r = CreateHubForumThreadSchema.safeParse({ title: 'ok', body: '<b>x</b>' });
    expect(r.error?.issues[0]?.message).toBe("Posts can't contain HTML. Use the formatting buttons instead.");
  });

  it('is strict (no pin or author smuggled in)', () => {
    expect(CreateHubForumThreadSchema.safeParse({ title: 'ok', body: 'hi', pinned: true }).success).toBe(false);
  });
});

describe('UpdateHubForumThreadSchema', () => {
  it('needs at least one field, with a readable message', () => {
    const r = UpdateHubForumThreadSchema.safeParse({});
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe('Nothing to change');
  });

  it('accepts title only and body only', () => {
    expect(UpdateHubForumThreadSchema.parse({ title: ' New ' })).toEqual({ title: 'New' });
    expect(UpdateHubForumThreadSchema.parse({ body: 'b' })).toEqual({ body: 'b' });
  });

  it('still bounds the title and checks the body markdown', () => {
    expect(UpdateHubForumThreadSchema.safeParse({ title: 'x'.repeat(121) }).success).toBe(false);
    const r = UpdateHubForumThreadSchema.safeParse({ body: '[x](javascript:1)' });
    expect(r.error?.issues[0]?.message).toBe('Links must start with https:// or point to a page on this site.');
  });
});

describe('reply inputs (flat replies, Q4)', () => {
  it('create and update take only a body', () => {
    expect(CreateHubForumReplySchema.parse({ body: ' yes ' })).toEqual({ body: 'yes' });
    expect(UpdateHubForumReplySchema.safeParse({}).success).toBe(false);
    expect(CreateHubForumReplySchema.safeParse({ body: 'yes', parentReplyId: 3 }).success).toBe(false);
  });
});

describe('HubForumListQuerySchema', () => {
  it('defaults the page size and coerces query strings', () => {
    expect(HubForumListQuerySchema.parse({})).toEqual({ limit: HUB_FORUM_PAGE_DEFAULT });
    expect(HubForumListQuerySchema.parse({ limit: '5', cursor: 'abc' })).toEqual({ limit: 5, cursor: 'abc' });
  });

  it.each(['0', String(HUB_FORUM_PAGE_MAX + 1)])('rejects limit %s', (limit) => {
    expect(HubForumListQuerySchema.safeParse({ limit }).success).toBe(false);
  });

  it('caps the cursor length', () => {
    expect(HubForumListQuerySchema.safeParse({ cursor: 'c'.repeat(201) }).success).toBe(false);
  });
});

describe('response shapes', () => {
  it('a deleted thread summary carries blank text and who removed it', () => {
    const deleted = { ...summary, title: '', preview: '', author: null, deleted: 'moderator' };
    expect(HubForumThreadSummarySchema.parse(deleted).deleted).toBe('moderator');
    expect(HubForumThreadSummarySchema.safeParse({ ...summary, deleted: 'admin' }).success).toBe(false);
  });

  it('a thread with replies and per-row permissions parses; extra keys do not', () => {
    const reply = { id: 2, body: 'me', author: null, createdAt: at, editedAt: null, deleted: null, can };
    const thread = { ...summary, body: 'b', editedAt: null, can, replies: [reply], nextReplyCursor: null };
    expect(HubForumThreadSchema.parse(thread).replies).toHaveLength(1);
    expect(HubForumThreadSchema.safeParse({ ...thread, deletedText: 'x' }).success).toBe(false);
    expect(HubForumReplySchema.safeParse({ ...reply, can: { ...can, lock: true } }).success).toBe(false);
  });

  it('the widget payload holds at most five threads', () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ ...summary, id: i + 1 }));
    expect(HubForumLatestSchema.safeParse({ threads: six.slice(0, 5), total: 6 }).success).toBe(true);
    expect(HubForumLatestSchema.safeParse({ threads: six, total: 6 }).success).toBe(false);
  });
});

describe('Core manifest (ROK-1969 ownership)', () => {
  it('declares the Forum tab and the Latest threads widget under core', () => {
    expect(HUB_PLUGIN_MANIFESTS.core.tabs).toContainEqual({ id: 'forum', label: 'Forum' });
    expect(HUB_PLUGIN_MANIFESTS.core.widgets).toContainEqual(
      expect.objectContaining({ id: 'forum-latest', title: 'Latest threads', layoutKey: 'plugin' }),
    );
    expect(hubManifestProblems(HUB_PLUGIN_MANIFESTS)).toEqual([]);
  });
});
