import { useState, useCallback, useMemo, useEffect } from 'react';
import { useGameTime, useSaveGameTime, useSaveGameTimeOverrides } from './use-game-time';
import type { GameTimeEventBlock, GameTimeSlot } from '@raid-ledger/contract';
import { toast } from '../lib/toast';
import { useTimezoneStore } from '../stores/timezone-store';
import { getTimezoneAbbr, getTimezoneOffsetMinutes } from '../lib/timezone-utils';

export interface UseGameTimeEditorOptions {
    enabled?: boolean;
    rolling?: boolean;
}

export interface UseGameTimeEditorReturn {
    slots: GameTimeSlot[];
    events: GameTimeEventBlock[];
    nextWeekEvents?: GameTimeEventBlock[];
    nextWeekSlots?: GameTimeSlot[];
    isLoading: boolean;
    weekStart: string;
    isDirty: boolean;
    handleChange: (slots: GameTimeSlot[]) => void;
    save: () => Promise<void>;
    clear: () => void;
    discard: () => void;
    isSaving: boolean;
    tzLabel: string;
    todayIndex: number;
    currentHour: number;
    overrides: Array<{ date: string; hour: number; status: string }>;
    absences: Array<{ id: number; startDate: string; endDate: string; reason: string | null }>;
}

/**
 * Compute the ISO date string for next week's Sunday.
 */
function getNextWeekStart(): string {
    const now = new Date();
    const day = now.getDay();
    const nextSunday = new Date(now);
    nextSunday.setDate(now.getDate() - day + 7);
    nextSunday.setHours(0, 0, 0, 0);
    return nextSunday.toISOString().split('T')[0];
}

export function useGameTimeEditor(options?: UseGameTimeEditorOptions): UseGameTimeEditorReturn {
    const enabled = options?.enabled ?? true;
    const rolling = options?.rolling ?? false;
    const resolved = useTimezoneStore((s) => s.resolved);
    const tzOffset = useMemo(() => getTimezoneOffsetMinutes(resolved), [resolved]);

    // Memoize next week start so the query key is stable across renders
    const nextWeekStart = useMemo(() => getNextWeekStart(), []);

    const { data: gameTimeData, isLoading } = useGameTime({ enabled, tzOffset });
    const { data: nextWeekData } = useGameTime({
        enabled: enabled && rolling,
        week: nextWeekStart,
        tzOffset,
    });

    const saveGameTime = useSaveGameTime();
    const saveOverrides = useSaveGameTimeOverrides();
    const [editSlots, setEditSlots] = useState<GameTimeSlot[] | null>(null);

    // Timezone label — uses user's preferred timezone
    const tzLabel = useMemo(() => getTimezoneAbbr(resolved), [resolved]);

    // Today / current time tracking
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        const interval = setInterval(() => setNow(new Date()), 60_000);
        return () => clearInterval(interval);
    }, []);

    const todayIndex = now.getDay(); // 0=Sun naturally
    const currentHour = now.getHours() + now.getMinutes() / 60;

    // Derive displayed slots
    // In non-rolling (profile) mode, exclude committed/freed slots — those come from
    // event signups and should not appear in the weekly template view.
    const slots = useMemo<GameTimeSlot[]>(() => {
        if (editSlots !== null) return editSlots;
        if (!gameTimeData?.slots) return [];
        return gameTimeData.slots
            .filter((s: GameTimeSlot) => rolling || (s.status !== 'committed' && s.status !== 'freed'))
            .map((s: GameTimeSlot) => ({
                dayOfWeek: s.dayOfWeek,
                hour: s.hour,
                status: s.status ?? 'available',
            }));
    }, [editSlots, gameTimeData, rolling]);

    const events = useMemo<GameTimeEventBlock[]>(
        () => (gameTimeData?.events as GameTimeEventBlock[]) ?? [],
        [gameTimeData],
    );

    const nextWeekEvents = useMemo<GameTimeEventBlock[] | undefined>(
        () => (nextWeekData?.events as GameTimeEventBlock[] | undefined),
        [nextWeekData],
    );

    const nextWeekSlots = useMemo<GameTimeSlot[] | undefined>(() => {
        if (!nextWeekData?.slots) return undefined;
        return nextWeekData.slots.map((s: GameTimeSlot) => ({
            dayOfWeek: s.dayOfWeek,
            hour: s.hour,
            status: s.status ?? 'available',
        }));
    }, [nextWeekData]);

    const isDirty = editSlots !== null;

    const handleChange = useCallback((newSlots: GameTimeSlot[]) => {
        setEditSlots(newSlots);
    }, []);

    const save = useCallback(async () => {
        // Build the set of user-edited available slots
        const editedAvailable = slots
            .filter((s) => s.status === 'available' || !s.status)
            .map((s) => ({ dayOfWeek: s.dayOfWeek, hour: s.hour }));

        // In profile (non-rolling) mode, committed/freed slots are filtered out
        // of the display `slots`. But the backend save does a full delete+insert,
        // so we must re-include the original committed template slots to avoid
        // losing them. These are template hours where an event currently overlaps.
        let templateSlots = editedAvailable;
        if (!rolling && gameTimeData?.slots) {
            const editedKeys = new Set(editedAvailable.map((s) => `${s.dayOfWeek}:${s.hour}`));
            const committedOriginals = (gameTimeData.slots as GameTimeSlot[])
                .filter((s) => s.status === 'committed' || s.status === 'freed')
                .map((s) => ({ dayOfWeek: s.dayOfWeek, hour: s.hour }))
                .filter((s) => !editedKeys.has(`${s.dayOfWeek}:${s.hour}`));
            templateSlots = [...editedAvailable, ...committedOriginals];
        }

        try {
            await saveGameTime.mutateAsync(templateSlots);
            setEditSlots(null);
            toast.success('Game time saved');
        } catch {
            toast.error('Failed to save game time');
        }
    }, [slots, saveGameTime, rolling, gameTimeData]);

    const clear = useCallback(() => {
        setEditSlots([]);
    }, []);

    const discard = useCallback(() => {
        setEditSlots(null);
    }, []);

    return {
        slots,
        events,
        nextWeekEvents,
        nextWeekSlots,
        isLoading,
        weekStart: gameTimeData?.weekStart ?? '',
        isDirty,
        handleChange,
        save,
        clear,
        discard,
        isSaving: saveGameTime.isPending || saveOverrides.isPending,
        tzLabel,
        todayIndex,
        currentHour,
        overrides: (gameTimeData?.overrides as Array<{ date: string; hour: number; status: string }>) ?? [],
        absences: (gameTimeData?.absences as Array<{ id: number; startDate: string; endDate: string; reason: string | null }>) ?? [],
    };
}
