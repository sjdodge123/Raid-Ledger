/** ROK-2229 — event-thread display copy: dated title, start label and the signup count. */
import { describe, it, expect } from 'vitest';
import { SPLIT_DAY_END, SPLIT_DAY_START, VIEWER_ZONE, pinViewerZone, shortDateIn, timeIn } from '../../../test/tz-helpers';
import { buildForumThreadEvent } from '../../../test/factories/hub-forum';
import { eventShortDate, eventStartLabel, forumThreadTitle, signupLabel } from './forum-event-format';

/**
 * m1/B1 (ROK-2229 review): a non-UTC viewer zone and an instant on different
 * calendar days there and in UTC; expectations use an explicit `timeZone`.
 */
const ZONE = VIEWER_ZONE;
const START = SPLIT_DAY_START;
pinViewerZone();

it('uses an instant whose New York and UTC dates differ', () => {
    // Sun 22 Nov 21:30 in New York (EST, UTC-5); Mon 23 Nov 02:30 in UTC.
    expect(shortDateIn(START, ZONE)).toContain('22');
    expect(shortDateIn(START, 'UTC')).toContain('23');
});

const EVENT = buildForumThreadEvent({ startTime: START, endTime: SPLIT_DAY_END });

describe('forumThreadTitle', () => {
    it('appends the short date (viewer timezone) to an event thread title', () => {
        expect(forumThreadTitle({ title: 'Molten Core', event: EVENT })).toBe(`Molten Core — ${shortDateIn(START, ZONE)}`);
    });

    it('leaves a normal thread (no event, or the event deleted) as stored', () => {
        expect(forumThreadTitle({ title: 'Raid comp' })).toBe('Raid comp');
        expect(forumThreadTitle({ title: 'Onyxia', event: null })).toBe('Onyxia');
    });
});

describe('eventStartLabel', () => {
    it('is the short date then the start time', () => {
        expect(eventStartLabel(START)).toBe(`${shortDateIn(START, ZONE)} ${timeIn(START, ZONE)}`);
        expect(eventShortDate(START)).toBe(shortDateIn(START, ZONE));
    });
});

describe('signupLabel', () => {
    it('reads "N / M signed up" for a capped event', () => {
        expect(signupLabel({ ...EVENT, signupCount: 18, maxAttendees: 40 })).toBe('18 / 40 signed up');
    });

    it('reads a zero capacity as full ("N / 0"), not uncapped', () => {
        expect(signupLabel({ ...EVENT, signupCount: 2, maxAttendees: 0 })).toBe('2 / 0 signed up');
    });

    it('reads "N signed up" when the event is uncapped or the cap is absent', () => {
        expect(signupLabel({ ...EVENT, signupCount: 18, maxAttendees: null })).toBe('18 signed up');
        expect(signupLabel({ ...EVENT, signupCount: 0 })).toBe('0 signed up');
    });

    it('is null when the payload carries no count', () => {
        expect(signupLabel(EVENT)).toBeNull();
    });
});
