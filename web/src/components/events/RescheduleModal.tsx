import { useState, useMemo } from 'react';
import { toast } from 'sonner';
import { Modal } from '../ui/modal';
import { GameTimeGrid } from '../features/game-time/GameTimeGrid';
import { useAggregateGameTime, useRescheduleEvent } from '../../hooks/use-reschedule';
import type { GameTimePreviewBlock, GameTimeEventBlock } from '../features/game-time/GameTimeGrid';

interface RescheduleModalProps {
    isOpen: boolean;
    onClose: () => void;
    eventId: number;
    currentStartTime: string;
    currentEndTime: string;
    eventTitle: string;
    /** Game metadata for rendering the calendar chip */
    gameSlug?: string | null;
    gameName?: string | null;
    coverUrl?: string | null;
    description?: string | null;
    creatorUsername?: string;
    signupCount?: number;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function formatHour(hour: number): string {
    if (hour === 0 || hour === 24) return '12:00 AM';
    if (hour === 12) return '12:00 PM';
    return hour < 12 ? `${hour}:00 AM` : `${hour - 12}:00 PM`;
}

/**
 * Convert a Date to a `datetime-local` input value (YYYY-MM-DDThh:mm)
 */
function toLocalInput(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Compute the next occurrence of a given weekday (0=Sun..6=Sat)
 * after today's date, at the given hour.
 */
function nextOccurrence(dayOfWeek: number, hour: number): Date {
    const now = new Date();
    const today = now.getDay(); // 0=Sun
    let daysAhead = dayOfWeek - today;
    if (daysAhead <= 0) daysAhead += 7;
    const date = new Date(now);
    date.setDate(date.getDate() + daysAhead);
    date.setHours(hour, 0, 0, 0);
    return date;
}

/**
 * RescheduleModal (ROK-223)
 *
 * Shows an aggregate game time heatmap so the organizer
 * can visually pick the best new time, or manually enter exact datetimes.
 */
export function RescheduleModal({
    isOpen,
    onClose,
    eventId,
    currentStartTime,
    currentEndTime,
    eventTitle,
    gameSlug,
    gameName,
    coverUrl,
    description,
    creatorUsername,
    signupCount: eventSignupCount,
}: RescheduleModalProps) {
    const { data: gameTimeData, isLoading } = useAggregateGameTime(eventId, isOpen);
    const reschedule = useRescheduleEvent(eventId);

    // New start/end times — null means nothing selected yet
    const [newStartTime, setNewStartTime] = useState<string | null>(null);
    const [newEndTime, setNewEndTime] = useState<string | null>(null);
    // Track if selection came from grid click (for preview block display)
    const [gridSelection, setGridSelection] = useState<{ day: number; hour: number } | null>(null);

    // Compute current event's day/hour
    const currentStart = useMemo(() => new Date(currentStartTime), [currentStartTime]);
    const currentEnd = useMemo(() => new Date(currentEndTime), [currentEndTime]);
    const durationMs = useMemo(
        () => currentEnd.getTime() - currentStart.getTime(),
        [currentStart, currentEnd],
    );
    const durationHours = useMemo(
        () => Math.max(1, Math.round(durationMs / (1000 * 60 * 60))),
        [durationMs],
    );
    const currentDayOfWeek = currentStart.getDay(); // 0=Sun
    const currentHour = currentStart.getHours();

    // Current event as a calendar chip
    const currentEventBlocks = useMemo((): GameTimeEventBlock[] => [{
        eventId,
        title: eventTitle,
        gameSlug: gameSlug ?? null,
        gameName: gameName ?? null,
        coverUrl: coverUrl ?? null,
        signupId: 0,
        confirmationStatus: 'confirmed',
        dayOfWeek: currentDayOfWeek,
        startHour: currentHour,
        endHour: currentHour + durationHours,
        description: description ?? null,
        creatorUsername: creatorUsername ?? null,
        signupCount: eventSignupCount,
    }], [eventId, eventTitle, gameSlug, gameName, coverUrl, currentDayOfWeek, currentHour, durationHours, description, creatorUsername, eventSignupCount]);

    // Selected new position as emerald preview block (only from grid clicks)
    const previewBlocks = useMemo(() => {
        if (!gridSelection) return undefined;
        const blocks: GameTimePreviewBlock[] = [{
            dayOfWeek: gridSelection.day,
            startHour: gridSelection.hour,
            endHour: gridSelection.hour + durationHours,
            label: 'New Time',
            variant: 'selected',
            title: eventTitle,
            gameName: gameName ?? undefined,
            gameSlug: gameSlug ?? undefined,
            coverUrl: coverUrl,
        }];
        return blocks;
    }, [gridSelection, durationHours, eventTitle, gameName, gameSlug, coverUrl]);

    // Smart hour range
    const hourRange: [number, number] = useMemo(() => {
        let minHour = currentHour;
        if (gridSelection) minHour = Math.min(minHour, gridSelection.hour);
        if (gameTimeData?.cells.length) {
            const heatmapMinHour = Math.min(...gameTimeData.cells.map(c => c.hour));
            minHour = Math.min(minHour, heatmapMinHour);
        }
        const rangeStart = Math.max(0, Math.min(minHour - 1, 6));
        return [rangeStart, 24];
    }, [currentHour, gridSelection, gameTimeData]);

    // Grid cell click → set both grid selection and datetime inputs
    const handleCellClick = (dayOfWeek: number, hour: number) => {
        if (dayOfWeek === currentDayOfWeek && hour === currentHour) return;
        setGridSelection({ day: dayOfWeek, hour });
        const start = nextOccurrence(dayOfWeek, hour);
        const end = new Date(start.getTime() + durationMs);
        setNewStartTime(toLocalInput(start));
        setNewEndTime(toLocalInput(end));
    };

    // Manual input change → clear grid selection, update times
    const handleStartChange = (value: string) => {
        setNewStartTime(value);
        setGridSelection(null);
        // Auto-compute end time preserving duration
        if (value) {
            const start = new Date(value);
            if (!isNaN(start.getTime())) {
                const end = new Date(start.getTime() + durationMs);
                setNewEndTime(toLocalInput(end));
            }
        }
    };

    const handleEndChange = (value: string) => {
        setNewEndTime(value);
        setGridSelection(null);
    };

    const hasSelection = !!newStartTime && !!newEndTime;
    const parsedStart = newStartTime ? new Date(newStartTime) : null;
    const parsedEnd = newEndTime ? new Date(newEndTime) : null;
    const isValid = parsedStart && parsedEnd
        && !isNaN(parsedStart.getTime()) && !isNaN(parsedEnd.getTime())
        && parsedStart < parsedEnd
        && parsedStart > new Date();

    const handleConfirm = async () => {
        if (!parsedStart || !parsedEnd || !isValid) return;

        try {
            await reschedule.mutateAsync({
                startTime: parsedStart.toISOString(),
                endTime: parsedEnd.toISOString(),
            });

            const dayLabel = DAYS[parsedStart.getDay()];
            const hourLabel = formatHour(parsedStart.getHours());
            toast.success('Event rescheduled', {
                description: `Moved to ${dayLabel} at ${hourLabel}`,
            });
            setNewStartTime(null);
            setNewEndTime(null);
            setGridSelection(null);
            onClose();
        } catch (err) {
            toast.error('Failed to reschedule', {
                description: err instanceof Error ? err.message : 'Please try again.',
            });
        }
    };

    const handleClose = () => {
        setNewStartTime(null);
        setNewEndTime(null);
        setGridSelection(null);
        onClose();
    };

    const signupCount = gameTimeData?.totalUsers ?? 0;

    // Formatted summary of the selected time for display
    const selectionSummary = parsedStart && !isNaN(parsedStart.getTime())
        ? `${DAYS[parsedStart.getDay()]} at ${formatHour(parsedStart.getHours())}`
        : null;

    return (
        <Modal
            isOpen={isOpen}
            onClose={handleClose}
            title="Reschedule Event"
            maxWidth="max-w-4xl"
            bodyClassName="p-4"
        >
            <div className="space-y-3">
                {/* Legend */}
                <div className="flex items-center gap-4 text-xs text-muted">
                    {gridSelection && (
                        <div className="flex items-center gap-1.5">
                            <div className="w-3 h-3 rounded-sm border-2 border-solid border-emerald-500/80" />
                            <span>New time</span>
                        </div>
                    )}
                    <div className="flex items-center gap-1.5">
                        <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgba(16, 185, 129, 0.4)' }} />
                        <span>Player availability</span>
                    </div>
                </div>

                {isLoading ? (
                    <div className="flex items-center justify-center py-12 text-muted">
                        Loading availability data...
                    </div>
                ) : signupCount === 0 ? (
                    <div className="flex items-center justify-center py-12 text-muted">
                        No players signed up yet — no availability data to display.
                    </div>
                ) : (
                    <>
                        <p className="text-sm text-muted">
                            Click a cell to select a new time, or enter it manually below.
                            Green intensity shows player availability ({signupCount} signed up).
                        </p>
                        <GameTimeGrid
                            slots={[]}
                            readOnly
                            hourRange={hourRange}
                            events={currentEventBlocks}
                            previewBlocks={previewBlocks}
                            heatmapOverlay={gameTimeData?.cells}
                            onCellClick={handleCellClick}
                        />
                    </>
                )}

                {/* Manual time inputs + confirmation */}
                <div className="pt-2 border-t border-border space-y-3">
                    <div className="flex items-end gap-3">
                        <div className="flex-1">
                            <label htmlFor="reschedule-start" className="block text-xs text-muted mb-1">
                                New start
                            </label>
                            <input
                                id="reschedule-start"
                                type="datetime-local"
                                value={newStartTime ?? ''}
                                onChange={(e) => handleStartChange(e.target.value)}
                                className="w-full bg-panel border border-edge rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                        </div>
                        <div className="flex-1">
                            <label htmlFor="reschedule-end" className="block text-xs text-muted mb-1">
                                New end
                            </label>
                            <input
                                id="reschedule-end"
                                type="datetime-local"
                                value={newEndTime ?? ''}
                                onChange={(e) => handleEndChange(e.target.value)}
                                className="w-full bg-panel border border-edge rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                        </div>
                    </div>

                    {hasSelection && (
                        <div className="flex items-center justify-between">
                            <p className="text-sm text-foreground">
                                {isValid ? (
                                    <>
                                        Move <span className="font-semibold">{eventTitle}</span> to{' '}
                                        <span className="font-semibold text-emerald-400">
                                            {selectionSummary}
                                        </span>
                                        ?
                                        {signupCount > 0 && (
                                            <span className="text-muted">
                                                {' '}All {signupCount} signed-up member{signupCount !== 1 ? 's' : ''} will be notified.
                                            </span>
                                        )}
                                    </>
                                ) : (
                                    <span className="text-red-400">
                                        {parsedStart && parsedEnd && parsedStart >= parsedEnd
                                            ? 'Start time must be before end time'
                                            : 'Start time must be in the future'}
                                    </span>
                                )}
                            </p>
                            <div className="flex gap-2 shrink-0">
                                <button
                                    onClick={() => {
                                        setNewStartTime(null);
                                        setNewEndTime(null);
                                        setGridSelection(null);
                                    }}
                                    className="btn btn-secondary btn-sm"
                                >
                                    Clear
                                </button>
                                <button
                                    onClick={handleConfirm}
                                    disabled={reschedule.isPending || !isValid}
                                    className="btn btn-primary btn-sm"
                                >
                                    {reschedule.isPending ? 'Rescheduling...' : 'Confirm'}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </Modal>
    );
}
