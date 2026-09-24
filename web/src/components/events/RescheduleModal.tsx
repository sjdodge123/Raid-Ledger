import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from '../../lib/toast';
import { Modal } from '../ui/modal';
import { BottomSheet } from '../ui/bottom-sheet';
import { useAggregateGameTime, useRescheduleEvent } from '../../hooks/use-reschedule';
import { useCreateSchedulingPoll } from '../../hooks/use-standalone-poll';
import { useMediaQuery } from '../../hooks/use-media-query';
import { useDirtyCloseGuard } from '../../hooks/use-dirty-close-guard';
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
    // null = follow the event's own duration, so a Discard (or the event moving) never leaves a stale pick behind.
    const [durationPick, setDurationMinutes] = useState<number | null>(null);
    const [customPick, setCustomDuration] = useState<boolean | null>(null);
    const durationMinutes = durationPick ?? originalDurationMinutes;
    const customDuration = customPick ?? !DURATION_PRESETS.some(p => p.minutes === originalDurationMinutes);
    const isDirty = newStartTime !== null || durationMinutes !== originalDurationMinutes;
    const reset = () => { setNewStartTime(null); setGridSelection(null); setDurationMinutes(null); setCustomDuration(null); };

    return {
        currentStart, newStartTime, setNewStartTime, gridSelection, setGridSelection,
        durationMinutes, setDurationMinutes, customDuration, setCustomDuration, isDirty, reset,
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

function RescheduleContent({ d, eventId, gameId, handleClose, navigate }: {
    d: ReturnType<typeof useRescheduleModalData>; eventId: number;
    gameId?: number; handleClose: () => void; navigate: ReturnType<typeof useNavigate>;
}) {
    const createPoll = useCreateSchedulingPoll();
    const handlePoll = async () => {
        if (!gameId) return;
        try {
            const result = await createPoll.mutateAsync({ gameId, linkedEventId: eventId });
            handleClose(); // success closes directly — nothing is left to discard
            navigate(`/community-lineup/${result.lineupId}/schedule/${result.id}`);
        } catch { /* Error toast handled by mutation */ }
    };

    return (
        <div className="flex flex-col gap-3 min-h-0 h-full">
            <PollBanner onPoll={handlePoll} isPending={createPoll.isPending} disabled={!gameId} />
            <RescheduleGrid data={d.gameTimeData} isLoading={d.isLoading} currentStart={d.s.currentStart} eventId={eventId}
                picked={d.s.gridSelection ? d.parsedStart : null}
                onPick={(value, cell) => { d.s.setGridSelection({ day: cell.dayOfWeek, hour: cell.hour }); d.s.setNewStartTime(value); }} />
            <div className="shrink-0 pt-2 border-t border-edge flex flex-col md:flex-row items-stretch md:items-end gap-3">
                <StartTimeInput newStartTime={d.s.newStartTime} onStartChange={(v) => { d.s.setNewStartTime(v); d.s.setGridSelection(null); }} />
                <DurationSelector durationMinutes={d.s.durationMinutes} setDurationMinutes={d.s.setDurationMinutes} customDuration={d.s.customDuration} setCustomDuration={d.s.setCustomDuration} />
            </div>
        </div>
    );
}

/** The pinned footer (ROK-1655 AC2): the confirmation bar, outside the scroll body. */
function RescheduleFooter({ d, eventTitle, reschedule, handleClose }: {
    d: ReturnType<typeof useRescheduleModalData>; eventTitle?: string;
    reschedule: ReturnType<typeof useRescheduleEvent>; handleClose: () => void;
}) {
    return (
        <div className="w-full">
            <ConfirmationBar eventTitle={eventTitle ?? ''} isValid={d.isValid} parsedStart={d.parsedStart} parsedEnd={d.parsedEnd}
                selectionSummary={d.summary} signupCount={d.signupCount} isPending={reschedule.isPending}
                onClear={() => { d.s.setNewStartTime(null); d.s.setGridSelection(null); }}
                onConfirm={() => handleRescheduleConfirm(d, reschedule, handleClose)} />
        </div>
    );
}

/**
 * ROK-1655: Esc, the backdrop, × and (phone) swipe-down go through the dirty-close
 * guard; a successful reschedule or poll closes directly via `handleClose`.
 */
export function RescheduleModal({
    isOpen, onClose, eventId, currentStartTime, currentEndTime, eventTitle,
    gameId,
}: RescheduleModalProps) {
    const navigate = useNavigate();
    const isMobile = useMediaQuery(PHONE_MQ);
    const d = useRescheduleModalData(eventId, isOpen, currentStartTime, currentEndTime);
    const reschedule = useRescheduleEvent(eventId);
    const handleClose = () => { d.s.reset(); onClose(); };
    const closeGuard = useDirtyCloseGuard(d.s.isDirty, handleClose);
    const content = <RescheduleContent d={d} eventId={eventId} gameId={gameId} handleClose={handleClose} navigate={navigate} />;
    const footer = d.s.newStartTime
        ? <RescheduleFooter d={d} eventTitle={eventTitle} reschedule={reschedule} handleClose={handleClose} /> : undefined;
    const frame = { isOpen, onClose: handleClose, title: 'Reschedule Event', footer, closeGuard };

    if (isMobile) return <BottomSheet {...frame} maxHeight="85vh">{content}</BottomSheet>;
    return <Modal {...frame} maxWidth="max-w-5xl" bodyClassName="p-4 flex flex-col">{content}</Modal>;
}
