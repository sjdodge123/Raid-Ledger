/**
 * ROK-1780: Calendars moved from Profile → Gaming → Calendars onto My
 * Integrations. Old links and bookmarks redirect, KEEPING the query string:
 * an OAuth callback that still lands on the old path carries
 * `?connected=google` / `?error=<code>`, which `useCalendarOAuthFeedback` reads.
 */
import type { JSX } from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import { CALENDARS_PATH, SEND_EVENTS_BASE } from './calendar-sync-row';

/** `/profile/gaming/calendars?…` → `/profile/integrations?…`. */
export function LegacyCalendarsRedirect(): JSX.Element {
    const { search, hash } = useLocation();
    return <Navigate to={{ pathname: CALENDARS_PATH, search, hash }} replace />;
}

/** `/profile/gaming/calendars/send/:id` → `/profile/integrations/calendars/send/:id`. */
export function LegacySendEventsRedirect(): JSX.Element {
    const { connectionId } = useParams();
    const { search } = useLocation();
    if (!connectionId) return <Navigate to={{ pathname: CALENDARS_PATH, search }} replace />;
    return <Navigate to={{ pathname: `${SEND_EVENTS_BASE}/${encodeURIComponent(connectionId)}`, search }} replace />;
}
