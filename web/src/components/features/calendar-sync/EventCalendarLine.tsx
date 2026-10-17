/**
 * S3 calendar line on the event page (ROK-1596 W2), under the sign-up block.
 * Synced → "On your Google Calendar · Open"; pending / failed → a status line;
 * no copy (no write connection, or the copy was undone) → "Add to calendar".
 * Shown only to a signed-up viewer.
 */
import { useEventCalendarCopy } from '../../../hooks/use-calendar-sync';
import type { EventCalendarCopy } from '@raid-ledger/contract';
import { AddToCalendarMenu } from './AddToCalendarMenu';
import { EVENT_CALENDAR_COPY as C, PROVIDER_CALENDAR_NAME } from './calendar-sync.copy';
import type { AddToCalendarEvent } from './add-to-calendar.helpers';

interface EventCalendarLineProps {
    event: Omit<AddToCalendarEvent, 'url'>;
    isSignedUp: boolean;
}

function CopyStatus({ copy }: { copy: EventCalendarCopy }) {
    const calendar = PROVIDER_CALENDAR_NAME[copy.provider];
    if (copy.state === 'pending') return <span className="text-muted">{C.pending(calendar)}</span>;
    if (copy.state === 'failed') return <span className="text-warning">{C.failed(calendar)}</span>;
    return (
        <>
            <span className="text-success">{C.on(calendar)}</span>
            {copy.openUrl && (
                <a href={copy.openUrl} target="_blank" rel="noopener noreferrer"
                    className="ml-auto inline-flex min-h-11 min-w-11 items-center justify-center font-medium text-foreground underline underline-offset-2 hover:text-success">
                    {C.open}
                </a>
            )}
        </>
    );
}

export function EventCalendarLine({ event, isSignedUp }: EventCalendarLineProps) {
    const { data: copy, isLoading } = useEventCalendarCopy(event.id, isSignedUp);
    if (!isSignedUp || isLoading) return null;
    const showCopy = copy && copy.state !== 'suppressed';
    return (
        <div data-testid="event-calendar-line" className="mb-4 flex min-h-11 items-center gap-2 border-t border-edge pt-3 text-sm">
            {showCopy
                ? <CopyStatus copy={copy} />
                : <AddToCalendarMenu event={{ ...event, url: `${window.location.origin}/events/${event.id}` }} />}
        </div>
    );
}
