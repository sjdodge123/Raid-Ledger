import type { JSX } from 'react';
import { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate, useLocation, useSearchParams, Link } from 'react-router-dom';
import { toast } from '../lib/toast';
import { useEvent, useEventRoster } from '../hooks/use-events';
import { useAuth, isOperatorOrAdmin } from '../hooks/use-auth';
import { useRoster } from '../hooks/use-roster';
import { EventBanner } from '../components/events/EventBanner';
import { RosterBuilder } from '../components/roster';
import { AttendeeAvatars } from '../components/calendar/AttendeeAvatars';
import { isMMOSlotConfig } from '../utils/game-utils';
import type { EventResponseDto, EventRosterDto, RosterWithAssignments } from '@raid-ledger/contract';
import { useGameRegistry } from '../hooks/use-game-registry';
import { useMyCharacters } from '../hooks/use-characters';
import { getEventStatus } from '../lib/event-utils';
import { useNotifReadSync } from '../hooks/use-notif-read-sync';
import { GameTimeWidget } from '../components/features/game-time/GameTimeWidget';
import { PluginSlot } from '../plugins';
import { AttendanceTracker } from '../components/events/AttendanceTracker';
import { LiveBadge } from '../components/events/LiveBadge';
import { VoiceRoster } from '../components/events/VoiceRoster';
import { useVoiceRoster } from '../hooks/use-voice-roster';
import { fetchApi } from '../lib/api-client';
import { EventDetailSkeleton } from './event-detail/EventDetailSkeleton';
import { EventDetailRoster } from './event-detail/EventDetailRoster';
import { alphabetical } from './event-detail/event-detail-helpers';
import {
    ConfirmModalSection,
    CancelModalSection,
    RescheduleModalSection,
    InviteModalSection,
    RemoveConfirmModal,
} from './event-detail/EventDetailModals';
import { useEventDetailHandlers } from './event-detail/use-event-detail-handlers';
import './event-detail-page.css';

/**
 * Event Detail Page - ROK-184 Redesign
 *
 * Layout (Desktop):
 * - Full-width EventBanner at top
 * - Full-width Slot Grid (primary focus, above fold)
 * - Roster List below (grouped by status)
 * - Action buttons integrated
 */
function useVoiceChannelFetch(eventId: number, isAdHoc: boolean) {
    const [voiceChannel, setVoiceChannel] = useState<{ name: string; url: string } | null>(null);
    useEffect(() => {
        if (!eventId || isAdHoc) return;
        let cancelled = false;
        fetchApi<{ channelId: string | null; channelName: string | null; guildId: string | null }>(`/events/${eventId}/voice-channel`)
            .then((data) => {
                if (!cancelled && data?.channelName && data.channelId) {
                    setVoiceChannel({ name: data.channelName, url: data.guildId ? `discord://discord.com/channels/${data.guildId}/${data.channelId}` : '' });
                }
            })
            .catch(() => { /* ignore */ });
        return () => { cancelled = true; };
    }, [eventId, isAdHoc]);
    return voiceChannel;
}

function useBannerCollapse(event: EventResponseDto | undefined) {
    const bannerRef = useRef<HTMLDivElement>(null);
    const [isBannerCollapsed, setIsBannerCollapsed] = useState(false);
    useEffect(() => {
        const el = bannerRef.current;
        if (!el) return;
        const observer = new IntersectionObserver(([entry]) => setIsBannerCollapsed(!entry.isIntersecting), { threshold: 0, rootMargin: '-64px 0px 0px 0px' });
        observer.observe(el);
        return () => observer.disconnect();
    }, [event]);
    return { bannerRef, isBannerCollapsed };
}

function useEventDetailDerived(event: EventResponseDto | undefined, roster: EventRosterDto | undefined, user: { id: number } | null | undefined, isAuthenticated: boolean) {
    const { games } = useGameRegistry();
    const gameRegistryEntry = games.find((g) => g.id === event?.game?.id || g.slug === event?.game?.slug);
    const gameHasRoles = gameRegistryEntry?.hasRoles ?? event?.game?.hasRoles ?? false;
    const gameId = event?.game?.id;
    const { data: myCharsData } = useMyCharacters(gameId, !!gameId && !gameHasRoles);
    const shouldShowCharacterModal = !!gameId && (gameHasRoles || (myCharsData?.data?.length ?? 0) > 0);

    const userSignup = roster?.signups.find(s => s.user.id === user?.id);
    const isSignedUp = !!userSignup;
    const isEventCreator = user?.id != null && event?.creator?.id != null && user.id === event.creator.id;
    const canManageRoster = isEventCreator || isOperatorOrAdmin(user);

    const isCancelled = !!event?.cancelledAt;
    const isEnded = event ? getEventStatus(event.startTime, event.endTime) === 'ended' : false;
    const { data: rosterAssignments } = useRoster(Number(event?.id ?? 0));
    const isInPool = isSignedUp && rosterAssignments?.pool.some(p => p.userId === user?.id);
    const canJoinSlot = isAuthenticated && (!isSignedUp || isInPool) && !canManageRoster && !isCancelled;
    const isMMOGame = isMMOSlotConfig(rosterAssignments?.slots);

    return { gameRegistryEntry, shouldShowCharacterModal, userSignup, isSignedUp, canManageRoster, isCancelled, isEnded, rosterAssignments, canJoinSlot, isMMOGame };
}

function useEventDetailPageState() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const location = useLocation();
    const eventId = Number(id);
    useNotifReadSync();

    const navState = location.state as { fromCalendar?: boolean; calendarDate?: string; calendarView?: string } | null;
    const fromCalendar = navState?.fromCalendar === true && !!navState?.calendarDate;
    const hasHistory = location.key !== 'default';

    const { user, isAuthenticated } = useAuth();
    const { data: event, isLoading: eventLoading, error: eventError } = useEvent(eventId);
    const { data: roster } = useEventRoster(eventId);

    return { eventId, navigate, navState, fromCalendar, hasHistory, user, isAuthenticated, event, eventLoading, eventError, roster };
}

function useEventDetailVoice(event: EventResponseDto | undefined, eventId: number) {
    const isAdHoc = event?.isAdHoc ?? false;
    const eventStatus = event ? getEventStatus(event.startTime, event.endTime) : null;
    const showVoiceRoster = isAdHoc || eventStatus === 'live';
    const voiceRoster = useVoiceRoster(showVoiceRoster ? eventId : null);
    const voiceChannel = useVoiceChannelFetch(eventId, isAdHoc);
    return { isAdHoc, eventStatus, showVoiceRoster, voiceRoster, voiceChannel };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function EventDetailModals({ event, eventId, derived, handlers, showCancelModal, setShowCancelModal, showRescheduleModal, setShowRescheduleModal, showInviteModal, setShowInviteModal, roster, searchParams, setSearchParams }: any) {
    const deepLinkAction = searchParams.get('action');
    const deepLinkReason = searchParams.get('reason');
    const canDeepLink = derived.canManageRoster;
    const clearDeepLink = () => { if (deepLinkAction) setSearchParams({}, { replace: true }); };
    return (
        <>
            <ConfirmModalSection show={handlers.showConfirmModal} onClose={handlers.closeConfirmModal} onConfirm={handlers.handleSelectionConfirm} onSkip={handlers.handleSelectionSkip}
                isConfirming={handlers.signup.isPending} gameId={derived.gameRegistryEntry?.id ?? event.game?.id ?? undefined} gameName={event.game?.name ?? undefined}
                hasRoles={derived.gameRegistryEntry?.hasRoles ?? true} gameSlug={event.game?.slug ?? undefined} preSelectedRole={handlers.preSelectedRole} eventId={eventId} />
            <CancelModalSection show={showCancelModal || (canDeepLink && deepLinkAction === 'cancel')} eventId={eventId} eventTitle={event.title} signupCount={event.signupCount} initialReason={deepLinkReason ?? undefined}
                onClose={() => { setShowCancelModal(false); clearDeepLink(); }} />
            <RescheduleModalSection show={showRescheduleModal || (canDeepLink && deepLinkAction === 'reschedule')} eventId={eventId} currentStartTime={event.startTime} currentEndTime={event.endTime}
                eventTitle={event.title} gameSlug={event.game?.slug} gameName={event.game?.name} coverUrl={event.game?.coverUrl} description={event.description}
                creatorUsername={event.creator?.username} signupCount={event.signupCount} initialReason={deepLinkReason ?? undefined}
                onClose={() => { setShowRescheduleModal(false); clearDeepLink(); }} />
            <RemoveConfirmModal removeConfirm={handlers.removeConfirm} onClose={() => handlers.setRemoveConfirm(null)} onConfirm={handlers.handleConfirmRemoveFromEvent} isPending={handlers.adminRemoveUser.isPending} />
            <InviteModalSection show={showInviteModal} onClose={() => setShowInviteModal(false)} eventId={eventId} pugs={handlers.pugs} roster={roster} isMMOGame={derived.isMMOGame} />
        </>
    );
}

function useModalState() {
    const [searchParams, setSearchParams] = useSearchParams();
    const [showRescheduleModal, setShowRescheduleModal] = useState(false);
    const [showCancelModal, setShowCancelModal] = useState(false);
    const [showInviteModal, setShowInviteModal] = useState(false);
    return { searchParams, setSearchParams, showRescheduleModal, setShowRescheduleModal, showCancelModal, setShowCancelModal, showInviteModal, setShowInviteModal };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function EventDetailBody({ page, voice, bannerRef, isBannerCollapsed, derived, handlers, modals }: any) {
    return (
        <div className="event-detail-page pb-20 md:pb-0">
            <EventDetailTopbar fromCalendar={page.fromCalendar} navState={page.navState} hasHistory={page.hasHistory} isAuthenticated={page.isAuthenticated}
                canManageRoster={derived.canManageRoster} isCancelled={derived.isCancelled} isEnded={derived.isEnded} eventId={page.eventId}
                onInvite={() => modals.setShowInviteModal(true)} onReschedule={() => modals.setShowRescheduleModal(true)} onCancel={() => modals.setShowCancelModal(true)} />
            <CancelledBanner event={page.event} isCancelled={derived.isCancelled} />
            <div ref={bannerRef}>
                <EventBanner title={page.event.title} game={page.event.game} startTime={page.event.startTime} endTime={page.event.endTime} creator={page.event.creator}
                    description={page.event.description} voiceChannelName={voice.voiceChannel?.name ?? null} voiceChannelUrl={voice.voiceChannel?.url ?? null} />
            </div>
            <PostEventSections event={page.event} eventId={page.eventId} isCancelled={derived.isCancelled} isAdHoc={voice.isAdHoc} canManageRoster={derived.canManageRoster} />
            <MobileQuickInfo event={page.event} roster={page.roster} isSignedUp={derived.isSignedUp} alphabetical={alphabetical} />
            {isBannerCollapsed && <EventBanner title={page.event.title} game={page.event.game} startTime={page.event.startTime} endTime={page.event.endTime} creator={page.event.creator} isCollapsed />}
            <RosterSlotSection event={page.event} eventId={page.eventId} roster={page.roster} rosterAssignments={derived.rosterAssignments}
                isAuthenticated={page.isAuthenticated} isSignedUp={derived.isSignedUp} userSignup={derived.userSignup}
                canManageRoster={derived.canManageRoster} canJoinSlot={!!derived.canJoinSlot} isMMOGame={derived.isMMOGame} handlers={handlers} user={page.user} />
            <EventDetailFallbackSignup rosterAssignments={derived.rosterAssignments} isAuthenticated={page.isAuthenticated} isSignedUp={derived.isSignedUp}
                isCancelled={derived.isCancelled} onSignup={handlers.handleSignup} isPending={handlers.signup.isPending} />
            <EventDetailGameTimeWidget rosterAssignments={derived.rosterAssignments} isAuthenticated={page.isAuthenticated} event={page.event} roster={page.roster} />
            <EventDetailVoiceSection showVoiceRoster={voice.showVoiceRoster} voiceRoster={voice.voiceRoster} isAdHoc={voice.isAdHoc} event={page.event} eventStatus={voice.eventStatus} />
            <EventDetailRoster roster={page.roster} event={page.event} />
            <PluginSlot name="event-detail:content-sections" context={{ contentInstances: page.event.contentInstances ?? [], eventId: page.eventId, gameSlug: page.event.game?.slug, characterId: derived.userSignup?.character?.id }} />
            <EventDetailModals event={page.event} eventId={page.eventId} derived={derived} handlers={handlers} roster={page.roster} {...modals} />
        </div>
    );
}

export function EventDetailPage(): JSX.Element | null {
    const page = useEventDetailPageState();
    const voice = useEventDetailVoice(page.event, page.eventId);
    const { bannerRef, isBannerCollapsed } = useBannerCollapse(page.event);
    const derived = useEventDetailDerived(page.event, page.roster, page.user, page.isAuthenticated);
    const modals = useModalState();
    const handlers = useEventDetailHandlers(page.eventId, { canManageRoster: derived.canManageRoster, isAuthenticated: page.isAuthenticated, shouldShowCharacterModal: derived.shouldShowCharacterModal });

    if (page.eventError) return <EventDetailError message={page.eventError.message} onBack={() => page.navigate('/calendar')} />;
    if (page.eventLoading) return <div className="event-detail-page"><EventDetailSkeleton /></div>;
    if (!page.event) return null;

    return <EventDetailBody page={page} voice={voice} bannerRef={bannerRef} isBannerCollapsed={isBannerCollapsed} derived={derived} handlers={handlers} modals={modals} />;
}

function EventDetailError({ message, onBack }: { message: string; onBack: () => void }) {
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

function EventDetailFallbackSignup({ rosterAssignments, isAuthenticated, isSignedUp, isCancelled, onSignup, isPending }: {
    rosterAssignments: unknown; isAuthenticated: boolean; isSignedUp: boolean; isCancelled: boolean; onSignup: () => void; isPending: boolean;
}) {
    if (rosterAssignments || !isAuthenticated || isSignedUp || isCancelled) return null;
    return (
        <div className="event-detail-signup-fallback">
            <button onClick={onSignup} disabled={isPending} className="btn btn-primary">{isPending ? 'Signing up...' : 'Sign Up for Event'}</button>
        </div>
    );
}

function EventDetailGameTimeWidget({ rosterAssignments, isAuthenticated, event, roster }: {
    rosterAssignments: unknown; isAuthenticated: boolean; event: EventResponseDto; roster: EventRosterDto | undefined;
}) {
    if (rosterAssignments || !isAuthenticated || !event.startTime || !event.endTime) return null;
    return (
        <GameTimeWidget eventStartTime={event.startTime} eventEndTime={event.endTime} eventTitle={event.title} gameName={event.game?.name}
            gameSlug={event.game?.slug} coverUrl={event.game?.coverUrl} description={event.description} creatorUsername={event.creator?.username}
            attendees={roster?.signups.slice(0, 6).map(s => ({ id: s.id, username: s.user.username, avatar: s.user.avatar ?? null }))} attendeeCount={roster?.count} />
    );
}

function EventDetailVoiceSection({ showVoiceRoster, voiceRoster, isAdHoc, event, eventStatus }: {
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

// ---- Extracted inline sub-components (kept in same file for import simplicity) ----

function resolveBackNavigation(fromCalendar: boolean, navState: { calendarDate?: string; calendarView?: string } | null, hasHistory: boolean, navigate: ReturnType<typeof useNavigate>) {
    if (fromCalendar) {
        const params = new URLSearchParams();
        if (navState?.calendarDate) params.set('date', navState.calendarDate);
        if (navState?.calendarView) params.set('view', navState.calendarView);
        navigate(`/calendar?${params.toString()}`);
    } else if (hasHistory) { navigate(-1); }
    else { navigate('/calendar'); }
}

/** Top bar with back + action buttons */
function EventDetailTopbar({ fromCalendar, navState, hasHistory, isAuthenticated, canManageRoster, isCancelled, isEnded, eventId, onInvite, onReschedule, onCancel }: {
    fromCalendar: boolean; navState: { calendarDate?: string; calendarView?: string } | null;
    hasHistory: boolean; isAuthenticated: boolean; canManageRoster: boolean; isCancelled: boolean;
    isEnded: boolean; eventId: number; onInvite: () => void; onReschedule: () => void; onCancel: () => void;
}): JSX.Element {
    const navigate = useNavigate();
    return (
        <div className="event-detail-topbar">
            <button onClick={() => resolveBackNavigation(fromCalendar, navState, hasHistory, navigate)} className="event-detail-back" aria-label="Go back">
                {fromCalendar ? '\u2190 Back to Calendar' : '\u2190 Back'}
            </button>
            {isAuthenticated && !canManageRoster && !isCancelled && !isEnded && (
                <button onClick={onInvite} className="btn btn-primary btn-sm">Invite</button>
            )}
            {canManageRoster && !isCancelled && !isEnded && (
                <div className="grid grid-cols-2 gap-2 sm:flex">
                    <button onClick={onInvite} className="btn btn-primary btn-sm">Invite</button>
                    <button onClick={onReschedule} className="btn btn-secondary btn-sm">Reschedule</button>
                    <button onClick={() => navigate(`/events/${eventId}/edit`)} className="btn btn-secondary btn-sm">Edit Event</button>
                    <button onClick={onCancel} className="btn btn-danger btn-sm">Cancel Event</button>
                </div>
            )}
        </div>
    );
}

/** Cancelled event banner */
function CancelledBanner({ event, isCancelled }: {
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
function PostEventSections({ event, eventId, isCancelled, isAdHoc, canManageRoster }: {
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
function MobileQuickInfo({ event, roster, isSignedUp, alphabetical: sortFn }: {
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

function AutoSubToggle({ event, handlers }: { event: EventResponseDto; handlers: ReturnType<typeof useEventDetailHandlers> }) {
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

function SignedUpActions({ userSignup, handlers }: { userSignup: { status: string } | undefined; handlers: ReturnType<typeof useEventDetailHandlers> }) {
    return (
        <div className="flex items-center gap-1.5">
            {userSignup?.status === 'tentative'
                ? <button onClick={() => handlers.updateStatus.mutate('signed_up')} disabled={handlers.updateStatus.isPending} className="btn btn-primary btn-sm">Confirm</button>
                : <button onClick={() => { handlers.updateStatus.mutate('tentative'); toast.info('Marked as tentative'); }} disabled={handlers.updateStatus.isPending} className="btn btn-secondary btn-sm" title="Mark as tentative">Tentative</button>}
            <button onClick={handlers.handleCancel} disabled={handlers.cancelSignup.isPending} className="btn btn-danger btn-sm">{handlers.cancelSignup.isPending ? 'Leaving...' : 'Leave'}</button>
        </div>
    );
}

function RosterSlotHeader({ event, canManageRoster, canJoinSlot, isMMOGame, isAuthenticated, isSignedUp, userSignup, handlers }: {
    event: EventResponseDto; canManageRoster: boolean; canJoinSlot: boolean; isMMOGame: boolean;
    isAuthenticated: boolean; isSignedUp: boolean; userSignup: { status: string } | undefined; handlers: ReturnType<typeof useEventDetailHandlers>;
}) {
    return (
        <div className="event-detail-slots__header">
            <h2>
                Roster Slots
                {canManageRoster && <span className="badge badge--indigo hidden md:inline-flex">Click slot to assign</span>}
                {canJoinSlot && <span className="badge badge--green hidden md:inline-flex">Click to Join</span>}
            </h2>
            <div className="flex items-center gap-2">
                {canManageRoster && !isMMOGame && <AutoSubToggle event={event} handlers={handlers} />}
                {!isAuthenticated && <Link to="/login" className="btn btn-primary btn-sm">Login to Join</Link>}
                {canJoinSlot && <button onClick={handlers.handleSignup} disabled={handlers.signup.isPending} className="btn btn-primary btn-sm">{handlers.signup.isPending ? 'Joining...' : 'Join Event'}</button>}
                {isSignedUp && <SignedUpActions userSignup={userSignup} handlers={handlers} />}
            </div>
        </div>
    );
}

function buildStickyExtra(isAuthenticated: boolean, event: EventResponseDto, roster: EventRosterDto | undefined) {
    if (!isAuthenticated || !event.startTime || !event.endTime) return undefined;
    return (
        <GameTimeWidget eventStartTime={event.startTime} eventEndTime={event.endTime} eventTitle={event.title}
            gameName={event.game?.name} gameSlug={event.game?.slug} coverUrl={event.game?.coverUrl} description={event.description}
            creatorUsername={event.creator?.username}
            attendees={roster?.signups.slice(0, 6).map(s => ({ id: s.id, username: s.user.username, avatar: s.user.avatar ?? null }))}
            attendeeCount={roster?.count} />
    );
}

/** Roster slot section with RosterBuilder */
function RosterSlotSection({ event, eventId, roster, rosterAssignments, isAuthenticated, isSignedUp, userSignup, canManageRoster, canJoinSlot, isMMOGame, handlers, user }: {
    event: EventResponseDto; eventId: number; roster: EventRosterDto | undefined; rosterAssignments: RosterWithAssignments | undefined;
    isAuthenticated: boolean; isSignedUp: boolean; userSignup: { status: string } | undefined;
    canManageRoster: boolean; canJoinSlot: boolean; isMMOGame: boolean; handlers: ReturnType<typeof useEventDetailHandlers>; user: { id: number } | null | undefined;
}): JSX.Element | null {
    if (!rosterAssignments) return null;
    return (
        <div className="event-detail-slots" id="event-roster-section">
            <RosterSlotHeader event={event} canManageRoster={canManageRoster} canJoinSlot={canJoinSlot} isMMOGame={isMMOGame}
                isAuthenticated={isAuthenticated} isSignedUp={isSignedUp} userSignup={userSignup} handlers={handlers} />
            <RosterBuilder pool={rosterAssignments.pool as never} assignments={rosterAssignments.assignments as never} slots={rosterAssignments.slots as never}
                onRosterChange={handlers.handleRosterChange as never} canEdit={canManageRoster} onSlotClick={handlers.handleSlotClick} canJoin={canJoinSlot}
                signupSucceeded={handlers.signup.isSuccess} currentUserId={user?.id}
                onSelfRemove={isSignedUp && !canManageRoster ? handlers.handleSelfRemove : undefined}
                onGenerateInviteLink={canManageRoster ? handlers.handleGenerateInviteLink : undefined}
                pugs={handlers.pugs} onRemovePug={canManageRoster ? handlers.handleRemovePug : undefined}
                onRegeneratePugLink={canManageRoster ? handlers.handleRegeneratePugLink : undefined} eventId={eventId}
                onRemoveFromEvent={canManageRoster ? handlers.handleRemoveFromEvent : undefined}
                gameId={event.game?.id} isMMOEvent={isMMOGame} stickyExtra={buildStickyExtra(isAuthenticated, event, roster)} />
        </div>
    );
}
