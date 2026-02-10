import { useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { format, differenceInMinutes } from 'date-fns';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../hooks/use-auth';
import { useRoster } from '../../hooks/use-roster';
import { useSignup, useCancelSignup } from '../../hooks/use-signups';
import { isMMOSlotConfig } from '../../utils/game-utils';
import { getGameColors } from '../../constants/game-colors';
import { AttendeeAvatars } from './AttendeeAvatars';
import { SignupConfirmationModal } from '../events/signup-confirmation-modal';
import type { CalendarEvent } from './CalendarView';
import type { CharacterRole } from '@raid-ledger/contract';

interface DayEventCardProps {
    event: CalendarEvent;
    eventOverlapsGameTime: (start: Date, end: Date) => boolean;
}

/** Role display config for MMO buttons */
const ROLE_CONFIG: Record<string, { label: string; cssClass: string }> = {
    tank: { label: 'Tank', cssClass: 'day-event-role-btn--tank' },
    healer: { label: 'Healer', cssClass: 'day-event-role-btn--healer' },
    dps: { label: 'DPS', cssClass: 'day-event-role-btn--dps' },
    flex: { label: 'Flex', cssClass: 'day-event-role-btn--flex' },
};

/**
 * Find the first unoccupied position (1-indexed) for a given role.
 */
function findNextAvailablePosition(
    role: string,
    assignments: Array<{ slot: string | null; position: number }>,
    capacity: number,
): number | null {
    const occupied = new Set(
        assignments
            .filter((a) => a.slot === role)
            .map((a) => a.position),
    );
    for (let pos = 1; pos <= capacity; pos++) {
        if (!occupied.has(pos)) return pos;
    }
    return null;
}

/**
 * Day view event card with quick-join/leave actions.
 * Extracted from CalendarView's DayEventComponent callback (ROK-191).
 */
export function DayEventCard({ event, eventOverlapsGameTime }: DayEventCardProps) {
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const { user, isAuthenticated } = useAuth();
    const { data: rosterAssignments, isLoading: rosterLoading } = useRoster(event.id);
    const signup = useSignup(event.id);
    const cancelSignup = useCancelSignup(event.id);

    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [pendingSignupId, setPendingSignupId] = useState<number | null>(null);
    const [pendingRole, setPendingRole] = useState<string | undefined>(undefined);

    // Event data
    const gameSlug = event.resource?.game?.slug || 'default';
    const coverUrl = event.resource?.game?.coverUrl;
    const gameName = event.resource?.game?.name || 'Event';
    const signupCount = event.resource?.signupCount ?? 0;
    const signupsPreview = event.resource?.signupsPreview;
    const description = event.resource?.description || '';
    const creatorName = event.resource?.creator?.username;
    const colors = getGameColors(gameSlug);
    const overlaps = eventOverlapsGameTime(event.start, event.end);

    // Time formatting
    const startTime = format(event.start, 'h:mm a');
    const endTime = event.end ? format(event.end, 'h:mm a') : '';
    const durationMins = event.end ? differenceInMinutes(event.end, event.start) : 0;
    const hours = Math.floor(durationMins / 60);
    const mins = durationMins % 60;
    const durationStr = hours > 0
        ? (mins > 0 ? `${hours}h ${mins}m` : `${hours}h`)
        : `${mins}m`;

    // Description preview
    const descriptionPreview = description.length > 80
        ? `${description.slice(0, 80)}...`
        : description;

    // Game type detection
    const isMMOGame = isMMOSlotConfig(rosterAssignments?.slots);

    // Check if event has ended
    const eventEnded = event.end ? event.end < new Date() : false;

    // Check if user is signed up (look in both pool and assignments)
    const allRosterUsers = [
        ...(rosterAssignments?.pool ?? []),
        ...(rosterAssignments?.assignments ?? []),
    ];
    const isSignedUp = user ? allRosterUsers.some((a) => a.userId === user.id) : false;

    // Slot counting helpers
    const slots = rosterAssignments?.slots;
    const assignments = rosterAssignments?.assignments ?? [];

    function getFilledCount(role: string): number {
        return assignments.filter((a) => a.slot === role).length;
    }

    function getTotalForRole(role: string): number {
        return (slots as Record<string, number | undefined>)?.[role] ?? 0;
    }

    function getRoleFull(role: string): boolean {
        return getFilledCount(role) >= getTotalForRole(role);
    }

    // Generic player count (player + bench)
    const totalPlayerSlots = getTotalForRole('player');
    const totalBenchSlots = getTotalForRole('bench');
    const filledPlayerSlots = getFilledCount('player');
    const totalGenericCapacity = totalPlayerSlots + totalBenchSlots;
    const totalGenericFilled = filledPlayerSlots + getFilledCount('bench');
    const genericFull = totalGenericFilled >= totalGenericCapacity;

    // Invalidate calendar event queries after mutations
    const invalidateCalendar = () => {
        queryClient.invalidateQueries({ queryKey: ['events'] });
    };

    // Handle role-based join (MMO)
    const handleRoleJoin = async (e: React.MouseEvent, role: string) => {
        e.stopPropagation();
        const capacity = getTotalForRole(role);
        const nextPos = findNextAvailablePosition(role, assignments, capacity);
        if (!nextPos) return;

        try {
            const result = await signup.mutateAsync({
                slotRole: role,
                slotPosition: nextPos,
            });
            invalidateCalendar();

            if (event.resource?.game?.registryId) {
                toast.success(`Joined ${ROLE_CONFIG[role]?.label ?? role}!`, {
                    description: 'Now confirm your character.',
                });
                setPendingSignupId(result.id);
                setPendingRole(role);
                setShowConfirmModal(true);
            } else {
                toast.success(`Joined ${ROLE_CONFIG[role]?.label ?? role}!`, {
                    description: `You're in slot ${nextPos}.`,
                });
            }
        } catch (err) {
            toast.error('Failed to sign up', {
                description: err instanceof Error ? err.message : 'Please try again.',
            });
        }
    };

    // Handle generic join
    const handleGenericJoin = async (e: React.MouseEvent) => {
        e.stopPropagation();

        // Try player slots first, then bench
        let role = 'player';
        let nextPos = findNextAvailablePosition('player', assignments, totalPlayerSlots);
        if (!nextPos && totalBenchSlots > 0) {
            role = 'bench';
            nextPos = findNextAvailablePosition('bench', assignments, totalBenchSlots);
        }
        if (!nextPos) return;

        try {
            const result = await signup.mutateAsync({
                slotRole: role,
                slotPosition: nextPos,
            });
            invalidateCalendar();

            if (event.resource?.game?.registryId) {
                toast.success('Joined!', {
                    description: 'Now confirm your character.',
                });
                setPendingSignupId(result.id);
                setPendingRole(undefined);
                setShowConfirmModal(true);
            } else {
                toast.success('Joined!', {
                    description: 'You\'re on the roster!',
                });
            }
        } catch (err) {
            toast.error('Failed to sign up', {
                description: err instanceof Error ? err.message : 'Please try again.',
            });
        }
    };

    // Handle leave
    const handleLeave = async (e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            await cancelSignup.mutateAsync();
            invalidateCalendar();
            toast.success('Signup cancelled', {
                description: 'You have been removed from the event.',
            });
        } catch (err) {
            toast.error('Failed to cancel signup', {
                description: err instanceof Error ? err.message : 'Please try again.',
            });
        }
    };

    const isMutating = signup.isPending || cancelSignup.isPending;

    // Navigate to event detail when clicking card body (not buttons/links)
    const handleCardClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        const target = e.target as HTMLElement;
        if (target.closest('button, a, [role="dialog"]')) return;
        navigate(`/events/${event.id}`);
    }, [navigate, event.id]);

    // Render action area
    const renderActions = () => {
        if (eventEnded) return null;

        if (!isAuthenticated) {
            return (
                <div className="day-event-actions">
                    <Link
                        to={`/login?redirect=/calendar`}
                        className="day-event-login-link"
                        onClick={(e) => e.stopPropagation()}
                    >
                        Login to join
                    </Link>
                </div>
            );
        }

        if (rosterLoading) {
            return (
                <div className="day-event-actions">
                    <div className="day-event-actions-shimmer" />
                </div>
            );
        }

        if (isSignedUp) {
            return (
                <div className="day-event-actions">
                    <button
                        className="day-event-leave-btn"
                        onClick={handleLeave}
                        disabled={isMutating}
                    >
                        {cancelSignup.isPending ? 'Leaving...' : 'Leave'}
                    </button>
                </div>
            );
        }

        // MMO role buttons
        if (isMMOGame && slots) {
            const roles = (['tank', 'healer', 'dps', 'flex'] as const).filter(
                (r) => getTotalForRole(r) > 0,
            );
            return (
                <div className="day-event-actions">
                    {roles.map((role) => {
                        const filled = getFilledCount(role);
                        const total = getTotalForRole(role);
                        const full = getRoleFull(role);
                        const config = ROLE_CONFIG[role];
                        return (
                            <button
                                key={role}
                                className={`day-event-role-btn ${config?.cssClass ?? ''} ${full ? 'day-event-role-btn--full' : ''}`}
                                onClick={(e) => handleRoleJoin(e, role)}
                                disabled={full || isMutating}
                            >
                                {signup.isPending ? '...' : `${config?.label ?? role} ${filled}/${total}`}
                            </button>
                        );
                    })}
                </div>
            );
        }

        // Generic join button
        return (
            <div className="day-event-actions">
                <button
                    className="day-event-join-btn"
                    onClick={handleGenericJoin}
                    disabled={genericFull || isMutating}
                >
                    {signup.isPending
                        ? 'Joining...'
                        : `Join (${totalGenericFilled}/${totalGenericCapacity} players)`}
                </button>
            </div>
        );
    };

    return (
        <>
            <div
                className="day-event-block"
                onClick={handleCardClick}
                style={{
                    backgroundImage: coverUrl
                        ? `linear-gradient(90deg, ${colors.bg}f5 0%, ${colors.bg}dd 20%, ${colors.bg}aa 40%, ${colors.bg}aa 60%, ${colors.bg}dd 80%, ${colors.bg}f5 100%), url(${coverUrl})`
                        : `linear-gradient(90deg, ${colors.bg} 0%, ${colors.bg}dd 100%)`,
                    backgroundSize: 'auto 100%, cover',
                    backgroundPosition: 'center, center',
                    backgroundRepeat: 'no-repeat',
                    borderLeft: `4px solid ${colors.border}`,
                }}
            >
                <div className="day-event-content">
                    <div className="day-event-header" style={{ position: 'relative' }}>
                        <span className="day-event-duration">{durationStr}</span>
                        <span className="day-event-title">{event.title}</span>
                        {overlaps && (
                            <span
                                className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-emerald-400"
                                style={{ boxShadow: '0 0 4px rgba(52, 211, 153, 0.6)' }}
                                title="Overlaps with your game time"
                            />
                        )}
                    </div>
                    <div className="day-event-meta">
                        <span className="day-event-game">{gameName}</span>
                        <span className="day-event-time">
                            {startTime}{endTime ? ` - ${endTime}` : ''}
                        </span>
                        {creatorName && (
                            <span className="day-event-creator">by {creatorName}</span>
                        )}
                    </div>
                    {descriptionPreview && (
                        <p className="day-event-description">{descriptionPreview}</p>
                    )}
                </div>
                {/* Right side: avatars + actions over cover art */}
                <div className="day-event-right">
                    {/* Attendee avatars */}
                    <div className="day-event-avatars">
                    {signupsPreview && signupsPreview.length > 0 ? (
                        <AttendeeAvatars
                            signups={signupsPreview}
                            totalCount={signupCount}
                            size="md"
                            accentColor={colors.border}
                            gameId={event.resource?.game?.registryId ?? undefined}
                        />
                    ) : signupCount > 0 ? (
                        <span className="day-event-signups">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: '6px', verticalAlign: 'middle' }}>
                                <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
                            </svg>
                            {signupCount} signed up
                        </span>
                    ) : null}
                    </div>
                    {/* Quick-join actions */}
                    {renderActions()}
                </div>
            </div>

            {/* Signup confirmation modal for character selection */}
            <div onClick={(e) => e.stopPropagation()}>
            {pendingSignupId !== null && (
                <SignupConfirmationModal
                    isOpen={showConfirmModal}
                    onClose={() => {
                        setShowConfirmModal(false);
                        setPendingSignupId(null);
                        setPendingRole(undefined);
                    }}
                    eventId={event.id}
                    signupId={pendingSignupId}
                    gameId={event.resource?.game?.registryId ?? undefined}
                    expectedRole={
                        pendingRole === 'tank' || pendingRole === 'healer' || pendingRole === 'dps'
                            ? (pendingRole as CharacterRole)
                            : undefined
                    }
                />
            )}
            </div>
        </>
    );
}
