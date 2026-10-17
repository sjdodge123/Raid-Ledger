import { useMemo } from 'react';
import { useNavigate, Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/use-auth';
import { useGameRegistry } from '../hooks/use-game-registry';
import { useEvent } from '../hooks/use-events';
import { CreateEventForm } from '../components/events/create-event-form';

/**
 * Page for creating a new event.
 * Protected - redirects to events list if not authenticated.
 */
export function CreateEventPage() {
    const { isAuthenticated, isLoading } = useAuth();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { games: registryGames, isLoading: registryLoading } = useGameRegistry();

    const initialGame = useMemo(() => {
        const rawId = searchParams.get('gameId');
        if (!rawId) return null;
        const id = parseInt(rawId, 10);
        return registryGames.find((g) => g.id === id) ?? null;
    }, [searchParams, registryGames]);

    const initialStartTime = searchParams.get('startTime');
    const schedulingMatchId = searchParams.get('matchId') ? parseInt(searchParams.get('matchId')!, 10) : null;
    // ROK-1371: post-event follow-up deep-link — links the new event back to the
    // ended event so the server fans out quick-sign-up DMs to its attendees.
    const followupForEventId = searchParams.get('followupForEventId') ? parseInt(searchParams.get('followupForEventId')!, 10) : null;
    // Prefill source for both follow-up paths: the button deep-link sets it
    // alongside followupForEventId, the poll lock-in resolves it from the
    // match. Client-side only — never submitted.
    const copyFromEventId = searchParams.get('copyFromEventId') ? parseInt(searchParams.get('copyFromEventId')!, 10) : null;
    const { data: copyFromEvent, isLoading: copyLoading, isError: copyFailed } = useEvent(copyFromEventId ?? 0);

    const hasGameParam = !!searchParams.get('gameId');
    // The form seeds its state once, in a useState initializer — render it only
    // after the prefill source resolves, or it opens blank and never refills.
    // A failed fetch falls through to a blank form rather than blocking create.
    if (isLoading || (hasGameParam && registryLoading) || (copyFromEventId && copyLoading && !copyFailed)) return <PageSpinner />;
    if (!isAuthenticated) return <Navigate to="/events" replace />;

    return (
        <div className="py-8 px-4">
            <div className="max-w-2xl mx-auto">
                <BackButton onClick={() => navigate(-1)} label="Back" />
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-foreground mb-2">Create Event</h1>
                    <p className="text-muted">
                        {copyFromEvent
                            ? `Prefilled from "${copyFromEvent.title}" — pick a time and adjust anything you like`
                            : 'Set up a new gaming session for your community'}
                    </p>
                </div>
                <div className="bg-surface border border-edge-subtle rounded-xl p-6">
                    <CreateEventForm initialGame={initialGame} initialStartTime={initialStartTime} schedulingMatchId={schedulingMatchId} followupForEventId={followupForEventId} copyFromEvent={copyFromEvent ?? null} />
                </div>
            </div>
        </div>
    );
}

function PageSpinner() {
    return (
        <div className="min-h-[50vh] flex items-center justify-center">
            <div className="w-8 h-8 border-4 border-dim border-t-emerald-500 rounded-full animate-spin" />
        </div>
    );
}

function BackButton({ onClick, label }: { onClick: () => void; label: string }) {
    return (
        <button type="button" onClick={onClick} className="flex items-center gap-2 text-muted hover:text-foreground transition-colors mb-6">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            {label}
        </button>
    );
}
