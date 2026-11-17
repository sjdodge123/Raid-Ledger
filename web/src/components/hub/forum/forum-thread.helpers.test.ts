/** ROK-1175 — the thread row's pure copy helpers. */
import { describe, it, expect } from 'vitest';
import { buildForumLock, buildForumThread, buildForumThreadEvent } from '../../../test/factories/hub-forum';
import { forumAuthorName, forumDeletedLabel, forumRowCan, forumRowMeta, replyCountLabel } from './forum-thread.helpers';

const NOW = Date.parse('2026-11-14T12:00:00.000Z');

describe('forum thread helpers', () => {
    it('names a deleted user "Former member" (AC12)', () => {
        expect(forumAuthorName(buildForumThread().author)).toBe('Grimtusk');
        expect(forumAuthorName(null)).toBe('Former member');
        expect(forumAuthorName({ userId: null, displayName: null, avatarUrl: null })).toBe('Former member');
    });

    it('says who removed a thread (AC6)', () => {
        expect(forumDeletedLabel('author')).toBe('Deleted by the author');
        expect(forumDeletedLabel('moderator')).toBe('Removed by a moderator');
    });

    it('pluralises the reply count', () => {
        expect(replyCountLabel(0)).toBe('0 replies');
        expect(replyCountLabel(1)).toBe('1 reply');
        expect(replyCountLabel(12)).toBe('12 replies');
    });

    it('meta line = author · time since last activity', () => {
        expect(forumRowMeta(buildForumThread(), NOW)).toBe('Grimtusk · 2 h ago');
    });

    it('meta line of an event thread (live or event-deleted) = "Event thread · <age>" (ROK-2229)', () => {
        expect(forumRowMeta(buildForumThread({ event: buildForumThreadEvent(), lock: null }), NOW)).toBe('Event thread · 2 h ago');
        expect(forumRowMeta(buildForumThread({ event: null, lock: buildForumLock({ reason: 'event-deleted' }) }), NOW)).toBe('Event thread · 2 h ago');
    });

    it('row rights: an event thread (live or event-deleted) never offers Edit/Delete, keeps Pin (ROK-2226 §5.5)', () => {
        const fresh = { createdAt: new Date(NOW - 60_000).toISOString() };
        const author = { userId: 1, canWrite: true, canModerate: true };
        expect(forumRowCan(buildForumThread(fresh), author, NOW), 'a normal thread is unchanged')
            .toEqual({ edit: true, delete: true, pin: true });
        expect(forumRowCan(buildForumThread({ ...fresh, event: buildForumThreadEvent() }), author, NOW))
            .toEqual({ edit: false, delete: false, pin: true });
        const orphan = buildForumThread({ ...fresh, event: null, lock: buildForumLock({ reason: 'event-deleted' }) });
        expect(forumRowCan(orphan, author, NOW)).toEqual({ edit: false, delete: false, pin: true });
    });
});
