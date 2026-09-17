import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from '../../lib/toast';
import { Modal } from '../ui/modal';
import { BottomSheet } from '../ui/bottom-sheet';
import { useAggregateGameTime, useRescheduleEvent } from '../../hooks/use-reschedule';
import { useCreateSchedulingPoll } from '../../hooks/use-standalone-poll';
import { useMediaQuery } from '../../hooks/use-media-query';
import { DAYS, DURATION_PRESETS, formatHour } from './reschedule-utils';
import { PollBanner, StartTimeInput, DurationSelector, ConfirmationBar } from './reschedule-controls';
import { RescheduleGrid } from './RescheduleGrid';
import { PHONE_MQ } from '../../lib/breakpoints';

interface RescheduleModalProps {
    isOpen: boolean;
    onClose: () => void;
    eventId: number;
    currentStartTime: string;
    currentEndTime: string;
    eventTitle: string;
    gameId?: number;
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

function parseTimes(newStartTime: string | null, durationMs: number) {
    const parsedStart = newStartTime ? new Date(newStartTime) : null;
    const parsedEnd = parsedStart && !isNaN(parsedStart.getTime()) ? new Date(parsedStart.getTime() + durationMs) : null;
    const isValid = !!(parsedStart && parsedEnd && !isNaN(parsedStart.getTime()) && parsedStart < parsedEnd && parsedStart > new Date());
    const summary = parsedStart && !isNaN(parsedStart.getTime())
        ? `${DAYS[parsedStart.getDay()]} at ${formatHour(parsedStart.getHours())}` : null;
    return { parsedStart, parsedEnd, isValid, summary };
}

/**
 * RescheduleModal (ROK-223) — availability picker is the shared week view (ROK-1588 R).
 */
function useRescheduleModalData(eventId: number, isOpen: boolean, currentStartTime: string, currentEndTime: string) {
    const { data: gameTimeData, isLoading } = useAggregateGameTime(eventId, isOpen);
    const s = useRescheduleState(currentStartTime, currentEndTime);
    const signupCount = gameTimeData?.totalUsers ?? 0;
    const parsed = parseTimes(s.newStartTime, s.durationMinutes * 60 * 1000);
    return { s, isLoading, signupCount, gameTimeData, ...parsed };
}

async function handleRescheduleConfirm(
    d: ReturnType<typeof useRescheduleModalData>, reschedule: ReturnType<typeof useRescheduleEvent>, handleClose: () => void,
) {
    if (!d.parsedStart || !d.parsedEnd || !d.isValid) return;
    try { await reschedule.mutateAsync({ startTime: d.parsedStart.toISOString(), endTime: d.parsedEnd.toISOString() }); toast.success('Event rescheduled', { description: `Moved to ${d.summary}` }); handleClose(); }
    catch (err) { toast.error('Failed to reschedule', { description: err instanceof Error ? err.message : 'Please try again.' }); }
}

function RescheduleContent({ d, eventId, eventTitle, gameId, onClose, navigate }: {
    d: ReturnType<typeof useRescheduleModalData>; eventId: number; eventTitle?: string;
    gameId?: number; onClose: () => void; navigate: ReturnType<typeof useNavigate>;
}) {
    const reschedule = useRescheduleEvent(eventId);
    const createPoll = useCreateSchedulingPoll();
    const handleClose = () => { d.s.setNewStartTime(null); d.s.setGridSelection(null); onClose(); };
    const handlePoll = async () => {
        if (!gameId) return;
        try {
            const result = await createPoll.mutateAsync({ gameId, linkedEventId: eventId });
            handleClose();
            navigate(`/community-lineup/${result.lineupId}/schedule/${result.id}`);
        } catch { /* Error toast handled by mutation */ }
    };

    return (
        <RescheduleContentBody d={d} eventId={eventId} eventTitle={eventTitle} reschedule={reschedule}
            createPoll={createPoll} handleClose={handleClose} handlePoll={handlePoll}
            pollDisabled={!gameId} />
    );
}

function RescheduleContentBody({ d, eventId, eventTitle, reschedule, createPoll, handleClose, handlePoll, pollDisabled }: {
    d: ReturnType<typeof useRescheduleModalData>; eventId: number; eventTitle?: string;
    reschedule: ReturnType<typeof useRescheduleEvent>; createPoll: ReturnType<typeof useCreateSchedulingPoll>;
    handleClose: () => void; handlePoll: () => void; pollDisabled: boolean;
}) {
    return (
        <div className="flex flex-col gap-3 min-h-0 h-full">
            <PollBanner onPoll={handlePoll} isPending={createPoll.isPending} disabled={pollDisabled} />
            <RescheduleGrid data={d.gameTimeData} isLoading={d.isLoading} currentStart={d.s.currentStart} eventId={eventId}
                picked={d.s.gridSelection ? d.parsedStart : null}
                onPick={(value, cell) => { d.s.setGridSelection({ day: cell.dayOfWeek, hour: cell.hour }); d.s.setNewStartTime(value); }} />
            <div className="shrink-0 pt-2 border-t border-edge space-y-3">
                <div className="flex flex-col md:flex-row items-stretch md:items-end gap-3">
                    <StartTimeInput newStartTime={d.s.newStartTime} onStartChange={(v) => { d.s.setNewStartTime(v); d.s.setGridSelection(null); }} />
                    <DurationSelector durationMinutes={d.s.durationMinutes} setDurationMinutes={d.s.setDurationMinutes} customDuration={d.s.customDuration} setCustomDuration={d.s.setCustomDuration} />
                </div>
                {!!d.s.newStartTime && <ConfirmationBar eventTitle={eventTitle ?? ''} isValid={d.isValid} parsedStart={d.parsedStart} parsedEnd={d.parsedEnd} selectionSummary={d.summary} signupCount={d.signupCount} isPending={reschedule.isPending} onClear={() => { d.s.setNewStartTime(null); d.s.setGridSelection(null); }} onConfirm={() => handleRescheduleConfirm(d, reschedule, handleClose)} />}
            </div>
        </div>
    );
}

export function RescheduleModal({
    isOpen, onClose, eventId, currentStartTime, currentEndTime, eventTitle,
    gameId,
}: RescheduleModalProps) {
    const navigate = useNavigate();
    const isMobile = useMediaQuery(PHONE_MQ);
    const d = useRescheduleModalData(eventId, isOpen, currentStartTime, currentEndTime);
    const handleClose = () => { d.s.setNewStartTime(null); d.s.setGridSelection(null); onClose(); };
    const content = <RescheduleContent d={d} eventId={eventId} eventTitle={eventTitle} gameId={gameId} onClose={onClose} navigate={navigate} />;

    if (isMobile) return <BottomSheet isOpen={isOpen} onClose={handleClose} title="Reschedule Event" maxHeight="85vh">{content}</BottomSheet>;
    return <Modal isOpen={isOpen} onClose={handleClose} title="Reschedule Event" maxWidth="max-w-5xl" bodyClassName="p-4 flex flex-col max-h-[calc(90vh-4rem)]">{content}</Modal>;
}
