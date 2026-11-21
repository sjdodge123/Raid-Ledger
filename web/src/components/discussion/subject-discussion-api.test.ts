import { describe, expect, it } from 'vitest';
import {
    SUBJECT_READER_NOTE,
    SUBJECT_REPLY_READ_ONLY,
    SUBJECT_REPLY_TOO_FAST,
    subjectDiscussionKey,
    subjectReplyFailureCopy,
} from './subject-discussion-api';

const httpError = (status: number): Error => Object.assign(new Error('x'), { status });

describe('subjectDiscussionKey (ROK-2272 S9)', () => {
    it('keys poll and lineup subjects apart, even with the same id', () => {
        expect(subjectDiscussionKey({ kind: 'poll', id: 7 })).toEqual(['subject-discussion', 'poll', 7]);
        expect(subjectDiscussionKey({ kind: 'lineup', id: 7 })).toEqual(['subject-discussion', 'lineup', 7]);
    });
});

describe('subjectReplyFailureCopy (ROK-2272 S9)', () => {
    it('maps 403 to the subject reader note (R7: vote / nominate first)', () => {
        expect(subjectReplyFailureCopy('poll', httpError(403))).toBe(SUBJECT_READER_NOTE.poll);
        expect(subjectReplyFailureCopy('lineup', httpError(403))).toBe(SUBJECT_READER_NOTE.lineup);
    });

    it('maps 409 to read-only and 429 to too-fast', () => {
        expect(subjectReplyFailureCopy('poll', httpError(409))).toBe(SUBJECT_REPLY_READ_ONLY);
        expect(subjectReplyFailureCopy('lineup', httpError(429))).toBe(SUBJECT_REPLY_TOO_FAST);
    });

    it('leaves any other failure to the composer’s generic line', () => {
        expect(subjectReplyFailureCopy('poll', httpError(500))).toBeUndefined();
        expect(subjectReplyFailureCopy('poll', new Error('network'))).toBeUndefined();
    });
});
