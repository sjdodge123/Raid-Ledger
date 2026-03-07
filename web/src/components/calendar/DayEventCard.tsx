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
function formatDuration(start: Date, end: Date | null): string {
    if (!end) return '0m';
    const durationMins = differenceInMinutes(end, start);
    const hours = Math.floor(durationMins / 60);
    const mins = durationMins % 60;
    return hours > 0 ? (mins > 0 ? `${hours}h ${mins}m` : `${hours}h`) : `${mins}m`;
}

function LoginAction() {
    return (
        <div className="day-event-actions">
            <Link to="/login?redirect=/calendar" className="day-event-login-link" onClick={(e) => e.stopPropagation()}>Login to join</Link>
        </div>
    );
}

function LeaveAction({ onLeave, isPending, isMutating }: { onLeave: (e: React.MouseEvent) => void; isPending: boolean; isMutating: boolean }) {
    return (
        <div className="day-event-actions">
            <button className="day-event-leave-btn" onClick={onLeave} disabled={isMutating}>{isPending ? 'Leaving...' : 'Leave'}</button>
        </div>
    );
}

function RoleJoinActions({ getTotalForRole, getFilledCount, getRoleFull, handleRoleJoin, isMutating, signupPending }: {
    getTotalForRole: (r: string) => number; getFilledCount: (r: string) => number; getRoleFull: (r: string) => boolean;
    handleRoleJoin: (e: React.MouseEvent, r: string) => void; isMutating: boolean; signupPending: boolean;
}) {
    const roles = (['tank', 'healer', 'dps', 'flex'] as const).filter((r) => getTotalForRole(r) > 0);
    return (
        <div className="day-event-actions">
            {roles.map((role) => {
                const config = ROLE_CONFIG[role];
                return (
                    <button key={role} className={`day-event-role-btn ${config?.cssClass ?? ''} ${getRoleFull(role) ? 'day-event-role-btn--full' : ''}`}
                        onClick={(e) => handleRoleJoin(e, role)} disabled={getRoleFull(role) || isMutating}>
                        {signupPending ? '...' : `${config?.label ?? role} ${getFilledCount(role)}/${getTotalForRole(role)}`}
                    </button>
                );
            })}
        </div>
    );
}

function GenericJoinAction({ onClick, full, isMutating, pending, filled, capacity }: {
    onClick: (e: React.MouseEvent) => void; full: boolean; isMutating: boolean; pending: boolean; filled: number; capacity: number;
}) {
    return (
        <div className="day-event-actions">
            <button className="day-event-join-btn" onClick={onClick} disabled={full || isMutating}>
                {pending ? 'Joining...' : `Join (${filled}/${capacity} players)`}
            </button>
        </div>
    );
}

function useDayEventData(event: CalendarEvent, eventOverlapsGameTime: (s: Date, e: Date) => boolean) {
    const { data: rosterAssignments, isLoading: rosterLoading } = useRoster(event.id);
    const gameSlug = event.resource?.game?.slug || 'default';
    const coverUrl = event.resource?.game?.coverUrl;
    const gameName = event.resource?.game?.name || 'Event';
    const signupCount = event.resource?.signupCount ?? 0;
    const signupsPreview = event.resource?.signupsPreview;
    const description = event.resource?.description || '';
    const colors = getGameColors(gameSlug);
    const overlaps = eventOverlapsGameTime(event.start, event.end);
    const durationStr = formatDuration(event.start, event.end);
    const descriptionPreview = description.length > 80 ? `${description.slice(0, 80)}...` : description;
    const slots = rosterAssignments?.slots;
    const assignments = rosterAssignments?.assignments ?? [];
    const isMMOGame = isMMOSlotConfig(slots);
    const eventEnded = event.end ? event.end < new Date() : false;
    const allRosterUsers = [...(rosterAssignments?.pool ?? []), ...assignments];
    const getFilledCount = (role: string) => assignments.filter((a) => a.slot === role).length;
    const getTotalForRole = (role: string) => (slots as Record<string, number | undefined>)?.[role] ?? 0;
    const getRoleFull = (role: string) => getFilledCount(role) >= getTotalForRole(role);
    const totalPlayerSlots = getTotalForRole('player');
    const totalBenchSlots = getTotalForRole('bench');
    return { gameSlug, coverUrl, gameName, signupCount, signupsPreview, colors, overlaps, durationStr, descriptionPreview, slots, assignments, isMMOGame, eventEnded, allRosterUsers, getFilledCount, getTotalForRole, getRoleFull, totalPlayerSlots, totalBenchSlots, rosterLoading };
}

function DayEventActions({ eventEnded, isAuthenticated, rosterLoading, isSignedUp, isMMOGame, slots, s, d }: {
    eventEnded: boolean; isAuthenticated: boolean; rosterLoading: boolean; isSignedUp: boolean;
    isMMOGame: boolean; slots: unknown; s: ReturnType<typeof useDayEventSignup>;
    d: ReturnType<typeof useDayEventData>;
}) {
    if (eventEnded) return null;
    if (!isAuthenticated) return <LoginAction />;
    if (rosterLoading) return <div className="day-event-actions"><div className="day-event-actions-shimmer" /></div>;
    if (isSignedUp) return <LeaveAction onLeave={s.handleLeave} isPending={s.cancelSignup.isPending} isMutating={s.isMutating} />;
    if (isMMOGame && slots) return <RoleJoinActions getTotalForRole={d.getTotalForRole} getFilledCount={d.getFilledCount} getRoleFull={d.getRoleFull} handleRoleJoin={s.handleRoleJoin} isMutating={s.isMutating} signupPending={s.signup.isPending} />;
    return <GenericJoinAction onClick={s.handleGenericJoin} full={d.getFilledCount('player') + d.getFilledCount('bench') >= d.totalPlayerSlots + d.totalBenchSlots} isMutating={s.isMutating} pending={s.signup.isPending} filled={d.getFilledCount('player') + d.getFilledCount('bench')} capacity={d.totalPlayerSlots + d.totalBenchSlots} />;
}

function DayEventBlockContent({ event, d }: { event: CalendarEvent; d: ReturnType<typeof useDayEventData> }) {
    return (
        <div className="day-event-content">
            <div className="day-event-header" style={{ position: 'relative' }}>
                <span className="day-event-duration">{d.durationStr}</span>
                <span className="day-event-title">{event.title}</span>
                {d.overlaps && <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-emerald-400" style={{ boxShadow: '0 0 4px rgba(52, 211, 153, 0.6)' }} title="Overlaps with your game time" />}
            </div>
            <div className="day-event-meta">
                <span className="day-event-game">{d.gameName}</span>
                <span className="day-event-time">{format(event.start, 'h:mm a')}{event.end ? ` - ${format(event.end, 'h:mm a')}` : ''}</span>
                {event.resource?.creator?.username && <span className="day-event-creator">by {event.resource.creator.username}</span>}
            </div>
            {d.descriptionPreview && <p className="day-event-description">{d.descriptionPreview}</p>}
        </div>
    );
}

function buildDayEventBgStyle(coverUrl: string | null | undefined, colors: { bg: string; border: string }) {
    return {
        backgroundImage: coverUrl
            ? `linear-gradient(90deg, ${colors.bg}f5 0%, ${colors.bg}dd 20%, ${colors.bg}aa 40%, ${colors.bg}aa 60%, ${colors.bg}dd 80%, ${colors.bg}f5 100%), url(${coverUrl})`
            : `linear-gradient(90deg, ${colors.bg} 0%, ${colors.bg}dd 100%)`,
        backgroundSize: 'auto 100%, cover', backgroundPosition: 'center, center', backgroundRepeat: 'no-repeat', borderLeft: `4px solid ${colors.border}`,
    };
}

const PEOPLE_ICON_PATH = 'M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z';

function DayEventAvatarsPanel({ d, event }: { d: ReturnType<typeof useDayEventData>; event: CalendarEvent }) {
    if (d.signupsPreview && d.signupsPreview.length > 0) {
        return <AttendeeAvatars signups={d.signupsPreview} totalCount={d.signupCount} size="md" accentColor={d.colors.border} gameId={event.resource?.game?.id ?? undefined} />;
    }
    if (d.signupCount > 0) {
        return <span className="day-event-signups"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: '6px', verticalAlign: 'middle' }}><path d={PEOPLE_ICON_PATH} /></svg>{d.signupCount} signed up</span>;
    }
    return null;
}

function DayEventConfirmModal({ s, event, d }: { s: ReturnType<typeof useDayEventSignup>; event: CalendarEvent; d: ReturnType<typeof useDayEventData> }) {
    if (!s.showConfirmModal) return null;
    return (
        <div onClick={(e) => e.stopPropagation()}>
            <SignupConfirmationModal isOpen={s.showConfirmModal} onClose={s.handleConfirmModalClose}
                onConfirm={s.handleSignupConfirm} onSkip={s.handleSignupSkip} isConfirming={s.signup.isPending}
                gameId={event.resource?.game?.id ?? undefined} gameName={d.gameName} hasRoles={d.isMMOGame} gameSlug={d.gameSlug}
                preSelectedRole={s.pendingRole === 'tank' || s.pendingRole === 'healer' || s.pendingRole === 'dps' ? (s.pendingRole as CharacterRole) : undefined}
                eventId={event.resource?.id} />
        </div>
    );
}

export const DayEventCard = React.memo(function DayEventCard({ event, eventOverlapsGameTime }: DayEventCardProps) {
    const navigate = useNavigate();
    const { user, isAuthenticated } = useAuth();
    const d = useDayEventData(event, eventOverlapsGameTime);
    const isSignedUp = user ? d.allRosterUsers.some((a) => a.userId === user.id) : false;
    const s = useDayEventSignup({ eventId: event.id, hasGame: !!event.resource?.game?.id, getTotalForRole: d.getTotalForRole, assignments: d.assignments, totalPlayerSlots: d.totalPlayerSlots, totalBenchSlots: d.totalBenchSlots });

    const handleCardClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        if ((e.target as HTMLElement).closest('button, a, [role="dialog"]')) return;
        navigate(`/events/${event.id}`);
    }, [navigate, event.id]);

    return (
        <>
            <div className="day-event-block" onClick={handleCardClick} style={buildDayEventBgStyle(d.coverUrl, d.colors)}>
                <DayEventBlockContent event={event} d={d} />
                <div className="day-event-right">
                    <div className="day-event-avatars"><DayEventAvatarsPanel d={d} event={event} /></div>
                    <DayEventActions eventEnded={d.eventEnded} isAuthenticated={isAuthenticated} rosterLoading={d.rosterLoading} isSignedUp={isSignedUp} isMMOGame={d.isMMOGame} slots={d.slots} s={s} d={d} />
                </div>
            </div>
            <DayEventConfirmModal s={s} event={event} d={d} />
        </>
    );
});
