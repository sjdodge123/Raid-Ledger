import { useState, useCallback, useMemo, useEffect } from 'react';
import { useGameTime, useSaveGameTime, useSaveGameTimeOverrides } from './use-game-time';
import type { GameTimeEventBlock, GameTimeSlot } from '@raid-ledger/contract';
import { toast } from 'sonner';

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

    // Memoize next week start so the query key is stable across renders
    const nextWeekStart = useMemo(() => getNextWeekStart(), []);

    const { data: gameTimeData, isLoading } = useGameTime({ enabled });
    const { data: nextWeekData } = useGameTime({
        enabled: enabled && rolling,
        week: nextWeekStart,
    });

    const saveGameTime = useSaveGameTime();
    const saveOverrides = useSaveGameTimeOverrides();
    const [editSlots, setEditSlots] = useState<GameTimeSlot[] | null>(null);

    // Timezone label
    const tzLabel = useMemo(
        () =>
            new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' })
                .formatToParts(new Date())
                .find((p) => p.type === 'timeZoneName')?.value ?? '',
        [],
    );

    // Today / current time tracking
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        const interval = setInterval(() => setNow(new Date()), 60_000);
        return () => clearInterval(interval);
    }, []);

    const todayIndex = now.getDay(); // 0=Sun naturally
    const currentHour = now.getHours() + now.getMinutes() / 60;

    // Derive displayed slots
    const slots = useMemo<GameTimeSlot[]>(() => {
        if (editSlots !== null) return editSlots;
        if (!gameTimeData?.slots) return [];
        return gameTimeData.slots.map((s: GameTimeSlot) => ({
            dayOfWeek: s.dayOfWeek,
            hour: s.hour,
            status: s.status ?? 'available',
        }));
    }, [editSlots, gameTimeData]);

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
        const templateSlots = slots
            .filter((s) => s.status === 'available' || !s.status)
            .map((s) => ({ dayOfWeek: s.dayOfWeek, hour: s.hour }));
        try {
            await saveGameTime.mutateAsync(templateSlots);
            setEditSlots(null);
            toast.success('Game time saved');
        } catch {
            toast.error('Failed to save game time');
        }
    }, [slots, saveGameTime]);

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
