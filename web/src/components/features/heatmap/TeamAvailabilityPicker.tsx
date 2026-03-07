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
function computeDateRange(eventStartTime?: string, eventEndTime?: string) {
    if (eventStartTime && eventEndTime) {
        const start = new Date(eventStartTime);
        const end = new Date(eventEndTime);
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);
        return { from: start.toISOString(), to: end.toISOString() };
    }
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const weekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    return { from: now.toISOString(), to: weekLater.toISOString() };
}

function PickerHeader({ title, userCount, isEditMode, isExpanded, onToggle }: {
    title: string; userCount: number; isEditMode: boolean; isExpanded: boolean; onToggle: () => void;
}) {
    return (
        <button type="button" onClick={onToggle} className="w-full px-4 py-3 flex items-center justify-between hover:bg-overlay/50 transition-colors">
            <span className="text-sm font-medium text-secondary flex items-center gap-2">
                <span>📅</span>
                {title}
                {userCount > 0 && (
                    <span className="text-xs bg-emerald-600/20 text-emerald-400 px-2 py-0.5 rounded">
                        {isEditMode ? `${userCount} user${userCount > 1 ? 's' : ''}` : 'Available'}
                    </span>
                )}
            </span>
            <span className="text-muted text-sm">{isExpanded ? '▼' : '▶'}</span>
        </button>
    );
}

function PickerContent({ isLoading, displayData, emptyMessage }: {
    isLoading: boolean; displayData: RosterAvailabilityResponse | null; emptyMessage: string;
}) {
    if (isLoading) {
        return <div className="space-y-2 py-4"><div className="h-6 bg-overlay rounded animate-pulse" /><div className="h-24 bg-overlay rounded animate-pulse" /></div>;
    }
    if (displayData && displayData.users.length > 0) {
        return <div className="pt-2"><HeatmapGrid data={displayData} slotDurationMinutes={60} /></div>;
    }
    return <div className="text-center py-6 text-muted text-sm">{emptyMessage}</div>;
}

export function TeamAvailabilityPicker({ eventId, eventStartTime, eventEndTime, gameId }: TeamAvailabilityPickerProps) {
    const [isExpanded, setIsExpanded] = useState(false);
    const dateRange = useMemo(() => computeDateRange(eventStartTime, eventEndTime), [eventStartTime, eventEndTime]);

    const { data: rosterAvailability, isLoading: rosterLoading } = useRosterAvailability(eventId ?? 0, { from: dateRange.from, to: dateRange.to }, !!eventId);
    const { data: myAvailability, isLoading: myLoading } = useMyAvailability({ from: dateRange.from, to: dateRange.to, gameId }, !eventId);

    const isEditMode = !!eventId;
    const isLoading = isEditMode ? rosterLoading : myLoading;
    const availabilityData: RosterAvailabilityResponse | null = isEditMode ? rosterAvailability ?? null : myAvailability ?? null;

    const displayData = useMemo<RosterAvailabilityResponse | null>(() => {
        if (!availabilityData) return null;
        if (eventStartTime && eventEndTime) return { ...availabilityData, timeRange: { start: eventStartTime, end: eventEndTime } };
        return availabilityData;
    }, [availabilityData, eventStartTime, eventEndTime]);

    const title = isEditMode ? 'Team Availability' : 'Your Availability';
    const emptyMessage = isEditMode ? 'No signups yet to show availability for.' : 'No availability set. Add your availability in your profile.';

    return (
        <div className="bg-panel/50 rounded-lg border border-edge overflow-hidden">
            <PickerHeader title={title} userCount={availabilityData?.users.length ?? 0} isEditMode={isEditMode} isExpanded={isExpanded} onToggle={() => setIsExpanded(!isExpanded)} />
            {isExpanded && <div className="px-4 pb-4"><PickerContent isLoading={isLoading} displayData={displayData} emptyMessage={emptyMessage} /></div>}
        </div>
    );
}
