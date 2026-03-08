import { useParams, useNavigate, useSearchParams, Navigate } from 'react-router-dom';
import { useAuth, isOperatorOrAdmin } from '../hooks/use-auth';
import { useEvent } from '../hooks/use-events';
import { CreateEventForm } from '../components/events/create-event-form';
import type { SeriesScope } from '@raid-ledger/contract';

/**
 * Page for editing an existing event.
 * Protected - redirects if not authenticated or not creator/admin.
 */
const VALID_SCOPES = new Set<string>(['this', 'this_and_following', 'all']);

export function EditEventPage() {
    const { id } = useParams<{ id: string }>();
    const eventId = Number(id);
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const scopeParam = searchParams.get('seriesScope');
    const seriesScope = scopeParam && VALID_SCOPES.has(scopeParam) ? (scopeParam as SeriesScope) : undefined;
    const { user, isAuthenticated, isLoading: authLoading } = useAuth();
    const { data: event, isLoading: eventLoading } = useEvent(eventId);

    if (authLoading || eventLoading) return <EditPageSpinner />;
    if (!isAuthenticated) return <Navigate to={`/events/${eventId}`} replace />;
    if (event && user && event.creator.id !== user.id && !isOperatorOrAdmin(user)) return <Navigate to={`/events/${eventId}`} replace />;
    if (!event) return <div className="min-h-[50vh] flex items-center justify-center text-muted">Event not found</div>;

    return (
        <div className="py-8 px-4">
            <div className="max-w-2xl mx-auto">
                <EditBackButton onClick={() => navigate(`/events/${eventId}`)} />
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-foreground mb-2">Edit Event</h1>
                    <p className="text-muted">Update the details for this event</p>
                </div>
                {seriesScope && seriesScope !== 'this' && <SeriesScopeBanner scope={seriesScope} />}
                <div className="bg-surface border border-edge-subtle rounded-xl p-6">
                    <CreateEventForm event={event} seriesScope={seriesScope} />
                </div>
            </div>
        </div>
    );
}

function EditPageSpinner() {
    return (
        <div className="min-h-[50vh] flex items-center justify-center">
            <div className="w-8 h-8 border-4 border-dim border-t-emerald-500 rounded-full animate-spin" />
        </div>
    );
}

const SCOPE_LABELS: Record<string, string> = {
    this_and_following: 'Editing this event and all following events in the series.',
    all: 'Editing all events in the series.',
};

function SeriesScopeBanner({ scope }: { scope: SeriesScope }) {
    return (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3 mb-4" data-testid="series-scope-banner">
            <p className="text-sm text-amber-300 font-medium">{SCOPE_LABELS[scope] ?? ''}</p>
        </div>
    );
}

function EditBackButton({ onClick }: { onClick: () => void }) {
    return (
        <button type="button" onClick={onClick} className="flex items-center gap-2 text-muted hover:text-foreground transition-colors mb-6">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Event
        </button>
    );
}
