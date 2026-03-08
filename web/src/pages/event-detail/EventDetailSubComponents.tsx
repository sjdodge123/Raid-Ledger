/**
 * Sub-components for the Event Detail page.
 * Extracted from event-detail-page.tsx for file size compliance (ROK-719).
 */
import type { JSX } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import type { EventResponseDto, EventRosterDto } from '@raid-ledger/contract';
import { AttendeeAvatars } from '../../components/calendar/AttendeeAvatars';
import { GameTimeWidget } from '../../components/features/game-time/GameTimeWidget';
import { AttendanceTracker } from '../../components/events/AttendanceTracker';
import { LiveBadge } from '../../components/events/LiveBadge';
import { VoiceRoster } from '../../components/events/VoiceRoster';
import { toast } from '../../lib/toast';
import type { useEventDetailHandlers } from './use-event-detail-handlers';

export function EventDetailError({ message, onBack }: { message: string; onBack: () => void }) {
    return (
        <div className="event-detail-page event-detail-page--error">
            <div className="event-detail-error">
                <h2>Event not found</h2>
                <p>{message}</p>
                <button onClick={onBack} className="btn btn-secondary">Back to Calendar</button>
            </div>
        </div>
    );
}

export function EventDetailFallbackSignup({ rosterAssignments, isAuthenticated, isSignedUp, isCancelled, onSignup, isPending }: {
    rosterAssignments: unknown; isAuthenticated: boolean; isSignedUp: boolean; isCancelled: boolean; onSignup: () => void; isPending: boolean;
}) {
    if (rosterAssignments || !isAuthenticated || isSignedUp || isCancelled) return null;
    return (
        <div className="event-detail-signup-fallback">
            <button onClick={onSignup} disabled={isPending} className="btn btn-primary">{isPending ? 'Signing up...' : 'Sign Up for Event'}</button>
        </div>
    );
}

export function EventDetailGameTimeWidget({ rosterAssignments, isAuthenticated, event, roster }: {
    rosterAssignments: unknown; isAuthenticated: boolean; event: EventResponseDto; roster: EventRosterDto | undefined;
}) {
    if (rosterAssignments || !isAuthenticated || !event.startTime || !event.endTime) return null;
    return (
        <GameTimeWidget eventStartTime={event.startTime} eventEndTime={event.endTime} eventTitle={event.title} gameName={event.game?.name}
            gameSlug={event.game?.slug} coverUrl={event.game?.coverUrl} description={event.description} creatorUsername={event.creator?.username}
            attendees={roster?.signups.slice(0, 6).map(s => ({ id: s.id, username: s.user.username, avatar: s.user.avatar ?? null }))} attendeeCount={roster?.count} />
    );
}

export function EventDetailVoiceSection({ showVoiceRoster, voiceRoster, isAdHoc, event, eventStatus }: {
    showVoiceRoster: boolean; voiceRoster: { participants: unknown[]; activeCount: number };
    isAdHoc: boolean; event: EventResponseDto; eventStatus: string | null;
}) {
    if (!showVoiceRoster || !voiceRoster.participants.length) return null;
    return (
        <div className="bg-surface rounded-xl border border-edge p-4 mb-6">
            {(isAdHoc ? event.adHocStatus === 'live' : eventStatus === 'live') && <LiveBadge className="mb-3" />}
            <VoiceRoster participants={voiceRoster.participants as never} activeCount={voiceRoster.activeCount} />
        </div>
    );
}

function resolveBackNavigation(fromCalendar: boolean, navState: { calendarDate?: string; calendarView?: string } | null, hasHistory: boolean, navigate: ReturnType<typeof useNavigate>) {
    if (fromCalendar) {
        const params = new URLSearchParams();
        if (navState?.calendarDate) params.set('date', navState.calendarDate);
        if (navState?.calendarView) params.set('view', navState.calendarView);
        navigate(`/calendar?${params.toString()}`);
    } else if (hasHistory) { navigate(-1); }
    else { navigate('/calendar'); }
}

function useTopbarActions(isSeries: boolean, eventId: number, onCancel: () => void, onDelete?: () => void, onSeriesAction?: (action: 'edit' | 'delete' | 'cancel') => void) {
    const navigate = useNavigate();
    return {
        navigate,
        handleEdit: () => { if (isSeries && onSeriesAction) onSeriesAction('edit'); else navigate(`/events/${eventId}/edit`); },
        handleCancel: () => { if (isSeries && onSeriesAction) onSeriesAction('cancel'); else onCancel(); },
        handleDelete: () => { if (isSeries && onSeriesAction) onSeriesAction('delete'); else onDelete?.(); },
    };
}

/** Top bar with back + action buttons */
export function EventDetailTopbar({ fromCalendar, navState, hasHistory, isAuthenticated, canManageRoster, isCancelled, isEnded, eventId, recurrenceGroupId, onInvite, onReschedule, onCancel, onDelete, onSeriesAction }: {
    fromCalendar: boolean; navState: { calendarDate?: string; calendarView?: string } | null;
    hasHistory: boolean; isAuthenticated: boolean; canManageRoster: boolean; isCancelled: boolean;
    isEnded: boolean; eventId: number; recurrenceGroupId?: string | null;
    onInvite: () => void; onReschedule: () => void; onCancel: () => void;
    onDelete?: () => void; onSeriesAction?: (action: 'edit' | 'delete' | 'cancel') => void;
}): JSX.Element {
    const { navigate, handleEdit, handleCancel, handleDelete } = useTopbarActions(!!recurrenceGroupId, eventId, onCancel, onDelete, onSeriesAction);
    return (
        <div className="event-detail-topbar">
            <button onClick={() => resolveBackNavigation(fromCalendar, navState, hasHistory, navigate)} className="event-detail-back" aria-label="Go back">
                {fromCalendar ? '\u2190 Back to Calendar' : '\u2190 Back'}
            </button>
            {isAuthenticated && !canManageRoster && !isCancelled && !isEnded && (
                <button onClick={onInvite} className="btn btn-primary btn-sm">Invite</button>
            )}
            {canManageRoster && !isCancelled && !isEnded && (
                <TopbarManagerButtons onInvite={onInvite} onReschedule={onReschedule} onEdit={handleEdit} onCancel={handleCancel} onDelete={handleDelete} />
            )}
            {canManageRoster && !isEnded && isCancelled && (
                <button onClick={handleDelete} className="btn btn-danger btn-sm">Delete Event</button>
            )}
        </div>
    );
}

/** Manager action buttons for event topbar. */
function TopbarManagerButtons({ onInvite, onReschedule, onEdit, onCancel, onDelete }: {
    onInvite: () => void; onReschedule: () => void; onEdit: () => void; onCancel: () => void; onDelete: () => void;
}) {
    return (
        <div className="grid grid-cols-2 gap-2 sm:flex">
            <button onClick={onInvite} className="btn btn-primary btn-sm">Invite</button>
            <button onClick={onReschedule} className="btn btn-secondary btn-sm">Reschedule</button>
            <button onClick={onEdit} className="btn btn-secondary btn-sm">Edit Event</button>
            <button onClick={onDelete} className="btn btn-danger btn-sm">Delete Event</button>
            <button onClick={onCancel} className="btn btn-danger btn-sm">Cancel Event</button>
        </div>
    );
}

/** Cancelled event banner */
export function CancelledBanner({ event, isCancelled }: {
    event: { cancelledAt?: string | null; cancellationReason?: string | null };
    isCancelled: boolean;
}): JSX.Element | null {
    if (!isCancelled || !event.cancelledAt) return null;
    return (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 mb-4">
            <div className="flex items-center gap-2 text-red-400 font-semibold text-sm">
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                </svg>
                This event has been cancelled
            </div>
            {event.cancellationReason && <p className="text-sm text-muted mt-1">Reason: {event.cancellationReason}</p>}
            <p className="text-xs text-dim mt-1">
                Cancelled on {new Intl.DateTimeFormat('en-US', {
                    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
                }).format(new Date(event.cancelledAt))}
            </p>
        </div>
    );
}

/** Post-event sections (attendance tracker + metrics link) */
export function PostEventSections({ event, eventId, isCancelled, isAdHoc, canManageRoster }: {
    event: { endTime: string };
    eventId: number;
    isCancelled: boolean;
    isAdHoc: boolean;
    canManageRoster: boolean;
}): JSX.Element | null {
    const isPast = event.endTime && new Date(event.endTime) < new Date();
    if (!isPast || isCancelled || isAdHoc || !canManageRoster) return null;
    return (
        <>
            <AttendanceTracker eventId={eventId} isOrganizer={canManageRoster} />
            <div className="flex justify-center">
                <Link
                    to={`/events/${eventId}/metrics`}
                    className="px-4 py-2 bg-surface hover:bg-panel text-emerald-400 hover:text-emerald-300 text-sm font-medium rounded-lg border border-edge transition-colors"
                >
                    View Event Metrics
                </Link>
            </div>
        </>
    );
}

/** Mobile quick info bar */
export function MobileQuickInfo({ event, roster, isSignedUp, alphabetical: sortFn }: {
    event: { startTime: string; game?: { id?: number } | null };
    roster: { count: number; signups: Array<{ id: number; user: { id: number; username: string; avatar?: string | null; discordId?: string | null; customAvatarUrl?: string | null; characters?: unknown[] } }> } | undefined;
    isSignedUp: boolean;
    alphabetical: (a: { user: { username: string } }, b: { user: { username: string } }) => number;
}): JSX.Element {
    const dateStr = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(event.startTime));
    const scrollToRoster = () => document.getElementById('event-roster-section')?.scrollIntoView({ behavior: 'smooth' });
    const avatarSignups = (roster?.signups?.length ?? 0) > 0
        ? [...roster!.signups].sort(sortFn).slice(0, 5).map(s => ({
            id: s.user.id, username: s.user.username, avatar: s.user.avatar ?? null,
            discordId: s.user.discordId ?? null, customAvatarUrl: s.user.customAvatarUrl ?? null,
        })) : null;

    return (
        <div className="md:hidden event-detail-quick-info">
            <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                    <p className="text-xs text-muted">{dateStr}</p>
                    <div className="flex items-center gap-2 mt-0.5 cursor-pointer group" onClick={scrollToRoster}>
                        <span className="text-sm font-semibold text-foreground group-hover:text-indigo-400 transition-colors">{roster?.count ?? 0} signed up</span>
                        {avatarSignups && <AttendeeAvatars signups={avatarSignups} gameId={event.game?.id ?? undefined} totalCount={roster!.count} maxVisible={5} size="md" />}
                    </div>
                </div>
                {isSignedUp && <span className="text-xs font-medium text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-full whitespace-nowrap shrink-0">&#10003; Signed up</span>}
            </div>
        </div>
    );
}

export function AutoSubToggle({ event, handlers }: { event: EventResponseDto; handlers: ReturnType<typeof useEventDetailHandlers> }) {
    const autoUnbench = event.autoUnbench ?? true;
    return (
        <div className={`event-detail-autosub-toggle ${handlers.updateAutoUnbench.isPending ? 'opacity-50 pointer-events-none' : ''}`}>
            <span className="text-xs text-gray-400 mr-2 whitespace-nowrap">Auto-sub</span>
            <div className="event-detail-autosub-toggle__track" role="switch" aria-checked={autoUnbench} tabIndex={0}
                onClick={() => !handlers.updateAutoUnbench.isPending && handlers.updateAutoUnbench.mutate(!autoUnbench)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handlers.updateAutoUnbench.mutate(!autoUnbench); } }}>
                <span className={`event-detail-autosub-toggle__option ${autoUnbench ? 'event-detail-autosub-toggle__option--active' : ''}`}>On</span>
                <span className={`event-detail-autosub-toggle__option ${!autoUnbench ? 'event-detail-autosub-toggle__option--active' : ''}`}>Off</span>
            </div>
        </div>
    );
}

export function SignedUpActions({ userSignup, handlers }: { userSignup: { status: string } | undefined; handlers: ReturnType<typeof useEventDetailHandlers> }) {
    return (
        <div className="flex items-center gap-1.5">
            {userSignup?.status === 'tentative'
                ? <button onClick={() => handlers.updateStatus.mutate('signed_up')} disabled={handlers.updateStatus.isPending} className="btn btn-primary btn-sm">Confirm</button>
                : <button onClick={() => { handlers.updateStatus.mutate('tentative'); toast.info('Marked as tentative'); }} disabled={handlers.updateStatus.isPending} className="btn btn-secondary btn-sm" title="Mark as tentative">Tentative</button>}
            <button onClick={handlers.handleCancel} disabled={handlers.cancelSignup.isPending} className="btn btn-danger btn-sm">{handlers.cancelSignup.isPending ? 'Leaving...' : 'Leave'}</button>
        </div>
    );
}
