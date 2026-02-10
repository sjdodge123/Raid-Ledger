import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/use-auth';

/**
 * Empty state component for events page when no events exist
 */
export function EventsEmptyState() {
    const { isAuthenticated } = useAuth();

    return (
        <div className="col-span-full flex flex-col items-center justify-center py-16 px-4">
            {/* Illustration */}
            <div className="w-32 h-32 mb-6 relative">
                <svg
                    viewBox="0 0 120 120"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    className="w-full h-full"
                >
                    {/* Calendar base */}
                    <rect
                        x="20"
                        y="30"
                        width="80"
                        height="70"
                        rx="8"
                        className="fill-slate-800 stroke-slate-600"
                        strokeWidth="2"
                    />
                    {/* Calendar header */}
                    <rect
                        x="20"
                        y="30"
                        width="80"
                        height="20"
                        rx="8"
                        className="fill-emerald-600"
                    />
                    <rect
                        x="20"
                        y="42"
                        width="80"
                        height="8"
                        className="fill-emerald-600"
                    />
                    {/* Calendar rings */}
                    <rect x="35" y="22" width="6" height="16" rx="3" className="fill-slate-500" />
                    <rect x="79" y="22" width="6" height="16" rx="3" className="fill-slate-500" />
                    {/* Calendar dots - empty days */}
                    <circle cx="40" cy="65" r="4" className="fill-slate-700" />
                    <circle cx="60" cy="65" r="4" className="fill-slate-700" />
                    <circle cx="80" cy="65" r="4" className="fill-slate-700" />
                    <circle cx="40" cy="85" r="4" className="fill-slate-700" />
                    <circle cx="60" cy="85" r="4" className="fill-slate-700" />
                    <circle cx="80" cy="85" r="4" className="fill-slate-700" />
                    {/* Sparkles */}
                    <path
                        d="M15 45 L18 50 L15 55 L12 50 Z"
                        className="fill-yellow-400"
                    />
                    <path
                        d="M105 55 L108 60 L105 65 L102 60 Z"
                        className="fill-yellow-400"
                    />
                    <circle cx="108" cy="35" r="2" className="fill-emerald-400" />
                    <circle cx="12" cy="70" r="2" className="fill-emerald-400" />
                </svg>
            </div>

            {/* Message */}
            <h3 className="text-xl font-semibold text-foreground mb-2">
                No events yet
            </h3>
            <p className="text-muted text-center max-w-sm mb-6">
                Be the first to create an event and bring your gaming community together!
            </p>

            {/* CTA Button */}
            {isAuthenticated ? (
                <Link
                    to="/events/new"
                    className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-foreground font-semibold rounded-lg transition-colors shadow-lg shadow-emerald-600/25"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Create Your First Event
                </Link>
            ) : (
                <p className="text-sm text-dim">
                    Sign in to create events
                </p>
            )}
        </div>
    );
}
