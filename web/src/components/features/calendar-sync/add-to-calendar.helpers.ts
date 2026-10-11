/**
 * "Add to calendar" for someone with no connected calendar (ROK-1596 S3 note,
 * F10: works with the calendar kill switch off — no provider app involved).
 *
 * The Google `render?action=TEMPLATE` and Outlook `deeplink/compose` URL
 * shapes are UNVERIFIED against live provider docs; the unit spec pins them so
 * a change is deliberate. The `.ics` comes from `GET /events/:id/ics` (E1).
 */
import { fetchWithAuth } from '../../../lib/api/fetch-api';

export interface AddToCalendarEvent {
    id: number;
    title: string;
    startTime: string;
    endTime: string;
    /** Link back to the event page, put in the entry's details. */
    url: string;
}

/** `2026-09-25T20:00:00.000Z` → `20260925T200000Z` (UTC, no separators). */
export function toUtcStamp(iso: string): string {
    return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function query(params: Record<string, string>): string {
    return Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
}

/** Google Calendar's prefilled "new event" page. `dates` stays unencoded (digits, T, Z and one `/`). */
export function googleCalendarUrl(e: AddToCalendarEvent): string {
    const dates = `${toUtcStamp(e.startTime)}/${toUtcStamp(e.endTime)}`;
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&${query({ text: e.title, details: e.url })}&dates=${dates}`;
}

/** Outlook on the web's prefilled compose page (personal accounts). */
export function outlookCalendarUrl(e: AddToCalendarEvent): string {
    const params = {
        path: '/calendar/action/compose', rru: 'addevent', subject: e.title,
        startdt: new Date(e.startTime).toISOString(), enddt: new Date(e.endTime).toISOString(), body: e.url,
    };
    return `https://outlook.live.com/calendar/0/deeplink/compose?${query(params)}`;
}

/** API path of the one-event `.ics` (E1, `GET /events/:id/ics`). */
export function icsPath(eventId: number): string {
    return `/events/${eventId}/ics`;
}

/**
 * Fetch the `.ics` with the session (a private event needs the auth header a
 * plain `<a href>` would not send), then save it as `<title>.ics`.
 */
export async function downloadIcs(e: Pick<AddToCalendarEvent, 'id' | 'title'>): Promise<void> {
    const res = await fetchWithAuth(icsPath(e.id), {});
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const href = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = href;
    a.download = `${e.title.replace(/[^\w -]+/g, '').trim() || 'event'}.ics`;
    a.click();
    URL.revokeObjectURL(href);
}
