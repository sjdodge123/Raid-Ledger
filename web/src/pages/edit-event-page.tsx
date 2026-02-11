import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/use-auth';
import { useEvent } from '../hooks/use-events';
import { CreateEventForm } from '../components/events/create-event-form';

/**
 * Page for editing an existing event.
 * Protected - redirects if not authenticated or not creator/admin.
 */
export function EditEventPage() {
    const { id } = useParams<{ id: string }>();
    const eventId = Number(id);
    const navigate = useNavigate();
    const { user, isAuthenticated, isLoading: authLoading } = useAuth();
    const { data: event, isLoading: eventLoading } = useEvent(eventId);

    // Show loading state
    if (authLoading || eventLoading) {
        return (
            <div className="min-h-[50vh] flex items-center justify-center">
                <div className="w-8 h-8 border-4 border-dim border-t-emerald-500 rounded-full animate-spin" />
            </div>
        );
    }

    // Redirect if not authenticated
    if (!isAuthenticated) {
        return <Navigate to={`/events/${eventId}`} replace />;
    }

    // Redirect if not creator or admin
    if (event && user && event.creator.id !== user.id && !user.isAdmin) {
        return <Navigate to={`/events/${eventId}`} replace />;
    }

    if (!event) {
        return (
            <div className="min-h-[50vh] flex items-center justify-center text-muted">
                Event not found
            </div>
        );
    }

    return (
        <div className="py-8 px-4">
            <div className="max-w-2xl mx-auto">
                {/* Back Button */}
                <button
                    type="button"
                    onClick={() => navigate(`/events/${eventId}`)}
                    className="flex items-center gap-2 text-muted hover:text-foreground transition-colors mb-6"
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                    Back to Event
                </button>

                {/* Page Header */}
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-foreground mb-2">Edit Event</h1>
                    <p className="text-muted">
                        Update the details for this event
                    </p>
                </div>

                {/* Form Card */}
                <div className="bg-surface border border-edge-subtle rounded-xl p-6">
                    <CreateEventForm event={event} />
                </div>
            </div>
        </div>
    );
}
