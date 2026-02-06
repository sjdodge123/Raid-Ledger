import { useState, useMemo } from 'react';
import type { RosterAvailabilityResponse } from '@raid-ledger/contract';
import { HeatmapGrid } from './HeatmapGrid';
import { useMyAvailability } from '../../../hooks/use-my-availability';
import { useRosterAvailability } from '../../../hooks/use-roster-availability';

interface TeamAvailabilityPickerProps {
    /** Event ID - if provided, fetches signed-up users' availability (Edit mode) */
    eventId?: number;
    /** Start time of the event being created/edited */
    eventStartTime?: string;
    /** End time of the event being created/edited */
    eventEndTime?: string;
    /** Game ID to filter availability */
    gameId?: string;
}

/**
 * Team Availability Picker for event forms (ROK-182).
 * 
 * - Create mode (no eventId): Shows current user's availability
 * - Edit mode (with eventId): Shows signed-up users' availability
 * 
 * Uses the same HeatmapGrid component as Event Detail page for consistency.
 */
export function TeamAvailabilityPicker({
    eventId,
    eventStartTime,
    eventEndTime,
    gameId,
}: TeamAvailabilityPickerProps) {
    const [isExpanded, setIsExpanded] = useState(false);

    // Calculate date range - show 3 days before and after the event time, or next 7 days if no event time
    const dateRange = useMemo(() => {
        if (eventStartTime && eventEndTime) {
            const start = new Date(eventStartTime);
            const end = new Date(eventEndTime);
            // Expand to show full day context
            start.setHours(0, 0, 0, 0);
            end.setHours(23, 59, 59, 999);
            return {
                from: start.toISOString(),
                to: end.toISOString(),
            };
        }
        // Default: next 7 days
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        const weekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        return {
            from: now.toISOString(),
            to: weekLater.toISOString(),
        };
    }, [eventStartTime, eventEndTime]);

    // Edit mode: fetch signed-up users' availability
    const {
        data: rosterAvailability,
        isLoading: rosterLoading,
    } = useRosterAvailability(
        eventId ?? 0,
        { from: dateRange.from, to: dateRange.to },
        !!eventId // Only enable if we have an eventId
    );

    // Create mode: fetch current user's availability
    const {
        data: myAvailability,
        isLoading: myLoading,
    } = useMyAvailability(
        { from: dateRange.from, to: dateRange.to, gameId },
        !eventId // Only enable if we don't have an eventId
    );

    // Determine which data to use
    const isEditMode = !!eventId;
    const isLoading = isEditMode ? rosterLoading : myLoading;
    const availabilityData: RosterAvailabilityResponse | null = isEditMode
        ? rosterAvailability ?? null
        : myAvailability ?? null;

    // Build display data with event time range if we have it
    const displayData: RosterAvailabilityResponse | null = useMemo(() => {
        if (!availabilityData) return null;

        // If event times provided, use those as the display range
        if (eventStartTime && eventEndTime) {
            return {
                ...availabilityData,
                timeRange: {
                    start: eventStartTime,
                    end: eventEndTime,
                },
            };
        }
        return availabilityData;
    }, [availabilityData, eventStartTime, eventEndTime]);

    const title = isEditMode ? 'Team Availability' : 'Your Availability';
    const emptyMessage = isEditMode
        ? 'No signups yet to show availability for.'
        : 'No availability set. Add your availability in your profile.';

    return (
        <div className="bg-slate-800/50 rounded-lg border border-slate-700 overflow-hidden">
            <button
                type="button"
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-700/50 transition-colors"
            >
                <span className="text-sm font-medium text-slate-300 flex items-center gap-2">
                    <span>📅</span>
                    {title}
                    {availabilityData && availabilityData.users.length > 0 && (
                        <span className="text-xs bg-emerald-600/20 text-emerald-400 px-2 py-0.5 rounded">
                            {isEditMode
                                ? `${availabilityData.users.length} user${availabilityData.users.length > 1 ? 's' : ''}`
                                : 'Available'
                            }
                        </span>
                    )}
                </span>
                <span className="text-slate-400 text-sm">
                    {isExpanded ? '▼' : '▶'}
                </span>
            </button>

            {isExpanded && (
                <div className="px-4 pb-4">
                    {isLoading ? (
                        <div className="space-y-2 py-4">
                            <div className="h-6 bg-slate-700 rounded animate-pulse" />
                            <div className="h-24 bg-slate-700 rounded animate-pulse" />
                        </div>
                    ) : displayData && displayData.users.length > 0 ? (
                        <div className="pt-2">
                            <HeatmapGrid data={displayData} slotDurationMinutes={60} />
                        </div>
                    ) : (
                        <div className="text-center py-6 text-slate-400 text-sm">
                            {emptyMessage}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
