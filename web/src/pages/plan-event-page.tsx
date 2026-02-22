import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/use-auth';
import { PlanEventForm } from '../components/events/plan-event-form';

/**
 * Page for planning an event via community poll (ROK-392).
 * Protected - redirects to events list if not authenticated.
 */
export function PlanEventPage() {
    const { isAuthenticated, isLoading } = useAuth();
    const navigate = useNavigate();

    if (isLoading) {
        return (
            <div className="min-h-[50vh] flex items-center justify-center">
                <div className="w-8 h-8 border-4 border-dim border-t-violet-500 rounded-full animate-spin" />
            </div>
        );
    }

    if (!isAuthenticated) {
        return <Navigate to="/events" replace />;
    }

    return (
        <div className="py-8 px-4">
            <div className="max-w-2xl mx-auto">
                {/* Back Button */}
                <button
                    type="button"
                    onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/events'))}
                    className="flex items-center gap-2 text-muted hover:text-foreground transition-colors mb-6"
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                    Back
                </button>

                {/* Page Header */}
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-foreground mb-2">Plan Event</h1>
                    <p className="text-muted">
                        Poll your community to find the best time for a gaming session
                    </p>
                </div>

                {/* Form Card */}
                <div className="bg-surface border border-edge-subtle rounded-xl p-6">
                    <PlanEventForm />
                </div>
            </div>
        </div>
    );
}
