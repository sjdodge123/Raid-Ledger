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

export type GameTimePreset = 'morning' | 'afternoon' | 'evening' | 'night';

export interface UseGameTimeEditorReturn {
    slots: GameTimeSlot[];
    events: GameTimeEventBlock[];
    nextWeekEvents?: GameTimeEventBlock[];
    nextWeekSlots?: GameTimeSlot[];
    isLoading: boolean;
    weekStart: string;
    isDirty: boolean;
    handleChange: (slots: GameTimeSlot[]) => void;
    applyPreset: (dayOfWeek: number, preset: GameTimePreset) => void;
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

const PRESET_HOUR_RANGES: Record<GameTimePreset, [number, number]> = {
    morning: [6, 12],
    afternoon: [12, 18],
    evening: [18, 24],
    night: [0, 6],
};

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

function isAvailableSlot(s: GameTimeSlot): boolean {
    return s.status === 'available' || !s.status;
}

function deriveDisplaySlots(
    editSlots: GameTimeSlot[] | null,
    gameTimeData: ReturnType<typeof useGameTime>['data'],
    rolling: boolean,
): GameTimeSlot[] {
    if (editSlots !== null) return editSlots;
    if (!gameTimeData?.slots) return [];
    return gameTimeData.slots
        .filter((s: GameTimeSlot) => rolling || s.fromTemplate !== false)
        .map((s: GameTimeSlot) => ({
            dayOfWeek: s.dayOfWeek,
            hour: s.hour,
            status: (!rolling && (s.status === 'committed' || s.status === 'freed'))
                ? 'available'
                : (s.status ?? 'available'),
        }));
}

function togglePresetSlots(
    current: GameTimeSlot[],
    dayOfWeek: number,
    rangeHours: number[],
): GameTimeSlot[] {
    const allActive = rangeHours.every((h) =>
        current.some((s) => s.dayOfWeek === dayOfWeek && s.hour === h && isAvailableSlot(s)),
    );

    if (allActive) {
        return current.filter(
            (s) => !(s.dayOfWeek === dayOfWeek && rangeHours.includes(s.hour) && isAvailableSlot(s)),
        );
    }

    const existingHours = new Set(
        current.filter((s) => s.dayOfWeek === dayOfWeek && isAvailableSlot(s)).map((s) => s.hour),
    );
    const toAdd = rangeHours
        .filter((h) => !existingHours.has(h))
        .map((h) => ({ dayOfWeek, hour: h, status: 'available' as const }));
    return [...current, ...toAdd];
}

function useGameTimeQueries(enabled: boolean, rolling: boolean) {
    const resolved = useTimezoneStore((s) => s.resolved);
    const tzOffset = useMemo(() => getTimezoneOffsetMinutes(resolved), [resolved]);
    const nextWeekStart = useMemo(() => getNextWeekStart(), []);

    const { data: gameTimeData, isLoading } = useGameTime({ enabled, tzOffset });
    const { data: nextWeekData } = useGameTime({
        enabled: enabled && rolling,
        week: nextWeekStart,
        tzOffset,
    });

    const tzLabel = useMemo(() => getTimezoneAbbr(resolved), [resolved]);

    return { gameTimeData, nextWeekData, isLoading, tzLabel };
}

function useCurrentTime() {
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        const interval = setInterval(() => setNow(new Date()), 60_000);
        return () => clearInterval(interval);
    }, []);
    return { todayIndex: now.getDay(), currentHour: now.getHours() + now.getMinutes() / 60 };
}

function deriveNextWeekSlots(nextWeekData: ReturnType<typeof useGameTime>['data']): GameTimeSlot[] | undefined {
    if (!nextWeekData?.slots) return undefined;
    return nextWeekData.slots.map((s: GameTimeSlot) => ({ dayOfWeek: s.dayOfWeek, hour: s.hour, status: s.status ?? 'available' }));
}

function useSaveHandler(slots: GameTimeSlot[], saveGameTime: ReturnType<typeof useSaveGameTime>, setEditSlots: (v: GameTimeSlot[] | null) => void) {
    return useCallback(async () => {
        const templateSlots = slots.filter(isAvailableSlot).map((s) => ({ dayOfWeek: s.dayOfWeek, hour: s.hour }));
        try { await saveGameTime.mutateAsync(templateSlots); setEditSlots(null); toast.success('Game time saved'); }
        catch { toast.error('Failed to save game time'); }
    }, [slots, saveGameTime, setEditSlots]);
}

export function useGameTimeEditor(options?: UseGameTimeEditorOptions): UseGameTimeEditorReturn {
    const enabled = options?.enabled ?? true;
    const rolling = options?.rolling ?? false;

    const { gameTimeData, nextWeekData, isLoading, tzLabel } = useGameTimeQueries(enabled, rolling);
    const saveGameTime = useSaveGameTime();
    const saveOverrides = useSaveGameTimeOverrides();
    const [editSlots, setEditSlots] = useState<GameTimeSlot[] | null>(null);
    const { todayIndex, currentHour } = useCurrentTime();

    const slots = useMemo(() => deriveDisplaySlots(editSlots, gameTimeData, rolling), [editSlots, gameTimeData, rolling]);
    const events = useMemo<GameTimeEventBlock[]>(() => (gameTimeData?.events as GameTimeEventBlock[]) ?? [], [gameTimeData]);
    const nextWeekEvents = useMemo(() => nextWeekData?.events as GameTimeEventBlock[] | undefined, [nextWeekData]);
    const nextWeekSlots = useMemo(() => deriveNextWeekSlots(nextWeekData), [nextWeekData]);

    const applyPreset = useCallback((dayOfWeek: number, preset: GameTimePreset) => {
        const [start, end] = PRESET_HOUR_RANGES[preset];
        setEditSlots(togglePresetSlots(editSlots ?? slots, dayOfWeek, Array.from({ length: end - start }, (_, i) => start + i)));
    }, [editSlots, slots]);

    const save = useSaveHandler(slots, saveGameTime, setEditSlots);

    return {
        slots, events, nextWeekEvents, nextWeekSlots, isLoading,
        weekStart: gameTimeData?.weekStart ?? '', isDirty: editSlots !== null,
        handleChange: useCallback((newSlots: GameTimeSlot[]) => setEditSlots(newSlots), []),
        applyPreset, save, clear: useCallback(() => setEditSlots([]), []), discard: useCallback(() => setEditSlots(null), []),
        isSaving: saveGameTime.isPending || saveOverrides.isPending, tzLabel, todayIndex, currentHour,
        overrides: (gameTimeData?.overrides as Array<{ date: string; hour: number; status: string }>) ?? [],
        absences: (gameTimeData?.absences as Array<{ id: number; startDate: string; endDate: string; reason: string | null }>) ?? [],
    };
}
