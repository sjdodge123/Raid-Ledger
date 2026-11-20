/**
 * ROK-2226 — text formatting for event threads in the hub Forum (date pill,
 * time range, lock reason line). Kept out of `forum-event-header.tsx` so that
 * file exports components only (react-refresh/only-export-components).
 */
import type { HubForumLock, HubForumLockReason, HubForumThreadEvent } from '@raid-ledger/contract';

/** Hours an event thread stays writable after the event ends (ROK-2272: was 24). */
export const EVENT_THREAD_CLOSE_HOURS = 1;

/** The `event-ended` lock line — the one place the close window is spelled out. */
export const EVENT_ENDED_LOCK_COPY = `Closed ${EVENT_THREAD_CLOSE_HOURS} h after the event ended`;

const LOCK_REASON_COPY: Record<HubForumLockReason, string> = {
    'event-ended': EVENT_ENDED_LOCK_COPY,
    'event-detached': 'This event moved to another hub',
    'event-deleted': 'This event was deleted',
};

/** Why an event thread is read-only, as one sentence. */
export function lockReasonCopy(reason: HubForumLockReason): string {
    return LOCK_REASON_COPY[reason];
}

/** "Sat 22 Nov" in the viewer's timezone. */
export function eventShortDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
    });
}

/** "19:00" in the viewer's timezone. */
function eventTime(iso: string): string {
    return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** "19:00–22:00" in the viewer's timezone. */
export function eventTimeRange(startIso: string, endIso: string): string {
    return `${eventTime(startIso)}–${eventTime(endIso)}`;
}

/** "Sat 22 Nov 19:00" in the viewer's timezone (the event root's body, ROK-2229). */
export function eventStartLabel(iso: string): string {
    return `${eventShortDate(iso)} ${eventTime(iso)}`;
}

/**
 * ROK-2229 — the title a thread displays: an event thread reads
 * "<title> — <short date>" (viewer timezone); the stored title is unchanged.
 */
export function forumThreadTitle(thread: { title: string; event?: HubForumThreadEvent | null | undefined }): string {
    const { event } = thread;
    return event == null ? thread.title : `${thread.title} — ${eventShortDate(event.startTime)}`;
}

/** ROK-2229 — "18 / 40 signed up" ("18 signed up" uncapped); null when the payload has no count. */
export function signupLabel(event: HubForumThreadEvent): string | null {
    if (event.signupCount === undefined) return null;
    const max = event.maxAttendees ?? null;
    return max === null ? `${event.signupCount} signed up` : `${event.signupCount} / ${max} signed up`;
}

/** "Read-only since Mon 24 Nov · Closed 1 h after the event ended". */
export function lockLine(lock: HubForumLock): string {
    return `Read-only since ${eventShortDate(lock.at)} · ${lockReasonCopy(lock.reason)}`;
}
