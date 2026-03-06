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

/**
 * RescheduleModal (ROK-223)
 */
export function RescheduleModal({
    isOpen, onClose, eventId, currentStartTime, currentEndTime, eventTitle,
    gameSlug, gameName, coverUrl, description, creatorUsername, signupCount: eventSignupCount,
}: RescheduleModalProps) {
    const { data: gameTimeData, isLoading } = useAggregateGameTime(eventId, isOpen);
    const reschedule = useRescheduleEvent(eventId);
    const convertToPlan = useConvertEventToPlan();
    const navigate = useNavigate();
    const isMobile = useMediaQuery('(max-width: 767px)');

    const [newStartTime, setNewStartTime] = useState<string | null>(null);
    const [gridSelection, setGridSelection] = useState<{ day: number; hour: number } | null>(null);

    const currentStart = useMemo(() => new Date(currentStartTime), [currentStartTime]);
    const currentEnd = useMemo(() => new Date(currentEndTime), [currentEndTime]);
    const originalDurationMinutes = useMemo(
        () => Math.max(60, Math.round((currentEnd.getTime() - currentStart.getTime()) / (1000 * 60))),
        [currentStart, currentEnd],
    );
    const currentDayOfWeek = currentStart.getDay();
    const currentHour = currentStart.getHours();

    const [durationMinutes, setDurationMinutes] = useState(originalDurationMinutes);
    const [customDuration, setCustomDuration] = useState(
        () => !DURATION_PRESETS.some(p => p.minutes === originalDurationMinutes),
    );

    const durationMs = durationMinutes * 60 * 1000;
    const durationHours = Math.max(1, Math.round(durationMinutes / 60));

    const currentEventBlocks = useMemo((): GameTimeEventBlock[] => [{
        eventId, title: eventTitle, gameSlug: gameSlug ?? null, gameName: gameName ?? null,
        coverUrl: coverUrl ?? null, signupId: 0, confirmationStatus: 'confirmed',
        dayOfWeek: currentDayOfWeek, startHour: currentHour, endHour: currentHour + durationHours,
        description: description ?? null, creatorUsername: creatorUsername ?? null, signupCount: eventSignupCount,
    }], [eventId, eventTitle, gameSlug, gameName, coverUrl, currentDayOfWeek, currentHour, durationHours, description, creatorUsername, eventSignupCount]);

    const previewBlocks = useMemo(() => {
        if (!gridSelection) return undefined;
        const blocks: GameTimePreviewBlock[] = [{
            dayOfWeek: gridSelection.day, startHour: gridSelection.hour,
            endHour: gridSelection.hour + durationHours, label: 'New Time', variant: 'selected',
            title: eventTitle, gameName: gameName ?? undefined, gameSlug: gameSlug ?? undefined, coverUrl: coverUrl,
        }];
        return blocks;
    }, [gridSelection, durationHours, eventTitle, gameName, gameSlug, coverUrl]);

    const handleCellClick = (dayOfWeek: number, hour: number) => {
        if (dayOfWeek === currentDayOfWeek && hour === currentHour) return;
        setGridSelection({ day: dayOfWeek, hour });
        setNewStartTime(toLocalInput(nextOccurrence(dayOfWeek, hour)));
    };

    const handleStartChange = (value: string) => { setNewStartTime(value); setGridSelection(null); };

    const parsedStart = newStartTime ? new Date(newStartTime) : null;
    const parsedEnd = parsedStart && !isNaN(parsedStart.getTime()) ? new Date(parsedStart.getTime() + durationMs) : null;
    const hasSelection = !!newStartTime;
    const isValid = parsedStart && parsedEnd && !isNaN(parsedStart.getTime()) && parsedStart < parsedEnd && parsedStart > new Date();

    const handleConfirm = async () => {
        if (!parsedStart || !parsedEnd || !isValid) return;
        try {
            await reschedule.mutateAsync({ startTime: parsedStart.toISOString(), endTime: parsedEnd.toISOString() });
            toast.success('Event rescheduled', { description: `Moved to ${DAYS[parsedStart.getDay()]} at ${formatHour(parsedStart.getHours())}` });
            setNewStartTime(null); setGridSelection(null); onClose();
        } catch (err) {
            toast.error('Failed to reschedule', { description: err instanceof Error ? err.message : 'Please try again.' });
        }
    };

    const handleClose = () => { setNewStartTime(null); setGridSelection(null); onClose(); };

    const handlePollForBestTime = async () => {
        try {
            await convertToPlan.mutateAsync({ eventId, options: { cancelOriginal: true } });
            handleClose(); navigate('/events?tab=plans');
        } catch { /* Error toast handled by mutation */ }
    };

    const signupCount = gameTimeData?.totalUsers ?? 0;
    const selectionSummary = parsedStart && !isNaN(parsedStart.getTime())
        ? `${DAYS[parsedStart.getDay()]} at ${formatHour(parsedStart.getHours())}` : null;

    const content = (
        <div className="flex flex-col gap-3 min-h-0 h-full">
            <div className="shrink-0 flex flex-col sm:flex-row items-start sm:items-center gap-2 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2.5">
                <p className="text-sm text-foreground flex-1">Let your community decide -- post a Discord poll for the best time</p>
                <button onClick={handlePollForBestTime} disabled={convertToPlan.isPending}
                    className="shrink-0 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed px-3 py-1.5 text-sm font-medium text-white transition-colors">
                    {convertToPlan.isPending ? 'Converting...' : 'Poll for Best Time'}
                </button>
            </div>

            <div className="shrink-0 flex items-center gap-4 text-xs text-muted">
                {gridSelection && (
                    <div className="flex items-center gap-1.5">
                        <div className="w-3 h-3 rounded-sm border-2 border-solid" style={{ borderColor: 'rgba(6, 182, 212, 0.95)' }} />
                        <span>New time</span>
                    </div>
                )}
                <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgba(239, 68, 68, 0.4)' }} /><span>Few</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgba(234, 179, 8, 0.45)' }} /><span>Some</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgba(34, 197, 94, 0.55)' }} /><span>All available</span>
                </div>
            </div>

            {isLoading ? (
                <div className="flex items-center justify-center py-12 text-muted">Loading availability data...</div>
            ) : signupCount === 0 ? (
                <div className="flex items-center justify-center py-12 text-muted">No players signed up yet -- no availability data to display.</div>
            ) : (
                <>
                    <p className="shrink-0 text-sm text-muted">
                        Click a cell to select a new time, or enter it manually below. Green intensity shows player availability ({signupCount} signed up).
                    </p>
                    <div className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-edge">
                        <GameTimeGrid slots={[]} readOnly compact noStickyOffset events={currentEventBlocks}
                            previewBlocks={previewBlocks} heatmapOverlay={gameTimeData?.cells} onCellClick={handleCellClick} />
                    </div>
                </>
            )}

            <div className="shrink-0 pt-2 border-t border-border space-y-3">
                <div className="flex flex-col md:flex-row items-stretch md:items-end gap-3">
                    <div className="flex-1">
                        <label htmlFor="reschedule-start" className="block text-xs text-muted mb-1">New start</label>
                        <input id="reschedule-start" type="datetime-local" value={newStartTime ?? ''}
                            onChange={(e) => handleStartChange(e.target.value)}
                            className="w-full bg-panel border border-edge rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
                    </div>
                    <div className="flex-1">
                        <label className="block text-xs text-muted mb-1">Duration</label>
                        <div className="flex items-center gap-1.5 flex-wrap">
                            {DURATION_PRESETS.map((p) => (
                                <button key={p.minutes} type="button"
                                    onClick={() => { setDurationMinutes(p.minutes); setCustomDuration(false); }}
                                    className={`px-2.5 py-1.5 rounded-lg text-sm font-medium transition-colors min-h-[44px] ${!customDuration && durationMinutes === p.minutes
                                        ? 'bg-emerald-600 text-white' : 'bg-panel border border-edge text-secondary hover:text-foreground'}`}>
                                    {p.label}
                                </button>
                            ))}
                            <button type="button" onClick={() => setCustomDuration(true)}
                                className={`px-2.5 py-1.5 rounded-lg text-sm font-medium transition-colors min-h-[44px] ${customDuration
                                    ? 'bg-emerald-600 text-white' : 'bg-panel border border-edge text-secondary hover:text-foreground'}`}>
                                Custom
                            </button>
                        </div>
                        {customDuration && (
                            <div className="flex items-center gap-2 mt-1.5">
                                <input type="number" min={0} max={23} value={Math.floor(durationMinutes / 60)}
                                    onChange={(e) => setDurationMinutes(Number(e.target.value) * 60 + (durationMinutes % 60))}
                                    className="w-16 bg-panel border border-edge rounded-lg px-2 py-1 text-sm text-foreground text-center focus:outline-none focus:ring-1 focus:ring-primary" />
                                <span className="text-xs text-muted">hr</span>
                                <input type="number" min={0} max={59} step={15} value={durationMinutes % 60}
                                    onChange={(e) => setDurationMinutes(Math.floor(durationMinutes / 60) * 60 + Number(e.target.value))}
                                    className="w-16 bg-panel border border-edge rounded-lg px-2 py-1 text-sm text-foreground text-center focus:outline-none focus:ring-1 focus:ring-primary" />
                                <span className="text-xs text-muted">min</span>
                            </div>
                        )}
                    </div>
                </div>

                {hasSelection && (
                    <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-2">
                        <p className="text-sm text-foreground">
                            {isValid ? (
                                <>Move <span className="font-semibold">{eventTitle}</span> to{' '}
                                    <span className="font-semibold text-emerald-400">{selectionSummary}</span>?
                                    {signupCount > 0 && (
                                        <span className="text-muted"> All {signupCount} signed-up member{signupCount !== 1 ? 's' : ''} will be notified.</span>
                                    )}
                                </>
                            ) : (
                                <span className="text-red-400">
                                    {parsedStart && parsedEnd && parsedStart >= parsedEnd ? 'Start time must be before end time' : 'Start time must be in the future'}
                                </span>
                            )}
                        </p>
                        <div className="flex gap-2 shrink-0">
                            <button onClick={() => { setNewStartTime(null); setGridSelection(null); }} className="btn btn-secondary btn-sm">Clear</button>
                            <button onClick={handleConfirm} disabled={reschedule.isPending || !isValid} className="btn btn-primary btn-sm">
                                {reschedule.isPending ? 'Rescheduling...' : 'Confirm'}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );

    if (isMobile) {
        return (
            <BottomSheet isOpen={isOpen} onClose={handleClose} title="Reschedule Event" maxHeight="85vh">
                {content}
            </BottomSheet>
        );
    }

    return (
        <Modal isOpen={isOpen} onClose={handleClose} title="Reschedule Event" maxWidth="max-w-4xl"
            bodyClassName="p-4 flex flex-col max-h-[calc(90vh-4rem)]">
            {content}
        </Modal>
    );
}
