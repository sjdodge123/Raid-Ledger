/**
 * ROK-2226 — event threads in the hub Forum. `ForumEventHeader` sits above an
 * event thread's root post: the event's date and time (viewer timezone), a
 * Cancelled pill, "View event →" back to `/events/<id>`, and the read-only
 * line once the thread locks. `ForumEventPills` is the list/Latest row badge
 * pair ("Event · Sat 22 Nov", "Closed"). Tokens and the shared `Pill` only.
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { CalendarIcon, LockClosedIcon } from '@heroicons/react/24/outline';
import type {
    HubForumLock,
    HubForumLockReason,
    HubForumThreadEvent,
} from '@raid-ledger/contract';
import { FOCUS_RING } from '../../ui/form-classes';
import { Pill } from '../hub-bits';

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

/** The row badges of an event thread: "Event · <date>" and, once locked, "Closed". */
export function ForumEventPills({
    event,
    lock,
}: {
    event: HubForumThreadEvent | null | undefined;
    lock: HubForumLock | null | undefined;
}): JSX.Element | null {
    if (event == null) return null;
    return (
        <>
            <Pill>
                <CalendarIcon className="h-3 w-3" aria-hidden="true" />
                Event · {eventShortDate(event.startTime)}
            </Pill>
            {lock != null && (
                <Pill>
                    <LockClosedIcon className="h-3 w-3" aria-hidden="true" />
                    Closed
                </Pill>
            )}
        </>
    );
}

/** The locked-thread line (§4.7 quiet banner), shared with the event page card. */
export function ForumLockBar({ lock }: { lock: HubForumLock }): JSX.Element {
    return (
        <p
            role="status"
            data-testid="forum-lock-bar"
            className="flex items-center gap-2 rounded-lg border border-edge bg-surface px-3 py-2.5 text-sm text-muted"
        >
            <LockClosedIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
                <span className="font-semibold text-foreground">
                    Discussion closed
                </span>{' '}
                · {lockLine(lock)}
            </span>
        </p>
    );
}

/** The event facts box above an event thread (see file docstring). */
export function ForumEventHeader({
    event,
    lock,
}: {
    event: HubForumThreadEvent;
    lock: HubForumLock | null | undefined;
}): JSX.Element {
    return (
        <div className="flex flex-col gap-2" data-testid="forum-event-header">
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-edge bg-surface px-3.5 py-3">
                <span className="inline-flex flex-1 items-center gap-1.5 text-sm text-secondary">
                    <CalendarIcon
                        className="h-4 w-4 shrink-0"
                        aria-hidden="true"
                    />
                    {eventShortDate(event.startTime)} ·{' '}
                    {eventTimeRange(event.startTime, event.endTime)}
                    {event.cancelled && <Pill tone="warning">Cancelled</Pill>}
                </span>
                <Link
                    to={`/events/${event.id}`}
                    data-testid="forum-event-link"
                    className={`rounded-sm text-sm font-medium text-success underline-offset-2 hover:underline ${FOCUS_RING}`}
                >
                    View event →
                </Link>
            </div>
            {lock != null && <ForumLockBar lock={lock} />}
        </div>
    );
}
