/** ROK-1175 — the thread row's pure copy helpers. */
import { describe, it, expect } from 'vitest';
import { buildForumThread } from '../../../test/factories/hub-forum';
import { forumAuthorName, forumDeletedLabel, forumRowMeta, replyCountLabel } from './forum-thread.helpers';

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
});
