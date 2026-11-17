/** ROK-2229 — event-thread display copy: dated title, start label and the signup count. */
import { afterAll, beforeAll, describe, it, expect, vi } from 'vitest';
import { buildForumThreadEvent } from '../../../test/factories/hub-forum';
import { eventShortDate, eventStartLabel, forumThreadTitle, signupLabel } from './forum-event-format';

/**
 * m1 (ROK-2229 review): pin a non-UTC viewer zone and an instant that falls on
 * different calendar days in New York and UTC, and build the expectations
 * with an explicit `timeZone` — so a UTC/server-zone regression fails.
 */
const ZONE = 'America/New_York';
const START = '2026-11-22T23:30:00.000Z';
const shortDateIn = (iso: string, timeZone: string): string =>
    new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone });
const timeIn = (iso: string, timeZone: string): string =>
    new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', timeZone });

beforeAll(() => {
    vi.stubEnv('TZ', ZONE);
});

afterAll(() => {
    vi.unstubAllEnvs();
});

it('uses an instant whose New York and UTC dates differ', () => {
    expect(shortDateIn(START, ZONE)).not.toBe(shortDateIn(START, 'UTC'));
});

const EVENT = buildForumThreadEvent({ startTime: START, endTime: '2026-11-23T02:30:00.000Z' });

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

    it('reads "N signed up" when the event is uncapped or the cap is absent', () => {
        expect(signupLabel({ ...EVENT, signupCount: 18, maxAttendees: null })).toBe('18 signed up');
        expect(signupLabel({ ...EVENT, signupCount: 0 })).toBe('0 signed up');
    });

    it('is null when the payload carries no count', () => {
        expect(signupLabel(EVENT)).toBeNull();
    });
});
