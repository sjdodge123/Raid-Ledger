import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useEvent, useEventRoster } from '../hooks/use-events';
import { useSignup, useCancelSignup } from '../hooks/use-signups';
import { useAuth } from '../hooks/use-auth';
import { RosterList } from '../components/events/roster-list';
import { SignupConfirmationModal } from '../components/events/signup-confirmation-modal';

/**
 * Format date/time in user's local timezone
 */
function formatDateTime(dateString: string): string {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
    }).format(date);
}

/**
 * Format event duration
 */
function formatDuration(start: string, end: string): string {
    const startDate = new Date(start);
    const endDate = new Date(end);
    const diffMs = endDate.getTime() - startDate.getTime();
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

    if (hours === 0) return `${minutes}m`;
    if (minutes === 0) return `${hours}h`;
    return `${hours}h ${minutes}m`;
}

/**
 * Event Detail Page - shows full event info, roster, and signup actions
 */
export function EventDetailPage() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const eventId = Number(id);

    const { user, isAuthenticated, isLoading: authLoading } = useAuth();
    const { data: event, isLoading: eventLoading, error: eventError } = useEvent(eventId);
    const { data: roster, isLoading: rosterLoading } = useEventRoster(eventId);

    const signup = useSignup(eventId);
    const cancelSignup = useCancelSignup(eventId);

    // Modal state for character confirmation (ROK-131 AC-2)
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [pendingSignupId, setPendingSignupId] = useState<number | null>(null);

    // Check if current user is signed up
    const userSignup = roster?.signups.find(s => s.user.id === user?.id);
    const isSignedUp = !!userSignup;
    const needsConfirmation = userSignup?.confirmationStatus === 'pending';

    const handleSignup = async () => {
        try {
            const result = await signup.mutateAsync(undefined);
            toast.success('Successfully signed up!', {
                description: 'Now confirm which character you\'re bringing.',
            });
            // Open character confirmation modal (AC-2)
            if (event?.game?.id) {
                setPendingSignupId(result.id);
                setShowConfirmModal(true);
            }
        } catch (err) {
            toast.error('Failed to sign up', {
                description: err instanceof Error ? err.message : 'Please try again.',
            });
        }
    };

    const handleCancel = async () => {
        try {
            await cancelSignup.mutateAsync();
            toast.success('Signup cancelled', {
                description: 'You have been removed from the roster.',
            });
        } catch (err) {
            toast.error('Failed to cancel signup', {
                description: err instanceof Error ? err.message : 'Please try again.',
            });
        }
    };

    if (eventError) {
        return (
            <div className="min-h-screen bg-slate-950 flex items-center justify-center">
                <div className="text-center">
                    <h2 className="text-xl font-semibold text-red-400 mb-2">
                        Event not found
                    </h2>
                    <p className="text-slate-400 mb-4">{eventError.message}</p>
                    <button
                        onClick={() => navigate('/events')}
                        className="px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition-colors"
                    >
                        Back to Events
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-950 py-8 px-4">
            <div className="max-w-4xl mx-auto">
                {/* Back button */}
                <button
                    onClick={() => navigate('/events')}
                    className="mb-6 text-slate-400 hover:text-white transition-colors flex items-center gap-2"
                >
                    ← Back to Events
                </button>

                {eventLoading ? (
                    <EventDetailSkeleton />
                ) : event ? (
                    <div className="grid md:grid-cols-3 gap-8">
                        {/* Main Content */}
                        <div className="md:col-span-2 space-y-6">
                            {/* Event Header */}
                            <div className="bg-slate-900 rounded-lg border border-slate-700 overflow-hidden">
                                {event.game?.coverUrl && (
                                    <div className="h-48 relative overflow-hidden">
                                        <img
                                            src={event.game.coverUrl}
                                            alt={event.game.name}
                                            className="w-full h-full object-cover"
                                            onError={(e) => {
                                                e.currentTarget.style.display = 'none';
                                            }}
                                        />
                                        <div className="absolute inset-0 bg-gradient-to-t from-slate-900 to-transparent" />
                                        <div className="absolute bottom-4 left-4">
                                            <span className="px-3 py-1 bg-slate-800/90 rounded-full text-sm text-slate-300">
                                                {event.game.name}
                                            </span>
                                        </div>
                                    </div>
                                )}

                                <div className="p-6">
                                    <h1 className="text-2xl font-bold text-white mb-4">
                                        {event.title}
                                    </h1>

                                    {/* Time Info */}
                                    <div className="space-y-2 mb-6">
                                        <div className="flex items-center gap-2 text-slate-300">
                                            <span className="text-emerald-400">📅</span>
                                            {formatDateTime(event.startTime)}
                                        </div>
                                        <div className="flex items-center gap-2 text-slate-400">
                                            <span>⏱️</span>
                                            Duration: {formatDuration(event.startTime, event.endTime)}
                                        </div>
                                    </div>

                                    {/* Description */}
                                    {event.description && (
                                        <div className="prose prose-invert max-w-none">
                                            <p className="text-slate-300">{event.description}</p>
                                        </div>
                                    )}

                                    {/* Creator */}
                                    <div className="mt-6 pt-6 border-t border-slate-700 flex items-center gap-3">
                                        <img
                                            src={event.creator.avatar || '/default-avatar.png'}
                                            alt={event.creator.username}
                                            className="w-8 h-8 rounded-full"
                                            onError={(e) => {
                                                e.currentTarget.src = '/default-avatar.png';
                                            }}
                                        />
                                        <div>
                                            <p className="text-sm text-slate-400">Created by</p>
                                            <p className="text-white">{event.creator.username}</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Sidebar - Roster & Actions */}
                        <div className="space-y-6">
                            {/* Signup Action */}
                            <div className="bg-slate-900 rounded-lg border border-slate-700 p-6">
                                <h2 className="text-lg font-semibold text-white mb-4">
                                    Join this Event
                                </h2>

                                {authLoading ? (
                                    <div className="h-12 bg-slate-800 rounded-lg animate-pulse" />
                                ) : isAuthenticated ? (
                                    isSignedUp ? (
                                        <div className="space-y-2">
                                            {/* Confirm character button for pending signups (ROK-131 AC-2) */}
                                            {needsConfirmation && event?.game?.id && userSignup && (
                                                <button
                                                    onClick={() => {
                                                        setPendingSignupId(userSignup.id);
                                                        setShowConfirmModal(true);
                                                    }}
                                                    className="w-full py-3 px-4 bg-amber-600 text-white rounded-lg hover:bg-amber-500 transition-colors min-h-[44px] flex items-center justify-center gap-2"
                                                >
                                                    <span>❓</span>
                                                    <span>Confirm Character</span>
                                                </button>
                                            )}
                                            <button
                                                onClick={handleCancel}
                                                disabled={cancelSignup.isPending}
                                                className="w-full py-3 px-4 bg-red-900/50 border border-red-700 text-red-400 rounded-lg hover:bg-red-900/70 disabled:opacity-50 transition-colors min-h-[44px]"
                                            >
                                                {cancelSignup.isPending ? 'Canceling...' : 'Cancel Signup'}
                                            </button>
                                        </div>
                                    ) : (
                                        <button
                                            onClick={handleSignup}
                                            disabled={signup.isPending}
                                            className="w-full py-3 px-4 bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 disabled:opacity-50 transition-colors min-h-[44px]"
                                        >
                                            {signup.isPending ? 'Signing up...' : 'Sign Up'}
                                        </button>
                                    )
                                ) : (
                                    <a
                                        href={`${import.meta.env.VITE_API_URL || 'http://localhost:3000'}/auth/discord`}
                                        className="block w-full py-3 px-4 bg-indigo-600 text-white text-center rounded-lg hover:bg-indigo-500 transition-colors min-h-[44px]"
                                    >
                                        Login with Discord
                                    </a>
                                )}
                            </div>

                            {/* Roster */}
                            <div className="bg-slate-900 rounded-lg border border-slate-700 p-6">
                                <h2 className="text-lg font-semibold text-white mb-4">
                                    Roster ({roster?.count ?? 0})
                                </h2>
                                <RosterList
                                    signups={roster?.signups ?? []}
                                    isLoading={rosterLoading}
                                />
                            </div>
                        </div>
                    </div>
                ) : null}

                {/* Character Confirmation Modal (ROK-131 AC-2) */}
                {/* 
                  Note: Events use game.id (number) from games table,
                  but characters use gameId (UUID) from game_registry.
                  For now, we pass undefined to load all characters.
                  TODO: Add proper game mapping once data model is unified.
                */}
                {pendingSignupId && (
                    <SignupConfirmationModal
                        isOpen={showConfirmModal}
                        onClose={() => {
                            setShowConfirmModal(false);
                            setPendingSignupId(null);
                        }}
                        eventId={eventId}
                        signupId={pendingSignupId}
                        gameId={undefined}
                    />
                )}
            </div>
        </div>
    );
}

/**
 * Skeleton loader for event detail page
 */
function EventDetailSkeleton() {
    return (
        <div className="grid md:grid-cols-3 gap-8 animate-pulse">
            <div className="md:col-span-2">
                <div className="bg-slate-900 rounded-lg border border-slate-700 overflow-hidden">
                    <div className="h-48 bg-slate-800" />
                    <div className="p-6 space-y-4">
                        <div className="h-8 bg-slate-800 rounded w-3/4" />
                        <div className="h-4 bg-slate-800 rounded w-1/2" />
                        <div className="h-4 bg-slate-800 rounded w-1/3" />
                        <div className="h-24 bg-slate-800 rounded" />
                    </div>
                </div>
            </div>
            <div className="space-y-6">
                <div className="bg-slate-900 rounded-lg border border-slate-700 p-6">
                    <div className="h-6 bg-slate-800 rounded w-1/2 mb-4" />
                    <div className="h-12 bg-slate-800 rounded" />
                </div>
            </div>
        </div>
    );
}
