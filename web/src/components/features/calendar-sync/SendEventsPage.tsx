/**
 * K5 "Send my events" (ROK-1596 W1b) — its own phone page with a back crumb
 * to Calendars, reached from K2's "Add events I sign up for" row. The body is
 * W1's `SendEventsSettings` without its card heading (the page title stands in).
 * No tentative toggle (spec AC11 ruling — tentative always syncs).
 */
import type { JSX } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronLeftIcon } from '@heroicons/react/24/outline';
import { useCalendarsOverview } from '../../../hooks/use-calendar-sync';
import { CALENDARS_PATH } from '../../profile/profile-nav-data';
import { ProviderTile } from './CalendarProviderRow';
import { CALENDAR_ROW } from './calendar-sync-row';
import { SendEventsSettings } from './SendEventsSettings';
import { CALENDARS_COPY as C, SEND_EVENTS_COPY as S, connectionStatusLine } from './calendar-sync.copy';

function BackCrumb(): JSX.Element {
    return (
        <Link to={CALENDARS_PATH} data-testid="send-events-back"
            className="-ml-2 inline-flex min-h-[44px] items-center gap-1 px-2 text-sm text-muted transition-colors hover:text-foreground">
            <ChevronLeftIcon className="h-5 w-5" aria-hidden="true" />
            {S.back}
        </Link>
    );
}

function SendEventsBody({ connectionId }: { connectionId: string | undefined }): JSX.Element | null {
    const { data, isLoading } = useCalendarsOverview();
    if (isLoading) return null;
    const connection = data?.connections.find((c) => String(c.id) === connectionId);
    if (!connection) return <p className="text-sm text-muted" data-testid="send-events-not-found">{S.notFound}</p>;
    return (
        <>
            <div className={CALENDAR_ROW} data-testid="send-events-provider">
                <ProviderTile label={C.google.tile} />
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">{C.google.name}</p>
                    <p className="truncate text-xs text-muted">{connectionStatusLine(connection)}</p>
                </div>
            </div>
            <SendEventsSettings connection={connection} asPage />
        </>
    );
}

export function SendEventsPage(): JSX.Element {
    const { connectionId } = useParams<{ connectionId: string }>();
    return (
        <div className="space-y-4 pb-8" data-testid="send-events-page">
            <BackCrumb />
            <h2 className="text-xl font-semibold text-foreground">{S.pageTitle}</h2>
            <SendEventsBody connectionId={connectionId} />
        </div>
    );
}
