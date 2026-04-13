import type { JSX } from 'react';
import { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { useEvent, useEventRoster } from '../hooks/use-events';
import { useAuth, isOperatorOrAdmin, type User } from '../hooks/use-auth';
import { useRoster } from '../hooks/use-roster';
import { EventBanner } from '../components/events/EventBanner';
import { isMMOSlotConfig } from '../utils/game-utils';
import type { EventResponseDto, EventRosterDto } from '@raid-ledger/contract';
import { useGameRegistry } from '../hooks/use-game-registry';
import { useMyCharacters } from '../hooks/use-characters';
import { getEventStatus } from '../lib/event-utils';
import { useNotifReadSync } from '../hooks/use-notif-read-sync';
import { PluginSlot } from '../plugins';
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
    SeriesScopeModalSection,
} from './event-detail/EventDetailModals';
import { useEventDetailHandlers } from './event-detail/use-event-detail-handlers';
import {
    EventDetailError,
    EventDetailFallbackSignup,
    EventDetailGameTimeWidget,
    EventDetailVoiceSection,
    EventDetailTopbar,
    CancelledBanner,
    PostEventSections,
    MobileQuickInfo,
} from './event-detail/EventDetailSubComponents';
import { RosterSlotSection } from './event-detail/EventDetailRosterSlot';
import { ActivityTimeline } from '../components/common/ActivityTimeline';
import './event-detail-page.css';

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

function useEventDetailDerived(event: EventResponseDto | undefined, roster: EventRosterDto | undefined, user: User | null | undefined, isAuthenticated: boolean) {
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
    const { data: rosterAssignments } = useRoster(event?.id ?? 0);
    const isInPool = isSignedUp && rosterAssignments?.pool.some(p => p.userId === user?.id);
    const canJoinSlot = isAuthenticated && (!isSignedUp || isInPool) && !isCancelled;
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

type EventDetailDerived = ReturnType<typeof useEventDetailDerived>;
type EventDetailHandlers = ReturnType<typeof useEventDetailHandlers>;
type ModalState = ReturnType<typeof useModalState>;

function EventDetailModals({ event, eventId, derived, handlers, showCancelModal, setShowCancelModal, showRescheduleModal, setShowRescheduleModal, showInviteModal, setShowInviteModal, seriesAction, setSeriesAction, roster, searchParams, setSearchParams }: {
    event: EventResponseDto; eventId: number; derived: EventDetailDerived; handlers: EventDetailHandlers;
    showCancelModal: boolean; setShowCancelModal: (v: boolean) => void; showRescheduleModal: boolean; setShowRescheduleModal: (v: boolean) => void;
    showInviteModal: boolean; setShowInviteModal: (v: boolean) => void;
    seriesAction: 'edit' | 'delete' | 'cancel' | null; setSeriesAction: (v: 'edit' | 'delete' | 'cancel' | null) => void;
    roster: EventRosterDto | undefined;
    searchParams: URLSearchParams; setSearchParams: ReturnType<typeof useSearchParams>[1];
}) {
    const deepLinkAction = searchParams.get('action');
    const deepLinkReason = searchParams.get('reason');
    const canDeepLink = derived.canManageRoster;
    const clearDeepLink = () => { if (deepLinkAction) setSearchParams({}, { replace: true }); };
    return (
        <>
            <ConfirmModalSection show={handlers.showConfirmModal} onClose={handlers.closeConfirmModal} onConfirm={handlers.handleSelectionConfirm} onSkip={handlers.handleSelectionSkip}
                isConfirming={handlers.signup.isPending} gameId={derived.gameRegistryEntry?.id ?? event.game?.id ?? undefined} gameName={event.game?.name ?? undefined}
                hasRoles={derived.gameRegistryEntry?.hasRoles ?? true} gameSlug={event.game?.slug ?? undefined} preSelectedRole={handlers.preSelectedRole} eventId={eventId} />
            <CancelModalSection show={showCancelModal || (canDeepLink && deepLinkAction === 'cancel')} eventId={eventId} eventTitle={event.title} signupCount={event.signupCount} gameId={event.game?.id} initialReason={deepLinkReason ?? undefined}
                onClose={() => { setShowCancelModal(false); clearDeepLink(); }} />
            <RescheduleModalSection show={showRescheduleModal || (canDeepLink && deepLinkAction === 'reschedule')} eventId={eventId} currentStartTime={event.startTime} currentEndTime={event.endTime}
                eventTitle={event.title} gameId={event.game?.id} gameSlug={event.game?.slug} gameName={event.game?.name} coverUrl={event.game?.coverUrl} description={event.description}
                creatorUsername={event.creator?.username} signupCount={event.signupCount} initialReason={deepLinkReason ?? undefined}
                onClose={() => { setShowRescheduleModal(false); clearDeepLink(); }} />
            <RemoveConfirmModal removeConfirm={handlers.removeConfirm} onClose={() => handlers.setRemoveConfirm(null)} onConfirm={handlers.handleConfirmRemoveFromEvent} isPending={handlers.adminRemoveUser.isPending} />
            <InviteModalSection show={showInviteModal} onClose={() => setShowInviteModal(false)} eventId={eventId} pugs={handlers.pugs} roster={roster} isMMOGame={derived.isMMOGame} />
            <SeriesScopeModalSection show={seriesAction !== null} action={seriesAction ?? 'edit'} eventId={eventId}
                onClose={() => setSeriesAction(null)} isPending={handlers.isSeriesPending}
                onSeriesConfirm={(action, scope) => {
                    if (action === 'cancel' && scope === 'this') {
                        setSeriesAction(null);
                        setShowCancelModal(true);
                        return;
                    }
                    handlers.handleSeriesConfirm(action, scope);
                }} />
        </>
    );
}

function useModalState() {
    const [searchParams, setSearchParams] = useSearchParams();
    const [showRescheduleModal, setShowRescheduleModal] = useState(false);
    const [showCancelModal, setShowCancelModal] = useState(false);
    const [showInviteModal, setShowInviteModal] = useState(false);
    const [seriesAction, setSeriesAction] = useState<'edit' | 'delete' | 'cancel' | null>(null);
    return { searchParams, setSearchParams, showRescheduleModal, setShowRescheduleModal, showCancelModal, setShowCancelModal, showInviteModal, setShowInviteModal, seriesAction, setSeriesAction };
}

type PageState = ReturnType<typeof useEventDetailPageState>;
type VoiceState = ReturnType<typeof useEventDetailVoice>;

function EventDetailBodySections({ page, voice, derived, handlers }: {
    page: PageState & { event: EventResponseDto }; voice: VoiceState; derived: EventDetailDerived; handlers: EventDetailHandlers;
}) {
    return (
        <>
            <PostEventSections event={page.event} eventId={page.eventId} isCancelled={derived.isCancelled} isAdHoc={voice.isAdHoc} canManageRoster={derived.canManageRoster} />
            <MobileQuickInfo event={page.event} roster={page.roster} isSignedUp={derived.isSignedUp} alphabetical={alphabetical} />
            {page.event.myConflicts && page.event.myConflicts.length > 0 && (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 mb-4">
                    <p className="text-sm text-amber-300">
                        {page.event.myConflicts.map(c => `You're already signed up for ${c.title} at this time`).join('. ')}
                    </p>
                </div>
            )}
            <RosterSlotSection event={page.event} eventId={page.eventId} roster={page.roster} rosterAssignments={derived.rosterAssignments}
                isAuthenticated={page.isAuthenticated} isSignedUp={derived.isSignedUp} userSignup={derived.userSignup}
                canManageRoster={derived.canManageRoster} canJoinSlot={!!derived.canJoinSlot} isMMOGame={derived.isMMOGame} handlers={handlers} user={page.user} />
            <EventDetailFallbackSignup rosterAssignments={derived.rosterAssignments} isAuthenticated={page.isAuthenticated} isSignedUp={derived.isSignedUp}
                isCancelled={derived.isCancelled} onSignup={handlers.handleSignup} isPending={handlers.signup.isPending} />
            <EventDetailGameTimeWidget rosterAssignments={derived.rosterAssignments} isAuthenticated={page.isAuthenticated} event={page.event} roster={page.roster} />
            <EventDetailVoiceSection showVoiceRoster={voice.showVoiceRoster} voiceRoster={voice.voiceRoster} isAdHoc={voice.isAdHoc} event={page.event} eventStatus={voice.eventStatus} />
            <EventDetailRoster roster={page.roster} event={page.event} />
            <ActivityTimeline entityType="event" entityId={page.eventId} />
            <PluginSlot name="event-detail:content-sections" context={{ contentInstances: page.event.contentInstances ?? [], eventId: page.eventId, gameSlug: page.event.game?.slug, characterId: derived.userSignup?.character?.id }} />
        </>
    );
}

function EventDetailBody({ page, voice, bannerRef, isBannerCollapsed, derived, handlers, modals }: {
    page: PageState & { event: EventResponseDto }; voice: VoiceState; bannerRef: React.RefObject<HTMLDivElement | null>;
    isBannerCollapsed: boolean; derived: EventDetailDerived; handlers: EventDetailHandlers; modals: ModalState;
}) {
    return (
        <div className="event-detail-page pb-20 md:pb-0">
            <EventDetailTopbar fromCalendar={page.fromCalendar} navState={page.navState} hasHistory={page.hasHistory} isAuthenticated={page.isAuthenticated}
                canManageRoster={derived.canManageRoster} isCancelled={derived.isCancelled} isEnded={derived.isEnded} eventId={page.eventId}
                recurrenceGroupId={page.event.recurrenceGroupId} onInvite={() => modals.setShowInviteModal(true)} onReschedule={() => modals.setShowRescheduleModal(true)}
                onCancel={() => modals.setShowCancelModal(true)} onDelete={handlers.handleDelete} onSeriesAction={modals.setSeriesAction} />
            <CancelledBanner event={page.event} isCancelled={derived.isCancelled} />
            <div ref={bannerRef}>
                <EventBanner title={page.event.title} game={page.event.game} startTime={page.event.startTime} endTime={page.event.endTime} creator={page.event.creator}
                    description={page.event.description} voiceChannelName={voice.voiceChannel?.name ?? null} voiceChannelUrl={voice.voiceChannel?.url ?? null}
                    recurrenceGroupId={page.event.recurrenceGroupId} />
            </div>
            {isBannerCollapsed && <EventBanner title={page.event.title} game={page.event.game} startTime={page.event.startTime} endTime={page.event.endTime} creator={page.event.creator} isCollapsed />}
            <EventDetailBodySections page={page} voice={voice} derived={derived} handlers={handlers} />
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

    return <EventDetailBody page={page as PageState & { event: EventResponseDto }} voice={voice} bannerRef={bannerRef} isBannerCollapsed={isBannerCollapsed} derived={derived} handlers={handlers} modals={modals} />;
}
