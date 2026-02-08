import { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { toast } from 'sonner';
import { useEvent, useEventRoster } from '../hooks/use-events';
import { useSignup, useCancelSignup } from '../hooks/use-signups';
import { useAuth } from '../hooks/use-auth';
import { useRoster, useUpdateRoster, buildRosterUpdate } from '../hooks/use-roster';
import type { RosterAssignmentResponse, RosterRole } from '@raid-ledger/contract';
import { EventBanner } from '../components/events/EventBanner';
import { SignupConfirmationModal } from '../components/events/signup-confirmation-modal';
import { RosterBuilder } from '../components/roster';
import { UserLink } from '../components/common/UserLink';
import { isMMOSlotConfig } from '../utils/game-utils';
import './event-detail-page.css';

/**
 * Event Detail Page - ROK-184 Redesign
 * 
 * Layout (Desktop):
 * - Full-width EventBanner at top
 * - Full-width Slot Grid (primary focus, above fold)
 * - Roster List below (grouped by status)
 * - Action buttons integrated
 * 
 * Removed: Team Availability (moved per ROK-182), sidebar layout
 */
export function EventDetailPage() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const eventId = Number(id);

    // ROK-192: IntersectionObserver for collapsible banner
    const bannerRef = useRef<HTMLDivElement>(null);
    const [isBannerCollapsed, setIsBannerCollapsed] = useState(false);

    const { user, isAuthenticated } = useAuth();
    const { data: event, isLoading: eventLoading, error: eventError } = useEvent(eventId);
    const { data: roster } = useEventRoster(eventId);

    useEffect(() => {
        const el = bannerRef.current;
        if (!el) return;
        const observer = new IntersectionObserver(
            ([entry]) => setIsBannerCollapsed(!entry.isIntersecting),
            { threshold: 0, rootMargin: '-64px 0px 0px 0px' }, // offset for header height (h-16)
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, [event]); // re-attach when event loads (ref is null during skeleton)


    const signup = useSignup(eventId);
    const cancelSignup = useCancelSignup(eventId);

    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [pendingSignupId, setPendingSignupId] = useState<number | null>(null);

    // Check if current user is signed up
    const userSignup = roster?.signups.find(s => s.user.id === user?.id);
    const isSignedUp = !!userSignup;
    const needsConfirmation = userSignup?.confirmationStatus === 'pending';

    // ROK-114/183: Roster management
    const isEventCreator = user?.id === event?.creator?.id;
    const isAdmin = user?.isAdmin === true;
    const canManageRoster = isEventCreator || isAdmin;
    // ROK-208: Admins use assignment popup, not click-to-join
    const canJoinSlot = isAuthenticated && !isSignedUp && !canManageRoster;
    const { data: rosterAssignments } = useRoster(eventId);
    const updateRoster = useUpdateRoster(eventId);

    // ROK-183: Detect if this is an MMO game (has tank/healer/dps slots)
    const isMMOGame = isMMOSlotConfig(rosterAssignments?.slots);

    // Handler for roster changes from RosterBuilder
    const handleRosterChange = async (
        pool: RosterAssignmentResponse[],
        assignments: RosterAssignmentResponse[],
    ) => {
        try {
            await updateRoster.mutateAsync(buildRosterUpdate(pool, assignments));
        } catch (err) {
            toast.error('Failed to update roster', {
                description: err instanceof Error ? err.message : 'Please try again.',
            });
        }
    };

    const handleSignup = async () => {
        try {
            const result = await signup.mutateAsync(undefined);
            if (isMMOGame && event?.game?.id) {
                toast.success('Successfully signed up!', {
                    description: 'Now confirm which character you\'re bringing.',
                });
                setPendingSignupId(result.id);
                setShowConfirmModal(true);
            } else {
                toast.success('Successfully signed up!', {
                    description: 'You\'re on the roster!',
                });
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

    // ROK-183/184: Handle slot click to join directly
    const handleSlotClick = async (role: RosterRole, position: number) => {
        if (!isAuthenticated || isSignedUp) return;
        try {
            const result = await signup.mutateAsync({ slotRole: role, slotPosition: position });
            if (isMMOGame) {
                toast.success(`Joined ${role} slot ${position}!`, {
                    description: 'Now confirm your character.',
                });
                setPendingSignupId(result.id);
                setShowConfirmModal(true);
            } else {
                toast.success('Joined!', {
                    description: `You're in ${role} slot ${position}.`,
                });
            }
        } catch (err) {
            toast.error('Failed to sign up', {
                description: err instanceof Error ? err.message : 'Please try again.',
            });
        }
    };

    if (eventError) {
        return (
            <div className="event-detail-page event-detail-page--error">
                <div className="event-detail-error">
                    <h2>Event not found</h2>
                    <p>{eventError.message}</p>
                    <button onClick={() => navigate('/calendar')} className="btn btn-secondary">
                        Back to Calendar
                    </button>
                </div>
            </div>
        );
    }

    if (eventLoading) {
        return (
            <div className="event-detail-page">
                <EventDetailSkeleton />
            </div>
        );
    }

    if (!event) return null;

    // Group signups by status for roster display
    const confirmedSignups = roster?.signups.filter(s => s.confirmationStatus === 'confirmed') || [];
    const pendingSignups = roster?.signups.filter(s => s.confirmationStatus === 'pending') || [];

    return (
        <div className="event-detail-page">
            {/* Back button */}
            <button
                onClick={() => navigate(-1)}
                className="event-detail-back"
                aria-label="Go back to previous page"
            >
                ← Back
            </button>

            {/* ROK-192: Full banner (in-flow, observed for scroll detection) */}
            <div ref={bannerRef}>
                <EventBanner
                    title={event.title}
                    game={event.game}
                    startTime={event.startTime}
                    endTime={event.endTime}
                    creator={event.creator}
                    description={event.description}
                />
            </div>

            {/* ROK-192: Collapsed banner (fixed, only visible when scrolled past full banner) */}
            {isBannerCollapsed && (
                <EventBanner
                    title={event.title}
                    game={event.game}
                    startTime={event.startTime}
                    endTime={event.endTime}
                    creator={event.creator}
                    isCollapsed
                />
            )}

            {/* AC-2: Slot Grid - Primary Focus (Full Width) */}
            {rosterAssignments && (
                <div className="event-detail-slots">
                    <div className="event-detail-slots__header">
                        <h2>
                            <span role="img" aria-hidden="true">🎯</span> Roster Slots
                            {canManageRoster && (
                                <span className="badge badge--indigo">Click slot to assign</span>
                            )}
                            {canJoinSlot && (
                                <span className="badge badge--green">Click to Join</span>
                            )}
                        </h2>
                        {!isAuthenticated && (
                            <Link
                                to="/login"
                                className="btn btn-primary btn-sm"
                            >
                                Login to Join
                            </Link>
                        )}
                        {isSignedUp && !needsConfirmation && (
                            <button
                                onClick={handleCancel}
                                disabled={cancelSignup.isPending}
                                className="btn btn-danger btn-sm"
                            >
                                {cancelSignup.isPending ? 'Leaving...' : 'Leave Event'}
                            </button>
                        )}
                        {needsConfirmation && userSignup && (
                            <button
                                onClick={() => {
                                    setPendingSignupId(userSignup.id);
                                    setShowConfirmModal(true);
                                }}
                                className="btn btn-warning btn-sm"
                            >
                                ❓ Confirm Character
                            </button>
                        )}
                    </div>

                    <RosterBuilder
                        pool={rosterAssignments.pool}
                        assignments={rosterAssignments.assignments}
                        slots={rosterAssignments.slots}
                        onRosterChange={handleRosterChange}
                        canEdit={canManageRoster}
                        onSlotClick={handleSlotClick}
                        canJoin={canJoinSlot}
                        currentUserId={user?.id}
                    />
                </div>
            )}

            {/* Fallback signup button if no roster slots */}
            {!rosterAssignments && isAuthenticated && !isSignedUp && (
                <div className="event-detail-signup-fallback">
                    <button
                        onClick={handleSignup}
                        disabled={signup.isPending}
                        className="btn btn-primary"
                    >
                        {signup.isPending ? 'Signing up...' : 'Sign Up for Event'}
                    </button>
                </div>
            )}

            {/* AC-8: Roster List - grouped by status */}
            <div className="event-detail-roster">
                <h2>Attendees ({roster?.count ?? 0})</h2>

                {confirmedSignups.length > 0 && (
                    <div className="event-detail-roster__group">
                        <h3><span role="img" aria-hidden="true">✓</span> Confirmed ({confirmedSignups.length})</h3>
                        <div className="event-detail-roster__list">
                            {confirmedSignups.map(signup => (
                                <div key={signup.id} className="event-detail-roster__item">
                                    <UserLink
                                        userId={signup.user.id}
                                        username={signup.user.username}
                                        avatarUrl={signup.user.avatar}
                                        showAvatar
                                        size="md"
                                    />
                                    {signup.character && (
                                        <span className="event-detail-roster__character">
                                            as {signup.character.name}
                                        </span>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {pendingSignups.length > 0 && (
                    <div className="event-detail-roster__group">
                        <h3><span role="img" aria-hidden="true">⏳</span> Pending ({pendingSignups.length})</h3>
                        <div className="event-detail-roster__list">
                            {pendingSignups.map(signup => (
                                <div key={signup.id} className="event-detail-roster__item event-detail-roster__item--pending">
                                    <UserLink
                                        userId={signup.user.id}
                                        username={signup.user.username}
                                        avatarUrl={signup.user.avatar}
                                        showAvatar
                                        size="md"
                                    />
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {roster?.signups.length === 0 && (
                    <p className="event-detail-roster__empty">
                        No one has signed up yet. Be the first!
                    </p>
                )}
            </div>

            {/* Character Confirmation Modal */}
            {pendingSignupId && (
                <SignupConfirmationModal
                    isOpen={showConfirmModal}
                    onClose={() => {
                        setShowConfirmModal(false);
                        setPendingSignupId(null);
                    }}
                    eventId={eventId}
                    signupId={pendingSignupId}
                    gameId={event.game?.id?.toString()}
                />
            )}
        </div>
    );
}

/**
 * Skeleton loader for event detail page
 */
function EventDetailSkeleton() {
    return (
        <div className="event-detail-skeleton">
            {/* Banner skeleton */}
            <div className="skeleton skeleton-banner" />

            {/* Slots skeleton */}
            <div className="skeleton skeleton-slots">
                <div className="skeleton skeleton-slots-header" />
                <div className="skeleton skeleton-slots-grid" />
            </div>

            {/* Roster skeleton */}
            <div className="skeleton skeleton-roster">
                <div className="skeleton skeleton-roster-header" />
                <div className="skeleton skeleton-roster-items" />
            </div>
        </div>
    );
}
