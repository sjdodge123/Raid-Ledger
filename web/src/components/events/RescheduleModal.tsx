import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from '../../lib/toast';
import { Modal } from '../ui/modal';
import { BottomSheet } from '../ui/bottom-sheet';
import { GameTimeGrid } from '../features/game-time/GameTimeGrid';
import { useAggregateGameTime, useRescheduleEvent } from '../../hooks/use-reschedule';
import { useConvertEventToPlan } from '../../hooks/use-event-plans';
import { useMediaQuery } from '../../hooks/use-media-query';
import { DAYS, DURATION_PRESETS, formatHour, toLocalInput, nextOccurrence } from './reschedule-utils';
import { PollBanner, GridLegend, StartTimeInput, DurationSelector, ConfirmationBar } from './reschedule-controls';
import type { GameTimePreviewBlock, GameTimeEventBlock } from '../features/game-time/GameTimeGrid';

interface RescheduleModalProps {
    isOpen: boolean;
    onClose: () => void;
    eventId: number;
    currentStartTime: string;
    currentEndTime: string;
    eventTitle: string;
    gameSlug?: string | null;
    gameName?: string | null;
    coverUrl?: string | null;
    description?: string | null;
    creatorUsername?: string;
    signupCount?: number;
    initialReason?: string;
}

function useRescheduleState(currentStartTime: string, currentEndTime: string) {
    const currentStart = useMemo(() => new Date(currentStartTime), [currentStartTime]);
    const currentEnd = useMemo(() => new Date(currentEndTime), [currentEndTime]);
    const originalDurationMinutes = useMemo(
        () => Math.max(60, Math.round((currentEnd.getTime() - currentStart.getTime()) / (1000 * 60))),
        [currentStart, currentEnd],
    );

    const [newStartTime, setNewStartTime] = useState<string | null>(null);
    const [gridSelection, setGridSelection] = useState<{ day: number; hour: number } | null>(null);
    const [durationMinutes, setDurationMinutes] = useState(originalDurationMinutes);
    const [customDuration, setCustomDuration] = useState(
        () => !DURATION_PRESETS.some(p => p.minutes === originalDurationMinutes),
    );

    return {
        currentStart, newStartTime, setNewStartTime, gridSelection, setGridSelection,
        durationMinutes, setDurationMinutes, customDuration, setCustomDuration,
    };
}

function useCurrentEventBlocks(props: {
    eventId: number; eventTitle: string; gameSlug?: string | null; gameName?: string | null;
    coverUrl?: string | null; description?: string | null; creatorUsername?: string;
    signupCount?: number; dayOfWeek: number; hour: number; durationHours: number;
}) {
    return useMemo((): GameTimeEventBlock[] => [{
        eventId: props.eventId, title: props.eventTitle, gameSlug: props.gameSlug ?? null,
        gameName: props.gameName ?? null, coverUrl: props.coverUrl ?? null, signupId: 0,
        confirmationStatus: 'confirmed', dayOfWeek: props.dayOfWeek,
        startHour: props.hour, endHour: props.hour + props.durationHours,
        description: props.description ?? null, creatorUsername: props.creatorUsername ?? null,
        signupCount: props.signupCount,
    }], [props.eventId, props.eventTitle, props.gameSlug, props.gameName, props.coverUrl,
        props.dayOfWeek, props.hour, props.durationHours, props.description, props.creatorUsername, props.signupCount]);
}

function usePreviewBlocks(gridSelection: { day: number; hour: number } | null, durationHours: number, eventTitle: string, gameName?: string | null, gameSlug?: string | null, coverUrl?: string | null) {
    return useMemo((): GameTimePreviewBlock[] | undefined => {
        if (!gridSelection) return undefined;
        return [{ dayOfWeek: gridSelection.day, startHour: gridSelection.hour,
            endHour: gridSelection.hour + durationHours, label: 'New Time', variant: 'selected' as const,
            title: eventTitle, gameName: gameName ?? undefined, gameSlug: gameSlug ?? undefined, coverUrl: coverUrl,
        }];
    }, [gridSelection, durationHours, eventTitle, gameName, gameSlug, coverUrl]);
}

function GridBody(props: {
    isLoading: boolean; signupCount: number;
    currentEventBlocks: GameTimeEventBlock[]; previewBlocks: GameTimePreviewBlock[] | undefined;
    heatmapOverlay: unknown; onCellClick: (day: number, hour: number) => void;
}) {
    if (props.isLoading) {
        return <div className="flex items-center justify-center py-12 text-muted">Loading availability data...</div>;
    }
    if (props.signupCount === 0) {
        return <div className="flex items-center justify-center py-12 text-muted">No players signed up yet -- no availability data to display.</div>;
    }
    return (
        <>
            <p className="shrink-0 text-sm text-muted">
                Click a cell to select a new time, or enter it manually below. Green intensity shows player availability ({props.signupCount} signed up).
            </p>
            <div className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-edge">
                <GameTimeGrid slots={[]} readOnly compact noStickyOffset events={props.currentEventBlocks}
                    previewBlocks={props.previewBlocks} heatmapOverlay={props.heatmapOverlay} onCellClick={props.onCellClick} />
            </div>
        </>
    );
}

function parseTimes(newStartTime: string | null, durationMs: number) {
    const parsedStart = newStartTime ? new Date(newStartTime) : null;
    const parsedEnd = parsedStart && !isNaN(parsedStart.getTime()) ? new Date(parsedStart.getTime() + durationMs) : null;
    const isValid = !!(parsedStart && parsedEnd && !isNaN(parsedStart.getTime()) && parsedStart < parsedEnd && parsedStart > new Date());
    const summary = parsedStart && !isNaN(parsedStart.getTime())
        ? `${DAYS[parsedStart.getDay()]} at ${formatHour(parsedStart.getHours())}` : null;
    return { parsedStart, parsedEnd, isValid, summary };
}

/**
 * RescheduleModal (ROK-223)
 */
function useRescheduleModalData(eventId: number, isOpen: boolean, currentStartTime: string, currentEndTime: string, props: {
    eventTitle?: string; gameSlug?: string; gameName?: string; coverUrl?: string;
    description?: string; creatorUsername?: string; signupCount?: number;
}) {
    const { data: gameTimeData, isLoading } = useAggregateGameTime(eventId, isOpen);
    const s = useRescheduleState(currentStartTime, currentEndTime);
    const durationHours = Math.max(1, Math.round(s.durationMinutes / 60));
    const currentDayOfWeek = s.currentStart.getDay();
    const currentHour = s.currentStart.getHours();
    const signupCount = gameTimeData?.totalUsers ?? 0;
    const currentEventBlocks = useCurrentEventBlocks({
        eventId, eventTitle: props.eventTitle, gameSlug: props.gameSlug, gameName: props.gameName,
        coverUrl: props.coverUrl, description: props.description, creatorUsername: props.creatorUsername,
        signupCount: props.signupCount, dayOfWeek: currentDayOfWeek, hour: currentHour, durationHours,
    });
    const previewBlocks = usePreviewBlocks(s.gridSelection, durationHours, props.eventTitle, props.gameName, props.gameSlug, props.coverUrl);
    const parsed = parseTimes(s.newStartTime, s.durationMinutes * 60 * 1000);
    return { s, isLoading, signupCount, currentEventBlocks, previewBlocks, gameTimeData, currentDayOfWeek, currentHour, ...parsed };
}

async function handleRescheduleConfirm(
    d: ReturnType<typeof useRescheduleModalData>, reschedule: ReturnType<typeof useRescheduleEvent>, handleClose: () => void,
) {
    if (!d.parsedStart || !d.parsedEnd || !d.isValid) return;
    try { await reschedule.mutateAsync({ startTime: d.parsedStart.toISOString(), endTime: d.parsedEnd.toISOString() }); toast.success('Event rescheduled', { description: `Moved to ${d.summary}` }); handleClose(); }
    catch (err) { toast.error('Failed to reschedule', { description: err instanceof Error ? err.message : 'Please try again.' }); }
}

function RescheduleContent({ d, eventId, eventTitle, onClose, navigate }: {
    d: ReturnType<typeof useRescheduleModalData>; eventId: number; eventTitle?: string;
    onClose: () => void; navigate: ReturnType<typeof useNavigate>;
}) {
    const reschedule = useRescheduleEvent(eventId);
    const convertToPlan = useConvertEventToPlan();
    const handleClose = () => { d.s.setNewStartTime(null); d.s.setGridSelection(null); onClose(); };
    const handlePoll = async () => {
        try { await convertToPlan.mutateAsync({ eventId, options: { cancelOriginal: true } }); handleClose(); navigate('/events?tab=plans'); }
        catch { /* Error toast handled by mutation */ }
    };

    return (
        <RescheduleContentBody d={d} eventTitle={eventTitle} reschedule={reschedule}
            convertToPlan={convertToPlan} handleClose={handleClose} handlePoll={handlePoll} />
    );
}

function RescheduleContentBody({ d, eventTitle, reschedule, convertToPlan, handleClose, handlePoll }: {
    d: ReturnType<typeof useRescheduleModalData>; eventTitle?: string;
    reschedule: ReturnType<typeof useRescheduleEvent>; convertToPlan: ReturnType<typeof useConvertEventToPlan>;
    handleClose: () => void; handlePoll: () => void;
}) {
    return (
        <div className="flex flex-col gap-3 min-h-0 h-full">
            <PollBanner onPoll={handlePoll} isPending={convertToPlan.isPending} />
            <GridLegend hasSelection={!!d.s.gridSelection} />
            <GridBody isLoading={d.isLoading} signupCount={d.signupCount} currentEventBlocks={d.currentEventBlocks}
                previewBlocks={d.previewBlocks} heatmapOverlay={d.gameTimeData?.cells}
                onCellClick={(day, hour) => { if (day === d.currentDayOfWeek && hour === d.currentHour) return; d.s.setGridSelection({ day, hour }); d.s.setNewStartTime(toLocalInput(nextOccurrence(day, hour))); }} />
            <div className="shrink-0 pt-2 border-t border-border space-y-3">
                <div className="flex flex-col md:flex-row items-stretch md:items-end gap-3">
                    <StartTimeInput newStartTime={d.s.newStartTime} onStartChange={(v) => { d.s.setNewStartTime(v); d.s.setGridSelection(null); }} />
                    <DurationSelector durationMinutes={d.s.durationMinutes} setDurationMinutes={d.s.setDurationMinutes} customDuration={d.s.customDuration} setCustomDuration={d.s.setCustomDuration} />
                </div>
                {!!d.s.newStartTime && <ConfirmationBar eventTitle={eventTitle} isValid={d.isValid} parsedStart={d.parsedStart} parsedEnd={d.parsedEnd} selectionSummary={d.summary} signupCount={d.signupCount} isPending={reschedule.isPending} onClear={() => { d.s.setNewStartTime(null); d.s.setGridSelection(null); }} onConfirm={() => handleRescheduleConfirm(d, reschedule, handleClose)} />}
            </div>
        </div>
    );
}

export function RescheduleModal({
    isOpen, onClose, eventId, currentStartTime, currentEndTime, eventTitle,
    gameSlug, gameName, coverUrl, description, creatorUsername, signupCount: eventSignupCount,
}: RescheduleModalProps) {
    const navigate = useNavigate();
    const isMobile = useMediaQuery('(max-width: 767px)');
    const d = useRescheduleModalData(eventId, isOpen, currentStartTime, currentEndTime, { eventTitle, gameSlug, gameName, coverUrl, description, creatorUsername, signupCount: eventSignupCount });
    const handleClose = () => { d.s.setNewStartTime(null); d.s.setGridSelection(null); onClose(); };
    const content = <RescheduleContent d={d} eventId={eventId} eventTitle={eventTitle} onClose={onClose} navigate={navigate} />;

    if (isMobile) return <BottomSheet isOpen={isOpen} onClose={handleClose} title="Reschedule Event" maxHeight="85vh">{content}</BottomSheet>;
    return <Modal isOpen={isOpen} onClose={handleClose} title="Reschedule Event" maxWidth="max-w-4xl" bodyClassName="p-4 flex flex-col max-h-[calc(90vh-4rem)]">{content}</Modal>;
}
