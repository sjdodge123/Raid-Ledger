/**
 * ROK-2226 — text formatting for event threads in the hub Forum (date pill,
 * time range, lock reason line). Kept out of `forum-event-header.tsx` so that
 * file exports components only (react-refresh/only-export-components).
 */
import type { HubForumLock, HubForumLockReason } from '@raid-ledger/contract';

const LOCK_REASON_COPY: Record<HubForumLockReason, string> = {
    'event-ended': 'Closed 24 h after the event ended',
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

/** "19:00–22:00" in the viewer's timezone. */
export function eventTimeRange(startIso: string, endIso: string): string {
    const time = (iso: string): string =>
        new Date(iso).toLocaleTimeString(undefined, {
            hour: '2-digit',
            minute: '2-digit',
        });
    return `${time(startIso)}–${time(endIso)}`;
}

/** "Read-only since Mon 24 Nov · Closed 24 h after the event ended". */
export function lockLine(lock: HubForumLock): string {
    return `Read-only since ${eventShortDate(lock.at)} · ${lockReasonCopy(lock.reason)}`;
}
