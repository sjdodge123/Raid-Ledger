/**
 * "Add to calendar" URL builders (ROK-1596 W2). The Google / Outlook shapes
 * are UNVERIFIED against live provider docs — these pins make any change to
 * them deliberate.
 */
import { describe, it, expect } from 'vitest';
import { googleCalendarUrl, icsPath, outlookCalendarUrl, toUtcStamp, type AddToCalendarEvent } from './add-to-calendar.helpers';

const event: AddToCalendarEvent = {
    id: 42,
    title: 'Karazhan, first clear & more',
    startTime: '2026-09-25T20:00:00-04:00',
    endTime: '2026-09-25T23:00:00-04:00',
    url: 'https://raid.example.com/events/42',
};

describe('toUtcStamp', () => {
    it('converts an offset ISO time to a UTC basic-format stamp', () => {
        expect(toUtcStamp(event.startTime)).toBe('20260926T000000Z');
    });
});

describe('googleCalendarUrl', () => {
    it('pins the TEMPLATE render URL with encoded title/details and UTC dates', () => {
        expect(googleCalendarUrl(event)).toBe(
            'https://calendar.google.com/calendar/render?action=TEMPLATE'
            + '&text=Karazhan%2C%20first%20clear%20%26%20more'
            + '&details=https%3A%2F%2Fraid.example.com%2Fevents%2F42'
            + '&dates=20260926T000000Z/20260926T030000Z',
        );
    });
});

describe('outlookCalendarUrl', () => {
    it('pins the deeplink compose URL with encoded subject and ISO UTC start/end', () => {
        const url = new URL(outlookCalendarUrl(event));
        expect(`${url.origin}${url.pathname}`).toBe('https://outlook.live.com/calendar/0/deeplink/compose');
        expect(Object.fromEntries(url.searchParams)).toEqual({
            path: '/calendar/action/compose', rru: 'addevent', subject: 'Karazhan, first clear & more',
            startdt: '2026-09-26T00:00:00.000Z', enddt: '2026-09-26T03:00:00.000Z', body: event.url,
        });
        expect(outlookCalendarUrl(event)).toContain('subject=Karazhan%2C%20first%20clear%20%26%20more');
    });
});

describe('icsPath', () => {
    it('points at the one-event ICS endpoint', () => {
        expect(icsPath(42)).toBe('/events/42/ics');
    });
});
