import { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { toast } from '../lib/toast';
import { useEvent, useEventRoster } from '../hooks/use-events';
import { useSignup, useCancelSignup } from '../hooks/use-signups';
import { useAuth, isOperatorOrAdmin } from '../hooks/use-auth';
import { useRoster, useUpdateRoster, useSelfUnassign, buildRosterUpdate } from '../hooks/use-roster';
import type { RosterAssignmentResponse, RosterRole } from '@raid-ledger/contract';
import { EventBanner } from '../components/events/EventBanner';
import { SignupConfirmationModal } from '../components/events/signup-confirmation-modal';
import { RosterBuilder } from '../components/roster';
import { UserLink } from '../components/common/UserLink';
import { toAvatarUser } from '../lib/avatar';
import { CharacterCardCompact } from '../components/characters/character-card-compact';
import { isMMOSlotConfig } from '../utils/game-utils';
import { useUpdateAutoUnbench } from '../hooks/use-auto-unbench';
import { useGameRegistry } from '../hooks/use-game-registry';
import { GameTimeWidget } from '../components/features/game-time/GameTimeWidget';
import { RescheduleModal } from '../components/events/RescheduleModal';
import { PugSection } from '../components/pugs';
import { PluginSlot } from '../plugins';
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
    const location = useLocation();
    const eventId = Number(id);
    const navState = location.state as { fromCalendar?: boolean; calendarDate?: string; calendarView?: string } | null;
    // Only treat as "from calendar" if the state includes the calendar date (guards against stale state)
    const fromCalendar = navState?.fromCalendar === true && !!navState?.calendarDate;
    // "default" key means direct URL access (no in-app navigation history)
    const hasHistory = location.key !== 'default';

    // ROK-192: IntersectionObserver for collapsible banner
    const bannerRef = useRef<HTMLDivElement>(null);
    const [isBannerCollapsed, setIsBannerCollapsed] = useState(false);

    const { user, isAuthenticated } = useAuth();
    const { data: event, isLoading: eventLoading, error: eventError } = useEvent(eventId);
    const { data: roster } = useEventRoster(eventId);
    const { games } = useGameRegistry();

    // Look up game registry entry for hasRoles/slug (ROK-234)
    const gameRegistryEntry = games.find(
        (g) => g.id === event?.game?.registryId || g.slug === event?.game?.slug,
    );

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
    const [showRescheduleModal, setShowRescheduleModal] = useState(false);

    // Check if current user is signed up
    const userSignup = roster?.signups.find(s => s.user.id === user?.id);
    const isSignedUp = !!userSignup;
    const needsConfirmation = userSignup?.confirmationStatus === 'pending';

    // ROK-114/183: Roster management
    const isEventCreator = user?.id === event?.creator?.id;
    const canManageEvent = isOperatorOrAdmin(user);
    const canManageRoster = isEventCreator || canManageEvent;
    // ROK-208: Admins use assignment popup, not click-to-join
    const canJoinSlot = isAuthenticated && !isSignedUp && !canManageRoster;
    const { data: rosterAssignments } = useRoster(eventId);
    const updateRoster = useUpdateRoster(eventId);
    const selfUnassign = useSelfUnassign(eventId);
    const updateAutoUnbench = useUpdateAutoUnbench(eventId);

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

    // ROK-226: Handle self-unassign from roster slot
    const handleSelfRemove = async () => {
        try {
            await selfUnassign.mutateAsync();
            toast.success('Left roster slot', {
                description: 'You\'re still signed up but moved to unassigned.',
            });
        } catch (err) {
            toast.error('Failed to leave slot', {
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

    // Group signups by status for roster display, sorted alphabetically (ROK-300)
    const alphabetical = (a: { user: { username: string } }, b: { user: { username: string } }) =>
        a.user.username.localeCompare(b.user.username, undefined, { sensitivity: 'base' });
    const confirmedSignups = (roster?.signups.filter(s => s.confirmationStatus === 'confirmed') || []).sort(alphabetical);
    const pendingSignups = (roster?.signups.filter(s => s.confirmationStatus === 'pending') || []).sort(alphabetical);

    return (
        <div className="event-detail-page">
            {/* Back button + Edit button row */}
            <div className="event-detail-topbar">
                <button
                    onClick={() => {
                        if (fromCalendar) {
                            const params = new URLSearchParams();
                            if (navState?.calendarDate) params.set('date', navState.calendarDate);
                            if (navState?.calendarView) params.set('view', navState.calendarView);
                            navigate(`/calendar?${params.toString()}`);
                        } else if (hasHistory) {
                            navigate(-1);
                        } else {
                            navigate('/calendar');
                        }
                    }}
                    className="event-detail-back"
                    aria-label="Go back"
                >
                    {fromCalendar ? '← Back to Calendar' : '← Back'}
                </button>

                {canManageRoster && (
                    <div className="flex gap-2">
                        <button
                            onClick={() => setShowRescheduleModal(true)}
                            className="btn btn-secondary btn-sm"
                        >
                            Reschedule
                        </button>
                        <button
                            onClick={() => navigate(`/events/${eventId}/edit`)}
                            className="btn btn-secondary btn-sm"
                        >
                            Edit Event
                        </button>
                    </div>
                )}
            </div>

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

            {/* Plugin: content instance details (e.g. WoW dungeon/raid chips) */}
            <PluginSlot
                name="event-detail:content-sections"
                context={{ contentInstances: event.contentInstances ?? [] }}
            />

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

                    {/* ROK-229: Auto-sub bench toggle (generic events only) */}
                    {canManageRoster && !isMMOGame && (
                        <label className="flex items-center gap-2 text-sm text-gray-400 mb-3 cursor-pointer select-none">
                            <input
                                type="checkbox"
                                checked={event.autoUnbench ?? true}
                                onChange={(e) => updateAutoUnbench.mutate(e.target.checked)}
                                disabled={updateAutoUnbench.isPending}
                                className="rounded border-gray-600 bg-gray-700 text-indigo-500 focus:ring-indigo-500"
                            />
                            Auto-sub bench players when a slot opens
                        </label>
                    )}

                    <RosterBuilder
                        pool={rosterAssignments.pool}
                        assignments={rosterAssignments.assignments}
                        slots={rosterAssignments.slots}
                        onRosterChange={handleRosterChange}
                        canEdit={canManageRoster}
                        onSlotClick={handleSlotClick}
                        canJoin={canJoinSlot}
                        currentUserId={user?.id}
                        onSelfRemove={isSignedUp && !canManageRoster ? handleSelfRemove : undefined}
                        stickyExtra={isAuthenticated && event.startTime && event.endTime ? (
                            <GameTimeWidget
                                eventStartTime={event.startTime}
                                eventEndTime={event.endTime}
                                eventTitle={event.title}
                                gameName={event.game?.name}
                                gameSlug={event.game?.slug}
                                coverUrl={event.game?.coverUrl}
                                description={event.description}
                                creatorUsername={event.creator?.username}
                                attendees={roster?.signups.slice(0, 6).map(s => ({
                                    id: s.id,
                                    username: s.user.username,
                                    avatar: s.user.avatar ?? null,
                                }))}
                                attendeeCount={roster?.count}
                            />
                        ) : undefined}
                    />

                    {/* ROK-262: PUG Slots Section */}
                    <PugSection
                        eventId={eventId}
                        canManage={canManageRoster}
                        isMMOGame={isMMOGame}
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

            {/* Game Time widget fallback when no roster slots */}
            {!rosterAssignments && isAuthenticated && event.startTime && event.endTime && (
                <GameTimeWidget
                    eventStartTime={event.startTime}
                    eventEndTime={event.endTime}
                    eventTitle={event.title}
                    gameName={event.game?.name}
                    gameSlug={event.game?.slug}
                    coverUrl={event.game?.coverUrl}
                    description={event.description}
                    creatorUsername={event.creator?.username}
                    attendees={roster?.signups.slice(0, 6).map(s => ({
                        id: s.id,
                        username: s.user.username,
                        avatar: s.user.avatar ?? null,
                    }))}
                    attendeeCount={roster?.count}
                />
            )}

            {/* AC-8: Roster List - grouped by status */}
            <div className="event-detail-roster">
                <h2>Attendees ({roster?.count ?? 0})</h2>

                {confirmedSignups.length > 0 && (
                    <div className="event-detail-roster__group">
                        <h3><span role="img" aria-hidden="true">✓</span> Confirmed ({confirmedSignups.length})</h3>
                        <div className="space-y-2">
                            {confirmedSignups.map(signup => (
                                    <div key={signup.id} className="space-y-1">
                                        <div className="flex items-center gap-2">
                                            <UserLink
                                                userId={signup.user.id}
                                                username={signup.user.username}
                                                user={toAvatarUser(signup.user)}
                                                showAvatar
                                                size="md"
                                            />
                                            <PluginSlot
                                                name="event-detail:signup-warnings"
                                                context={{
                                                    characterLevel: signup.character?.level,
                                                    contentInstances: event.contentInstances ?? [],
                                                    gameSlug: event.game?.slug,
                                                }}
                                            />
                                        </div>
                                        {signup.character && (
                                            <CharacterCardCompact
                                                id={signup.character.id}
                                                name={signup.character.name}
                                                avatarUrl={signup.character.avatarUrl}
                                                faction={signup.character.faction}
                                                level={signup.character.level}
                                                race={signup.character.race}
                                                className={signup.character.class}
                                                spec={signup.character.spec}
                                                role={signup.character.role}
                                                itemLevel={signup.character.itemLevel}
                                            />
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
                                        user={toAvatarUser(signup.user)}
                                        showAvatar
                                        size="md"
                                    />
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* AC-5: Empty state with actionable message */}
                {roster?.signups.length === 0 && (
                    <div className="event-detail-roster__empty">
                        <p>No players signed up yet — share the event!</p>
                        <button
                            onClick={() => {
                                const url = window.location.href;
                                navigator.clipboard.writeText(url).then(() => {
                                    toast.success('Event link copied to clipboard!');
                                });
                            }}
                            className="btn btn-secondary btn-sm mt-2"
                        >
                            Copy Event Link
                        </button>
                    </div>
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
                    gameId={gameRegistryEntry?.id ?? event.game?.registryId ?? undefined}
                    gameName={event.game?.name ?? undefined}
                    hasRoles={gameRegistryEntry?.hasRoles ?? true}
                    gameSlug={event.game?.slug ?? undefined}
                />
            )}

            {/* ROK-223: Reschedule Modal */}
            {showRescheduleModal && event && (
                <RescheduleModal
                    isOpen={showRescheduleModal}
                    onClose={() => setShowRescheduleModal(false)}
                    eventId={eventId}
                    currentStartTime={event.startTime}
                    currentEndTime={event.endTime}
                    eventTitle={event.title}
                    gameSlug={event.game?.slug}
                    gameName={event.game?.name}
                    coverUrl={event.game?.coverUrl}
                    description={event.description}
                    creatorUsername={event.creator?.username}
                    signupCount={event.signupCount}
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
