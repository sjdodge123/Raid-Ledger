/**
 * ROK-2226 — event threads in the hub Forum. `ForumEventHeader` sits above an
 * event thread's root post: the event's date and time (viewer timezone), a
 * Cancelled pill, "View event →" back to `/events/<id>`, and the read-only
 * line once the thread locks. `ForumEventPills` is the list/Latest row badge
 * pair ("Event · Sat 22 Nov", "Closed"). Tokens and the shared `Pill` only.
 * Text formatting lives in `forum-event-format.ts`.
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { CalendarIcon, LockClosedIcon, UsersIcon } from '@heroicons/react/24/outline';
import type { HubForumLock, HubForumThreadEvent } from '@raid-ledger/contract';
import { FOCUS_RING } from '../../ui/form-classes';
import { Pill } from '../hub-bits';
import { eventShortDate, eventTimeRange, lockLine, signupLabel } from './forum-event-format';

/**
 * The row badges of an event thread: "Event · <date>" and, once locked,
 * "Closed" — which still shows after the event was deleted (event null).
 */
export function ForumEventPills({
    event,
    lock,
    withDate = true,
}: {
    event: HubForumThreadEvent | null | undefined;
    lock: HubForumLock | null | undefined;
    /** The thread view's heading shows "Event" alone — the title already carries the date (ROK-2229). */
    withDate?: boolean;
}): JSX.Element | null {
    if (event == null && lock == null) return null;
    return (
        <>
            {event != null && (
                <Pill>
                    <CalendarIcon className="h-3 w-3" aria-hidden="true" />
                    {withDate ? `Event · ${eventShortDate(event.startTime)}` : 'Event'}
                </Pill>
            )}
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

/** "18 / 40 signed up" with the people icon (ROK-2229); nothing when the payload has no count. */
function SignupFact({ event }: { event: HubForumThreadEvent }): JSX.Element | null {
    const label = signupLabel(event);
    if (label === null) return null;
    return (
        <span data-testid="forum-event-signups" className="inline-flex items-center gap-1.5">
            <UsersIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
            {label}
        </span>
    );
}

/** Date, time range, signups, Cancelled pill and "View event →" for an event thread. */
function ForumEventFacts({
    event,
}: {
    event: HubForumThreadEvent;
}): JSX.Element {
    return (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-edge bg-surface px-3.5 py-3">
            <span className="inline-flex flex-1 flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-secondary">
                <span className="inline-flex items-center gap-1.5">
                    <CalendarIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {eventShortDate(event.startTime)} ·{' '}
                    {eventTimeRange(event.startTime, event.endTime)}
                </span>
                <SignupFact event={event} />
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
            <ForumEventFacts event={event} />
            {lock != null && <ForumLockBar lock={lock} />}
        </div>
    );
}
