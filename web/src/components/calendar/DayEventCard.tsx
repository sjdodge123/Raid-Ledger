import React, { useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { format, differenceInMinutes } from 'date-fns';
import { useAuth } from '../../hooks/use-auth';
import { useRoster } from '../../hooks/use-roster';
import { isMMOSlotConfig } from '../../utils/game-utils';
import { getGameColors } from '../../constants/game-colors';
import { AttendeeAvatars } from './AttendeeAvatars';
import { SignupConfirmationModal } from '../events/signup-confirmation-modal';
import { useDayEventSignup } from './use-day-event-signup';
import type { CalendarEvent } from './CalendarView';
import type { CharacterRole } from '@raid-ledger/contract';

interface DayEventCardProps {
    event: CalendarEvent;
    eventOverlapsGameTime: (start: Date, end: Date) => boolean;
}

const ROLE_CONFIG: Record<string, { label: string; cssClass: string }> = {
    tank: { label: 'Tank', cssClass: 'day-event-role-btn--tank' },
    healer: { label: 'Healer', cssClass: 'day-event-role-btn--healer' },
    dps: { label: 'DPS', cssClass: 'day-event-role-btn--dps' },
    flex: { label: 'Flex', cssClass: 'day-event-role-btn--flex' },
};

/**
 * Day view event card with quick-join/leave actions.
 */
export const DayEventCard = React.memo(function DayEventCard({ event, eventOverlapsGameTime }: DayEventCardProps) {
    const navigate = useNavigate();
    const { user, isAuthenticated } = useAuth();
    const { data: rosterAssignments, isLoading: rosterLoading } = useRoster(event.id);

    const gameSlug = event.resource?.game?.slug || 'default';
    const coverUrl = event.resource?.game?.coverUrl;
    const gameName = event.resource?.game?.name || 'Event';
    const signupCount = event.resource?.signupCount ?? 0;
    const signupsPreview = event.resource?.signupsPreview;
    const description = event.resource?.description || '';
    const creatorName = event.resource?.creator?.username;
    const colors = getGameColors(gameSlug);
    const overlaps = eventOverlapsGameTime(event.start, event.end);

    const startTime = format(event.start, 'h:mm a');
    const endTime = event.end ? format(event.end, 'h:mm a') : '';
    const durationMins = event.end ? differenceInMinutes(event.end, event.start) : 0;
    const hours = Math.floor(durationMins / 60);
    const mins = durationMins % 60;
    const durationStr = hours > 0 ? (mins > 0 ? `${hours}h ${mins}m` : `${hours}h`) : `${mins}m`;
    const descriptionPreview = description.length > 80 ? `${description.slice(0, 80)}...` : description;

    const slots = rosterAssignments?.slots;
    const assignments = rosterAssignments?.assignments ?? [];
    const isMMOGame = isMMOSlotConfig(slots);
    const eventEnded = event.end ? event.end < new Date() : false;

    const allRosterUsers = [...(rosterAssignments?.pool ?? []), ...assignments];
    const isSignedUp = user ? allRosterUsers.some((a) => a.userId === user.id) : false;

    const getFilledCount = (role: string) => assignments.filter((a) => a.slot === role).length;
    const getTotalForRole = (role: string) => (slots as Record<string, number | undefined>)?.[role] ?? 0;
    const getRoleFull = (role: string) => getFilledCount(role) >= getTotalForRole(role);

    const totalPlayerSlots = getTotalForRole('player');
    const totalBenchSlots = getTotalForRole('bench');
    const totalGenericCapacity = totalPlayerSlots + totalBenchSlots;
    const totalGenericFilled = getFilledCount('player') + getFilledCount('bench');
    const genericFull = totalGenericFilled >= totalGenericCapacity;

    const {
        signup, cancelSignup, isMutating, showConfirmModal, pendingRole,
        handleRoleJoin, handleGenericJoin, handleLeave,
        handleSignupConfirm, handleSignupSkip, handleConfirmModalClose,
    } = useDayEventSignup({
        eventId: event.id,
        hasGame: !!event.resource?.game?.id,
        getTotalForRole,
        assignments,
        totalPlayerSlots,
        totalBenchSlots,
    });

    const handleCardClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        const target = e.target as HTMLElement;
        if (target.closest('button, a, [role="dialog"]')) return;
        navigate(`/events/${event.id}`);
    }, [navigate, event.id]);

    const renderActions = () => {
        if (eventEnded) return null;
        if (!isAuthenticated) {
            return (
                <div className="day-event-actions">
                    <Link to="/login?redirect=/calendar" className="day-event-login-link" onClick={(e) => e.stopPropagation()}>Login to join</Link>
                </div>
            );
        }
        if (rosterLoading) {
            return <div className="day-event-actions"><div className="day-event-actions-shimmer" /></div>;
        }
        if (isSignedUp) {
            return (
                <div className="day-event-actions">
                    <button className="day-event-leave-btn" onClick={handleLeave} disabled={isMutating}>
                        {cancelSignup.isPending ? 'Leaving...' : 'Leave'}
                    </button>
                </div>
            );
        }
        if (isMMOGame && slots) {
            const roles = (['tank', 'healer', 'dps', 'flex'] as const).filter((r) => getTotalForRole(r) > 0);
            return (
                <div className="day-event-actions">
                    {roles.map((role) => {
                        const filled = getFilledCount(role);
                        const total = getTotalForRole(role);
                        const full = getRoleFull(role);
                        const config = ROLE_CONFIG[role];
                        return (
                            <button key={role}
                                className={`day-event-role-btn ${config?.cssClass ?? ''} ${full ? 'day-event-role-btn--full' : ''}`}
                                onClick={(e) => handleRoleJoin(e, role)} disabled={full || isMutating}>
                                {signup.isPending ? '...' : `${config?.label ?? role} ${filled}/${total}`}
                            </button>
                        );
                    })}
                </div>
            );
        }
        return (
            <div className="day-event-actions">
                <button className="day-event-join-btn" onClick={handleGenericJoin} disabled={genericFull || isMutating}>
                    {signup.isPending ? 'Joining...' : `Join (${totalGenericFilled}/${totalGenericCapacity} players)`}
                </button>
            </div>
        );
    };

    return (
        <>
            <div className="day-event-block" onClick={handleCardClick} style={{
                backgroundImage: coverUrl
                    ? `linear-gradient(90deg, ${colors.bg}f5 0%, ${colors.bg}dd 20%, ${colors.bg}aa 40%, ${colors.bg}aa 60%, ${colors.bg}dd 80%, ${colors.bg}f5 100%), url(${coverUrl})`
                    : `linear-gradient(90deg, ${colors.bg} 0%, ${colors.bg}dd 100%)`,
                backgroundSize: 'auto 100%, cover', backgroundPosition: 'center, center',
                backgroundRepeat: 'no-repeat', borderLeft: `4px solid ${colors.border}`,
            }}>
                <div className="day-event-content">
                    <div className="day-event-header" style={{ position: 'relative' }}>
                        <span className="day-event-duration">{durationStr}</span>
                        <span className="day-event-title">{event.title}</span>
                        {overlaps && (
                            <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-emerald-400"
                                style={{ boxShadow: '0 0 4px rgba(52, 211, 153, 0.6)' }} title="Overlaps with your game time" />
                        )}
                    </div>
                    <div className="day-event-meta">
                        <span className="day-event-game">{gameName}</span>
                        <span className="day-event-time">{startTime}{endTime ? ` - ${endTime}` : ''}</span>
                        {creatorName && <span className="day-event-creator">by {creatorName}</span>}
                    </div>
                    {descriptionPreview && <p className="day-event-description">{descriptionPreview}</p>}
                </div>
                <div className="day-event-right">
                    <div className="day-event-avatars">
                        {signupsPreview && signupsPreview.length > 0 ? (
                            <AttendeeAvatars signups={signupsPreview} totalCount={signupCount} size="md"
                                accentColor={colors.border} gameId={event.resource?.game?.id ?? undefined} />
                        ) : signupCount > 0 ? (
                            <span className="day-event-signups">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: '6px', verticalAlign: 'middle' }}>
                                    <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
                                </svg>
                                {signupCount} signed up
                            </span>
                        ) : null}
                    </div>
                    {renderActions()}
                </div>
            </div>

            <div onClick={(e) => e.stopPropagation()}>
                {showConfirmModal && (
                    <SignupConfirmationModal
                        isOpen={showConfirmModal} onClose={handleConfirmModalClose}
                        onConfirm={handleSignupConfirm} onSkip={handleSignupSkip}
                        isConfirming={signup.isPending}
                        gameId={event.resource?.game?.id ?? undefined} gameName={gameName}
                        hasRoles={isMMOGame} gameSlug={gameSlug}
                        preSelectedRole={
                            pendingRole === 'tank' || pendingRole === 'healer' || pendingRole === 'dps'
                                ? (pendingRole as CharacterRole) : undefined
                        }
                        eventId={event.resource?.id}
                    />
                )}
            </div>
        </>
    );
});
