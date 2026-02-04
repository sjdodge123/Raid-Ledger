import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/use-auth';
import { CreateEventForm } from '../components/events/create-event-form';

/**
 * Page for creating a new event.
 * Protected - redirects to events list if not authenticated.
 */
export function CreateEventPage() {
    const { isAuthenticated, isLoading } = useAuth();

    // Show loading state while checking auth
    if (isLoading) {
        return (
            <div className="min-h-[50vh] flex items-center justify-center">
                <div className="w-8 h-8 border-4 border-slate-500 border-t-emerald-500 rounded-full animate-spin" />
            </div>
        );
    }

    // Redirect if not authenticated
    if (!isAuthenticated) {
        return <Navigate to="/events" replace />;
    }

    return (
        <div className="py-8 px-4">
            <div className="max-w-2xl mx-auto">
                {/* Page Header */}
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-white mb-2">Create Event</h1>
                    <p className="text-slate-400">
                        Set up a new gaming session for your community
                    </p>
                </div>

                {/* Form Card */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                    <CreateEventForm />
                </div>
            </div>
        </div>
    );
}
