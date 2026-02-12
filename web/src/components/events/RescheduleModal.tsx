import { useState, useMemo } from 'react';
import { toast } from 'sonner';
import { Modal } from '../ui/modal';
import { GameTimeGrid } from '../features/game-time/GameTimeGrid';
import { useAggregateGameTime, useRescheduleEvent } from '../../hooks/use-reschedule';
import type { GameTimePreviewBlock } from '../features/game-time/GameTimeGrid';

interface RescheduleModalProps {
    isOpen: boolean;
    onClose: () => void;
    eventId: number;
    currentStartTime: string;
    currentEndTime: string;
    eventTitle: string;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function formatHour(hour: number): string {
    if (hour === 0 || hour === 24) return '12:00 AM';
    if (hour === 12) return '12:00 PM';
    return hour < 12 ? `${hour}:00 AM` : `${hour - 12}:00 PM`;
}

/**
 * Compute the next occurrence of a given weekday (0=Sun..6=Sat)
 * after today's date, returning an ISO datetime string at the given hour.
 */
function nextOccurrence(dayOfWeek: number, hour: number): Date {
    const now = new Date();
    const today = now.getDay(); // 0=Sun
    let daysAhead = dayOfWeek - today;
    if (daysAhead <= 0) daysAhead += 7; // Always pick next week if same day or past
    const date = new Date(now);
    date.setDate(date.getDate() + daysAhead);
    date.setHours(hour, 0, 0, 0);
    return date;
}

/**
 * RescheduleModal (ROK-223)
 *
 * Shows an aggregate game time heatmap so the organizer
 * can visually pick the best new time for the event.
 */
export function RescheduleModal({
    isOpen,
    onClose,
    eventId,
    currentStartTime,
    currentEndTime,
    eventTitle,
}: RescheduleModalProps) {
    const { data: gameTimeData, isLoading } = useAggregateGameTime(eventId, isOpen);
    const reschedule = useRescheduleEvent(eventId);

    const [selectedStart, setSelectedStart] = useState<{ day: number; hour: number } | null>(null);

    // Compute current event's day/hour
    const currentStart = useMemo(() => new Date(currentStartTime), [currentStartTime]);
    const currentEnd = useMemo(() => new Date(currentEndTime), [currentEndTime]);
    const durationHours = useMemo(
        () => Math.max(1, Math.round((currentEnd.getTime() - currentStart.getTime()) / (1000 * 60 * 60))),
        [currentStart, currentEnd],
    );
    const currentDayOfWeek = currentStart.getDay(); // 0=Sun
    const currentHour = currentStart.getHours();

    // Build preview blocks
    const previewBlocks = useMemo(() => {
        const blocks: GameTimePreviewBlock[] = [];

        // Current event position (amber dashed)
        blocks.push({
            dayOfWeek: currentDayOfWeek,
            startHour: currentHour,
            endHour: currentHour + durationHours,
            label: 'Current',
            variant: 'current',
        });

        // Selected new position (emerald solid)
        if (selectedStart) {
            blocks.push({
                dayOfWeek: selectedStart.day,
                startHour: selectedStart.hour,
                endHour: selectedStart.hour + durationHours,
                label: 'New Time',
                variant: 'selected',
            });
        }

        return blocks;
    }, [currentDayOfWeek, currentHour, durationHours, selectedStart]);

    // Smart hour range: show 6-24 range, expanding if needed for the current event
    const hourRange: [number, number] = useMemo(() => {
        const minHour = Math.min(6, currentHour);
        return [minHour, 24];
    }, [currentHour]);

    const handleCellClick = (dayOfWeek: number, hour: number) => {
        // Don't allow selecting the same time
        if (dayOfWeek === currentDayOfWeek && hour === currentHour) {
            return;
        }
        setSelectedStart({ day: dayOfWeek, hour });
    };

    const handleConfirm = async () => {
        if (!selectedStart) return;

        const newStart = nextOccurrence(selectedStart.day, selectedStart.hour);
        const newEnd = new Date(newStart.getTime() + durationHours * 60 * 60 * 1000);

        try {
            await reschedule.mutateAsync({
                startTime: newStart.toISOString(),
                endTime: newEnd.toISOString(),
            });
            toast.success('Event rescheduled', {
                description: `Moved to ${DAYS[selectedStart.day]} at ${formatHour(selectedStart.hour)}`,
            });
            setSelectedStart(null);
            onClose();
        } catch (err) {
            toast.error('Failed to reschedule', {
                description: err instanceof Error ? err.message : 'Please try again.',
            });
        }
    };

    const signupCount = gameTimeData?.totalUsers ?? 0;

    return (
        <Modal
            isOpen={isOpen}
            onClose={() => {
                setSelectedStart(null);
                onClose();
            }}
            title="Reschedule Event"
            maxWidth="max-w-4xl"
        >
            <div className="space-y-4">
                {/* Legend */}
                <div className="flex items-center gap-4 text-xs text-muted">
                    <div className="flex items-center gap-1.5">
                        <div className="w-3 h-3 rounded-sm border-2 border-dashed border-amber-400/70" />
                        <span>Current time</span>
                    </div>
                    {selectedStart && (
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
                            Click a cell to select a new time. Green intensity shows player availability
                            ({signupCount} signed up).
                        </p>
                        <GameTimeGrid
                            slots={[]}
                            readOnly
                            hourRange={hourRange}
                            previewBlocks={previewBlocks}
                            heatmapOverlay={gameTimeData?.cells}
                            onCellClick={handleCellClick}
                        />
                    </>
                )}

                {/* Confirmation area */}
                {selectedStart && (
                    <div className="flex items-center justify-between pt-2 border-t border-border">
                        <p className="text-sm text-foreground">
                            Move <span className="font-semibold">{eventTitle}</span> to{' '}
                            <span className="font-semibold text-emerald-400">
                                {DAYS[selectedStart.day]} at {formatHour(selectedStart.hour)}
                            </span>
                            ?
                            {signupCount > 0 && (
                                <span className="text-muted">
                                    {' '}All {signupCount} signed-up member{signupCount !== 1 ? 's' : ''} will be notified.
                                </span>
                            )}
                        </p>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setSelectedStart(null)}
                                className="btn btn-secondary btn-sm"
                            >
                                Clear
                            </button>
                            <button
                                onClick={handleConfirm}
                                disabled={reschedule.isPending}
                                className="btn btn-primary btn-sm"
                            >
                                {reschedule.isPending ? 'Rescheduling...' : 'Confirm'}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </Modal>
    );
}
