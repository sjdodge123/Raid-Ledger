import { useState, useRef, useEffect, lazy, Suspense } from 'react';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { toast } from '../lib/toast';
import { useEvent, useEventRoster } from '../hooks/use-events';
import { useSignup, useCancelSignup, useUpdateSignupStatus } from '../hooks/use-signups';
import { useAuth, isOperatorOrAdmin } from '../hooks/use-auth';
import { useRoster, useUpdateRoster, useSelfUnassign, useAdminRemoveUser, buildRosterUpdate } from '../hooks/use-roster';
import type { RosterAssignmentResponse, RosterRole, PugRole, CharacterRole } from '@raid-ledger/contract';
import { EventBanner } from '../components/events/EventBanner';
import { RosterBuilder } from '../components/roster';
import { UserLink } from '../components/common/UserLink';
import { toAvatarUser } from '../lib/avatar';
import { CharacterCardCompact } from '../components/characters/character-card-compact';
import { AttendeeAvatars } from '../components/calendar/AttendeeAvatars';
import { Modal } from '../components/ui/modal';
import { isMMOSlotConfig } from '../utils/game-utils';
import { useUpdateAutoUnbench } from '../hooks/use-auto-unbench';
import { useGameRegistry } from '../hooks/use-game-registry';
import { getEventStatus } from '../lib/event-utils';
import { useNotifReadSync } from '../hooks/use-notif-read-sync';
import { GameTimeWidget } from '../components/features/game-time/GameTimeWidget';
import { useCreatePug, useDeletePug, usePugs, useRegeneratePugInviteCode } from '../hooks/use-pugs';
import { PluginSlot } from '../plugins';
import { AttendanceTracker } from '../components/events/AttendanceTracker';
import { LiveBadge } from '../components/events/LiveBadge';
import { AdHocRoster } from '../components/events/AdHocRoster';
import { useAdHocSocket } from '../hooks/use-ad-hoc-socket';
import './event-detail-page.css';

// ROK-343: Lazy load modals — only fetched when user triggers them
const SignupConfirmationModal = lazy(() => import('../components/events/signup-confirmation-modal').then(m => ({ default: m.SignupConfirmationModal })));
const RescheduleModal = lazy(() => import('../components/events/RescheduleModal').then(m => ({ default: m.RescheduleModal })));
const CancelEventModal = lazy(() => import('../components/events/cancel-event-modal').then(m => ({ default: m.CancelEventModal })));
const InviteModal = lazy(() => import('../components/events/invite-modal').then(m => ({ default: m.InviteModal })));

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

    // ROK-180 AC-4: Mark notification as read when arriving from Discord DM link
    useNotifReadSync();
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

    // ROK-293: Real-time ad-hoc event updates
    const isAdHoc = event?.isAdHoc ?? false;
    const adHocSocket = useAdHocSocket(isAdHoc ? eventId : null);

    // Look up game config entry for hasRoles/slug (ROK-234)
    // ROK-400: event.game.id is now the games table integer ID directly
    const gameRegistryEntry = games.find(
        (g) => g.id === event?.game?.id || g.slug === event?.game?.slug,
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
    const updateStatus = useUpdateSignupStatus(eventId);

    const [showConfirmModal, setShowConfirmModal] = useState(false);
    // ROK-439: Track pre-selected role and slot position for selection-first flow
    const [preSelectedRole, setPreSelectedRole] = useState<CharacterRole | undefined>(undefined);
    const [pendingSlot, setPendingSlot] = useState<{ role: RosterRole; position: number } | null>(null);
    const [showRescheduleModal, setShowRescheduleModal] = useState(false);
    const [showCancelModal, setShowCancelModal] = useState(false);
    const [showInviteModal, setShowInviteModal] = useState(false);

    // Check if current user is signed up
    const userSignup = roster?.signups.find(s => s.user.id === user?.id);
    const isSignedUp = !!userSignup;

    // ROK-114/183: Roster management
    // ROK-466: Guard against undefined === undefined when user or event is loading
    const isEventCreator = user?.id != null && event?.creator?.id != null && user.id === event.creator.id;
    const canManageEvent = isOperatorOrAdmin(user);
    const canManageRoster = isEventCreator || canManageEvent;
    // ROK-374: Check if event is cancelled
    const isCancelled = !!event?.cancelledAt;
    // ROK-502: Check if event has ended
    const isEnded = event ? getEventStatus(event.startTime, event.endTime) === 'ended' : false;
    const { data: rosterAssignments } = useRoster(eventId);
    // ROK-208: Admins use assignment popup, not click-to-join
    // Allow signed-up users in the unassigned pool to click slots too
    const isInPool = isSignedUp && rosterAssignments?.pool.some(p => p.userId === user?.id);
    const canJoinSlot = isAuthenticated && (!isSignedUp || isInPool) && !canManageRoster && !isCancelled;
    const updateRoster = useUpdateRoster(eventId);
    const selfUnassign = useSelfUnassign(eventId);
    const updateAutoUnbench = useUpdateAutoUnbench(eventId);
    const createPug = useCreatePug(eventId);
    const deletePug = useDeletePug(eventId);
    const regeneratePugCode = useRegeneratePugInviteCode(eventId);
    const adminRemoveUser = useAdminRemoveUser(eventId);
    const { data: pugData } = usePugs(eventId);
    const pugs = pugData?.pugs ?? [];

    // ROK-402: Admin remove user from event confirmation state
    const [removeConfirm, setRemoveConfirm] = useState<{ signupId: number; username: string } | null>(null);

    // ROK-183: Detect if this is an MMO game (has tank/healer/dps slots)
    const isMMOGame = isMMOSlotConfig(rosterAssignments?.slots);

    // Handler for roster changes from RosterBuilder
    // ROK-461: characterIdMap carries admin-selected characters during assignment
    const handleRosterChange = async (
        pool: RosterAssignmentResponse[],
        assignments: RosterAssignmentResponse[],
        characterIdMap?: Map<number, string>,
    ) => {
        // ROK-466: Defensive guard — only admins/creators should reach this path
        if (!canManageRoster) {
            toast.error('Permission denied', {
                description: 'Only the event creator, admin, or operator can update the roster.',
            });
            return;
        }
        try {
            await updateRoster.mutateAsync(buildRosterUpdate(pool, assignments, characterIdMap));
        } catch (err) {
            toast.error('Failed to update roster', {
                description: err instanceof Error ? err.message : 'Please try again.',
            });
        }
    };

    // ROK-439: Selection-first signup — open modal BEFORE any API call
    const handleSignup = () => {
        // If game has character support, show selection modal first
        if (event?.game?.id) {
            setPreSelectedRole(undefined);
            setPendingSlot(null);
            setShowConfirmModal(true);
            return;
        }
        // No game / no character support → instant signup
        doSignup();
    };

    // Perform the actual signup API call (instant path or after modal skip)
    const doSignup = async (options?: { characterId?: string; slotRole?: string; slotPosition?: number; preferredRoles?: string[] }) => {
        try {
            await signup.mutateAsync(options);
            toast.success('Successfully signed up!', {
                description: 'You\'re on the roster!',
            });
        } catch (err) {
            toast.error('Failed to sign up', {
                description: err instanceof Error ? err.message : 'Please try again.',
            });
        }
    };

    // ROK-439/452: Called when user confirms character/role in the pre-signup modal
    const handleSelectionConfirm = async (selection: { characterId: string; role?: CharacterRole; preferredRoles?: CharacterRole[] }) => {
        try {
            const options: { characterId: string; slotRole?: string; slotPosition?: number; preferredRoles?: string[] } = {
                characterId: selection.characterId,
            };
            // ROK-452: Pass preferred roles for multi-role auto-allocation
            if (selection.preferredRoles && selection.preferredRoles.length > 0) {
                options.preferredRoles = selection.preferredRoles;
            }
            // If a slot was targeted (from handleSlotClick), include slot info
            if (pendingSlot) {
                options.slotRole = selection.role ?? pendingSlot.role;
                options.slotPosition = pendingSlot.position;
            } else if (selection.preferredRoles && selection.preferredRoles.length === 1) {
                // Single preferred role acts as direct slot preference
                options.slotRole = selection.preferredRoles[0];
            } else if (!selection.preferredRoles && selection.role) {
                // Fallback: no multi-role, use selected role
                options.slotRole = selection.role;
            }
            await signup.mutateAsync(options);
            setShowConfirmModal(false);
            setPendingSlot(null);
            setPreSelectedRole(undefined);
            toast.success('Successfully signed up!', {
                description: 'You\'re on the roster!',
            });
        } catch (err) {
            toast.error('Failed to sign up', {
                description: err instanceof Error ? err.message : 'Please try again.',
            });
        }
    };

    // ROK-439/529: Called when user has no characters and skips character selection
    const handleSelectionSkip = async (skipOptions?: { preferredRoles?: CharacterRole[] }) => {
        try {
            const options: { slotRole?: string; slotPosition?: number; preferredRoles?: string[] } = {};
            if (pendingSlot) {
                options.slotRole = pendingSlot.role;
                options.slotPosition = pendingSlot.position;
            }
            // ROK-529: Pass preferred roles from no-character role picker
            if (skipOptions?.preferredRoles && skipOptions.preferredRoles.length > 0) {
                options.preferredRoles = skipOptions.preferredRoles;
                if (!options.slotRole && skipOptions.preferredRoles.length === 1) {
                    options.slotRole = skipOptions.preferredRoles[0];
                }
            }
            await signup.mutateAsync(Object.keys(options).length > 0 ? options : undefined);
            setShowConfirmModal(false);
            setPendingSlot(null);
            setPreSelectedRole(undefined);
            toast.success('Successfully signed up!', {
                description: 'You\'re on the roster!',
            });
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
        if (selfUnassign.isPending) return; // Guard against double-clicks
        try {
            await selfUnassign.mutateAsync();
            // Reset the signup mutation so its stale isSuccess doesn't
            // immediately clear the "Join?" pending state in RosterBuilder.
            signup.reset();
            toast.success('Left roster slot', {
                description: 'You\'re still signed up but moved to unassigned.',
            });
        } catch (err) {
            toast.error('Failed to leave slot', {
                description: err instanceof Error ? err.message : 'Please try again.',
            });
        }
    };

    // ROK-263: Generate magic invite link for a PUG slot
    const handleGenerateInviteLink = async (role: RosterRole) => {
        try {
            const pugSlot = await createPug.mutateAsync({
                role: role as PugRole,
            });
            if (!pugSlot.inviteCode) {
                toast.error('Failed to generate invite link', {
                    description: 'No invite code returned. Please try again.',
                });
                return;
            }
            const inviteUrl = `${window.location.origin}/i/${pugSlot.inviteCode}`;
            await navigator.clipboard.writeText(inviteUrl);
            toast.success('Invite link copied to clipboard!', {
                description: inviteUrl,
            });
        } catch (err) {
            toast.error('Failed to generate invite link', {
                description: err instanceof Error ? err.message : 'Please try again.',
            });
        }
    };

    // ROK-292: Handle removing a PUG invite
    const handleRemovePug = async (pugId: string) => {
        try {
            await deletePug.mutateAsync(pugId);
            toast.success('Invite cancelled');
        } catch (err) {
            toast.error('Failed to cancel invite', {
                description: err instanceof Error ? err.message : 'Please try again.',
            });
        }
    };

    // ROK-263: Handle regenerating a PUG invite link
    const handleRegeneratePugLink = async (pugId: string) => {
        try {
            const updated = await regeneratePugCode.mutateAsync(pugId);
            if (updated.inviteCode) {
                const url = `${window.location.origin}/i/${updated.inviteCode}`;
                await navigator.clipboard.writeText(url);
                toast.success('New invite link copied to clipboard!');
            }
        } catch (err) {
            toast.error('Failed to regenerate link', {
                description: err instanceof Error ? err.message : 'Please try again.',
            });
        }
    };

    // ROK-402: Admin remove user from event — opens confirmation dialog
    const handleRemoveFromEvent = (signupId: number, username: string) => {
        setRemoveConfirm({ signupId, username });
    };

    // ROK-402: Confirmed removal
    const handleConfirmRemoveFromEvent = async () => {
        if (!removeConfirm) return;
        try {
            await adminRemoveUser.mutateAsync(removeConfirm.signupId);
            toast.success(`${removeConfirm.username} removed from event`);
            setRemoveConfirm(null);
        } catch (err) {
            toast.error('Failed to remove user', {
                description: err instanceof Error ? err.message : 'Please try again.',
            });
        }
    };

    // ROK-439: Handle slot click — open selection modal with role pre-selected
    const handleSlotClick = (role: RosterRole, position: number) => {
        if (!isAuthenticated || signup.isPending) return;

        // If game has character support, show selection modal first
        if (event?.game?.id) {
            // Pre-select role if it's an MMO role (tank/healer/dps)
            const mmoRoles: string[] = ['tank', 'healer', 'dps'];
            setPreSelectedRole(mmoRoles.includes(role) ? (role as CharacterRole) : undefined);
            setPendingSlot({ role, position });
            setShowConfirmModal(true);
            return;
        }

        // No game / no character support → instant slot join
        // ROK-506: Default role preference to the clicked slot's role
        doSignup({ slotRole: role, slotPosition: position, preferredRoles: [role] });
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
    // Filter out declined signups from display
    const activeSignups = roster?.signups.filter(s => s.status !== 'declined') || [];
    // ROK-459: Separate tentative players from confirmed
    const tentativeSignups = activeSignups.filter(s => s.status === 'tentative').sort(alphabetical);
    const nonTentative = activeSignups.filter(s => s.status !== 'tentative');
    // ROK-457: Anonymous Discord signups can't confirm characters — treat them as confirmed
    const pendingSignups = nonTentative.filter(s => s.confirmationStatus === 'pending' && !s.isAnonymous).sort(alphabetical);
    const confirmedSignups = nonTentative.filter(s => s.confirmationStatus !== 'pending' || s.isAnonymous).sort(alphabetical);

    return (
        <div className="event-detail-page pb-20 md:pb-0">
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

                {/* Invite button for any authenticated guild member */}
                {isAuthenticated && !canManageRoster && !isCancelled && !isEnded && (
                    <button
                        onClick={() => setShowInviteModal(true)}
                        className="btn btn-primary btn-sm"
                    >
                        Invite
                    </button>
                )}

                {canManageRoster && !isCancelled && !isEnded && (
                    <div className="grid grid-cols-2 gap-2 sm:flex">
                        <button
                            onClick={() => setShowInviteModal(true)}
                            className="btn btn-primary btn-sm"
                        >
                            Invite
                        </button>
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
                        <button
                            onClick={() => setShowCancelModal(true)}
                            className="btn btn-danger btn-sm"
                        >
                            Cancel Event
                        </button>
                    </div>
                )}
            </div>

            {/* ROK-374: Cancelled event banner */}
            {isCancelled && event && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 mb-4">
                    <div className="flex items-center gap-2 text-red-400 font-semibold text-sm">
                        <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                        </svg>
                        This event has been cancelled
                    </div>
                    {event.cancellationReason && (
                        <p className="text-sm text-muted mt-1">
                            Reason: {event.cancellationReason}
                        </p>
                    )}
                    <p className="text-xs text-dim mt-1">
                        Cancelled on {new Intl.DateTimeFormat('en-US', {
                            month: 'short', day: 'numeric', year: 'numeric',
                            hour: 'numeric', minute: '2-digit',
                        }).format(new Date(event.cancelledAt!))}
                    </p>
                </div>
            )}

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

            {/* ROK-421: Attendance tracker for past events (creator/admin/operator only) */}
            {event && event.endTime && new Date(event.endTime) < new Date() && !isCancelled && canManageRoster && (
                <AttendanceTracker
                    eventId={eventId}
                    isOrganizer={canManageRoster}
                />
            )}

            {/* ROK-491: Link to per-event metrics for past events (creator/admin/operator only) */}
            {event && event.endTime && new Date(event.endTime) < new Date() && !isCancelled && canManageRoster && (
                <div className="flex justify-center">
                    <Link
                        to={`/events/${eventId}/metrics`}
                        className="px-4 py-2 bg-surface hover:bg-panel text-emerald-400 hover:text-emerald-300 text-sm font-medium rounded-lg border border-edge transition-colors"
                    >
                        View Event Metrics
                    </Link>
                </div>
            )}

            {/* ROK-335: Mobile Quick Info bar — key event info at a glance */}
            <div className="md:hidden event-detail-quick-info">
                <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                        <p className="text-xs text-muted">
                            {new Intl.DateTimeFormat('en-US', {
                                weekday: 'short', month: 'short', day: 'numeric',
                                hour: 'numeric', minute: '2-digit',
                            }).format(new Date(event.startTime))}
                        </p>
                        <div
                            className="flex items-center gap-2 mt-0.5 cursor-pointer group"
                            onClick={() => document.getElementById('event-roster-section')?.scrollIntoView({ behavior: 'smooth' })}
                        >
                            <span className="text-sm font-semibold text-foreground group-hover:text-indigo-400 transition-colors">
                                {roster?.count ?? 0} signed up
                            </span>
                            {(roster?.signups?.length ?? 0) > 0 && (
                                <AttendeeAvatars
                                    signups={[...roster!.signups].sort(alphabetical).slice(0, 5).map(s => ({
                                        id: s.user.id,
                                        username: s.user.username,
                                        avatar: s.user.avatar ?? null,
                                        discordId: s.user.discordId ?? null,
                                        customAvatarUrl: s.user.customAvatarUrl ?? null,
                                        characters: s.user.characters,
                                    }))}
                                    gameId={event.game?.id ?? undefined}
                                    totalCount={roster!.count}
                                    maxVisible={5}
                                    size="md"
                                />
                            )}
                        </div>
                    </div>
                    {isSignedUp && (
                        <span className="text-xs font-medium text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-full whitespace-nowrap shrink-0">
                            ✓ Signed up
                        </span>
                    )}
                </div>
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
                <div className="event-detail-slots" id="event-roster-section">
                    <div className="event-detail-slots__header">
                        <h2>
                            Roster Slots
                            {canManageRoster && (
                                <span className="badge badge--indigo hidden md:inline-flex">Click slot to assign</span>
                            )}
                            {canJoinSlot && (
                                <span className="badge badge--green hidden md:inline-flex">Click to Join</span>
                            )}
                        </h2>
                        <div className="flex items-center gap-2">
                            {/* ROK-229: Auto-sub bench toggle — segmented pill style */}
                            {canManageRoster && !isMMOGame && (
                                <div className={`event-detail-autosub-toggle ${updateAutoUnbench.isPending ? 'opacity-50 pointer-events-none' : ''}`}>
                                    <span className="text-xs text-gray-400 mr-2 whitespace-nowrap">Auto-sub</span>
                                    <div
                                        className="event-detail-autosub-toggle__track"
                                        role="switch"
                                        aria-checked={event.autoUnbench ?? true}
                                        tabIndex={0}
                                        onClick={() => !updateAutoUnbench.isPending && updateAutoUnbench.mutate(!(event.autoUnbench ?? true))}
                                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); updateAutoUnbench.mutate(!(event.autoUnbench ?? true)); } }}
                                    >
                                        <span className={`event-detail-autosub-toggle__option ${(event.autoUnbench ?? true) ? 'event-detail-autosub-toggle__option--active' : ''}`}>On</span>
                                        <span className={`event-detail-autosub-toggle__option ${!(event.autoUnbench ?? true) ? 'event-detail-autosub-toggle__option--active' : ''}`}>Off</span>
                                    </div>
                                </div>
                            )}
                            {!isAuthenticated && (
                                <Link
                                    to="/login"
                                    className="btn btn-primary btn-sm"
                                >
                                    Login to Join
                                </Link>
                            )}
                            {/* ROK-452: General join button for non-admin users */}
                            {canJoinSlot && (
                                <button
                                    onClick={handleSignup}
                                    disabled={signup.isPending}
                                    className="btn btn-primary btn-sm"
                                >
                                    {signup.isPending ? 'Joining...' : 'Join Event'}
                                </button>
                            )}
                            {isSignedUp && (
                                <div className="flex items-center gap-1.5">
                                    {/* ROK-137: Status toggle buttons */}
                                    {userSignup?.status === 'tentative' && (
                                        <button
                                            onClick={() => updateStatus.mutate('signed_up')}
                                            disabled={updateStatus.isPending}
                                            className="btn btn-primary btn-sm"
                                        >
                                            Confirm
                                        </button>
                                    )}
                                    {userSignup?.status !== 'tentative' && (
                                        <button
                                            onClick={() => {
                                                updateStatus.mutate('tentative');
                                                toast.info('Marked as tentative');
                                            }}
                                            disabled={updateStatus.isPending}
                                            className="btn btn-secondary btn-sm"
                                            title="Mark as tentative"
                                        >
                                            Tentative
                                        </button>
                                    )}
                                    <button
                                        onClick={handleCancel}
                                        disabled={cancelSignup.isPending}
                                        className="btn btn-danger btn-sm"
                                    >
                                        {cancelSignup.isPending ? 'Leaving...' : 'Leave'}
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>

                    <RosterBuilder
                        pool={rosterAssignments.pool}
                        assignments={rosterAssignments.assignments}
                        slots={rosterAssignments.slots}
                        onRosterChange={handleRosterChange}
                        canEdit={canManageRoster}
                        onSlotClick={handleSlotClick}
                        canJoin={canJoinSlot}
                        signupSucceeded={signup.isSuccess}
                        currentUserId={user?.id}
                        onSelfRemove={isSignedUp && !canManageRoster ? handleSelfRemove : undefined}
                        onGenerateInviteLink={canManageRoster ? handleGenerateInviteLink : undefined}
                        pugs={pugs}
                        onRemovePug={canManageRoster ? handleRemovePug : undefined}
                        onRegeneratePugLink={canManageRoster ? handleRegeneratePugLink : undefined}
                        eventId={eventId}
                        onRemoveFromEvent={canManageRoster ? handleRemoveFromEvent : undefined}
                        gameId={event.game?.id}
                        isMMOEvent={isMMOGame}
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

                </div>
            )}

            {/* Fallback signup button if no roster slots */}
            {!rosterAssignments && isAuthenticated && !isSignedUp && !isCancelled && (
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

            {/* ROK-293: Ad-Hoc Event Roster */}
            {isAdHoc && (
                <div className="bg-surface rounded-xl border border-edge p-4 mb-6">
                    {event.adHocStatus === 'live' && <LiveBadge className="mb-3" />}
                    <AdHocRoster
                        participants={adHocSocket.participants}
                        activeCount={adHocSocket.activeCount}
                    />
                </div>
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
                                            gameId={event.game?.id ?? undefined}
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

                {tentativeSignups.length > 0 && (
                    <div className="event-detail-roster__group">
                        <h3><span role="img" aria-hidden="true">⏳</span> Tentative ({tentativeSignups.length})</h3>
                        <div className="space-y-2">
                            {tentativeSignups.map(signup => (
                                <div key={signup.id} className="space-y-1">
                                    <div className="flex items-center gap-2">
                                        {signup.isAnonymous ? (
                                            <span className="flex items-center gap-1.5 text-sm text-muted">
                                                <span>{signup.discordUsername ?? signup.user.username}</span>
                                                <span className="text-xs text-indigo-400/70 bg-indigo-500/10 px-1.5 py-0.5 rounded">via Discord</span>
                                            </span>
                                        ) : (
                                            <UserLink
                                                userId={signup.user.id}
                                                username={signup.user.username}
                                                user={toAvatarUser(signup.user)}
                                                gameId={event.game?.id ?? undefined}
                                                showAvatar
                                                size="md"
                                            />
                                        )}
                                        <span className="text-xs text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">tentative</span>
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
                                <div key={signup.id} className="event-detail-roster__item event-detail-roster__item--pending flex items-center gap-2">
                                    {signup.isAnonymous ? (
                                        <span className="flex items-center gap-1.5 text-sm text-muted">
                                            <span>{signup.discordUsername ?? signup.user.username}</span>
                                            <span className="text-xs text-indigo-400/70 bg-indigo-500/10 px-1.5 py-0.5 rounded">via Discord</span>
                                        </span>
                                    ) : (
                                        <UserLink
                                            userId={signup.user.id}
                                            username={signup.user.username}
                                            user={toAvatarUser(signup.user)}
                                            gameId={event.game?.id ?? undefined}
                                            showAvatar
                                            size="md"
                                        />
                                    )}
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

            {/* Plugin: content instance details (e.g. WoW dungeon quest prep) */}
            <PluginSlot
                name="event-detail:content-sections"
                context={{
                    contentInstances: event.contentInstances ?? [],
                    eventId,
                    gameSlug: event.game?.slug,
                    characterId: userSignup?.character?.id,
                }}
            />

            {/* ROK-439: Pre-signup selection modal — character + role BEFORE API call */}
            {showConfirmModal && (
                <Suspense fallback={null}>
                    <SignupConfirmationModal
                        isOpen={showConfirmModal}
                        onClose={() => {
                            setShowConfirmModal(false);
                            setPendingSlot(null);
                            setPreSelectedRole(undefined);
                        }}
                        onConfirm={handleSelectionConfirm}
                        onSkip={handleSelectionSkip}
                        isConfirming={signup.isPending}
                        gameId={gameRegistryEntry?.id ?? event.game?.id ?? undefined}
                        gameName={event.game?.name ?? undefined}
                        hasRoles={gameRegistryEntry?.hasRoles ?? true}
                        gameSlug={event.game?.slug ?? undefined}
                        preSelectedRole={preSelectedRole}
                    />
                </Suspense>
            )}

            {/* ROK-374: Cancel Event Modal */}
            {showCancelModal && event && (
                <Suspense fallback={null}>
                    <CancelEventModal
                        isOpen={showCancelModal}
                        onClose={() => setShowCancelModal(false)}
                        eventId={eventId}
                        eventTitle={event.title}
                        signupCount={event.signupCount}
                    />
                </Suspense>
            )}

            {/* ROK-223: Reschedule Modal */}
            {showRescheduleModal && event && (
                <Suspense fallback={null}>
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
                </Suspense>
            )}

            {/* ROK-402: Remove from event confirmation modal */}
            <Modal
                isOpen={removeConfirm !== null}
                onClose={() => setRemoveConfirm(null)}
                title="Remove from Event"
            >
                {removeConfirm && (
                    <div className="space-y-4">
                        <p className="text-sm text-secondary">
                            Remove <strong className="text-foreground">{removeConfirm.username}</strong> from this event? This will delete their signup and roster assignment.
                        </p>
                        <div className="flex justify-end gap-2 pt-2">
                            <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => setRemoveConfirm(null)}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="btn btn-danger btn-sm"
                                onClick={handleConfirmRemoveFromEvent}
                                disabled={adminRemoveUser.isPending}
                            >
                                {adminRemoveUser.isPending ? 'Removing...' : 'Remove'}
                            </button>
                        </div>
                    </div>
                )}
            </Modal>

            {/* ROK-292: Invite Modal */}
            {showInviteModal && (
                <Suspense fallback={null}>
                    <InviteModal
                        isOpen={showInviteModal}
                        onClose={() => setShowInviteModal(false)}
                        eventId={eventId}
                        existingPugUsernames={new Set(pugs.filter(p => p.discordUsername).map(p => p.discordUsername!.toLowerCase()))}
                        signedUpDiscordIds={new Set(
                            (roster?.signups ?? [])
                                .map(s => s.user.discordId)
                                .filter((id): id is string => !!id)
                        )}
                        isMMOGame={isMMOGame}
                    />
                </Suspense>
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
