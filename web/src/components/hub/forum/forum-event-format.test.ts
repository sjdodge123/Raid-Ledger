/** ROK-2229 — event-thread display copy: dated title, start label and the signup count. */
import { describe, it, expect } from 'vitest';
import { buildForumThreadEvent } from '../../../test/factories/hub-forum';
import { eventShortDate, eventStartLabel, forumThreadTitle, signupLabel } from './forum-event-format';

const EVENT = buildForumThreadEvent();

describe('forumThreadTitle', () => {
    it('appends the short date (viewer timezone) to an event thread title', () => {
        expect(forumThreadTitle({ title: 'Molten Core', event: EVENT })).toBe(`Molten Core — ${eventShortDate(EVENT.startTime)}`);
    });

    it('leaves a normal thread (no event, or the event deleted) as stored', () => {
        expect(forumThreadTitle({ title: 'Raid comp' })).toBe('Raid comp');
        expect(forumThreadTitle({ title: 'Onyxia', event: null })).toBe('Onyxia');
    });
});

describe('eventStartLabel', () => {
    it('is the short date then the start time', () => {
        const time = new Date(EVENT.startTime).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        expect(eventStartLabel(EVENT.startTime)).toBe(`${eventShortDate(EVENT.startTime)} ${time}`);
    });
});

describe('signupLabel', () => {
    it('reads "N / M signed up" for a capped event', () => {
        expect(signupLabel({ ...EVENT, signupCount: 18, maxAttendees: 40 })).toBe('18 / 40 signed up');
    });

    it('reads "N signed up" when the event is uncapped or the cap is absent', () => {
        expect(signupLabel({ ...EVENT, signupCount: 18, maxAttendees: null })).toBe('18 signed up');
        expect(signupLabel({ ...EVENT, signupCount: 0 })).toBe('0 signed up');
    });

    it('is null when the payload carries no count', () => {
        expect(signupLabel(EVENT)).toBeNull();
    });
});
