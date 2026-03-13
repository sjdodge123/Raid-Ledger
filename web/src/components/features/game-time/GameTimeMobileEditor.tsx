import { useState, useCallback } from 'react';
import type { GameTimeSlot } from '@raid-ledger/contract';
import { DaySection } from './DaySection';
import type { Preset } from './DaySection';
import { toggleAllDaySlots, isSlotActive } from './game-time-slot.utils';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

const PRESET_RANGES: Record<Preset, [number, number]> = {
    morning: [6, 12],
    afternoon: [12, 18],
    evening: [18, 24],
    night: [0, 6],
};

interface GameTimeMobileEditorProps {
    slots: GameTimeSlot[];
    onChange: (slots: GameTimeSlot[]) => void;
    readOnly?: boolean;
    tzLabel?: string;
}

function togglePresetSlots(slots: GameTimeSlot[], dayIndex: number, preset: Preset): GameTimeSlot[] {
    const [start, end] = PRESET_RANGES[preset];
    const rangeHours = Array.from({ length: end - start }, (_, i) => start + i);
    const allActive = rangeHours.every((h) => slots.some((s) => s.dayOfWeek === dayIndex && s.hour === h && isSlotActive(s)));

    if (allActive) {
        return slots.filter((s) => !(s.dayOfWeek === dayIndex && rangeHours.includes(s.hour) && isSlotActive(s)));
    }
    const existingHours = new Set(slots.filter((s) => s.dayOfWeek === dayIndex && isSlotActive(s)).map((s) => s.hour));
    const toAdd = rangeHours.filter((h) => !existingHours.has(h)).map((h) => ({ dayOfWeek: dayIndex, hour: h, status: 'available' as const }));
    return [...slots, ...toAdd];
}

/** Encapsulates slot-manipulation callbacks for the mobile editor */
function useMobileEditorHandlers(slots: GameTimeSlot[], onChange: (s: GameTimeSlot[]) => void, readOnly?: boolean) {
    const handleHourToggle = useCallback((dayIndex: number, hour: number) => {
        if (readOnly) return;
        const existing = slots.find((s) => s.dayOfWeek === dayIndex && s.hour === hour);
        if (existing && isSlotActive(existing)) {
            onChange(slots.filter((s) => !(s.dayOfWeek === dayIndex && s.hour === hour)));
        } else if (!existing) {
            onChange([...slots, { dayOfWeek: dayIndex, hour, status: 'available' }]);
        }
    }, [slots, onChange, readOnly]);

    const handlePreset = useCallback((dayIndex: number, preset: Preset) => {
        if (readOnly) return;
        onChange(togglePresetSlots(slots, dayIndex, preset));
    }, [slots, onChange, readOnly]);

    const handleAllDay = useCallback((dayIndex: number) => {
        if (readOnly) return;
        onChange(toggleAllDaySlots(slots, dayIndex));
    }, [slots, onChange, readOnly]);

    return { handleHourToggle, handlePreset, handleAllDay };
}

/** Mobile game-time editor with collapsible day sections */
export function GameTimeMobileEditor({ slots, onChange, readOnly, tzLabel }: GameTimeMobileEditorProps) {
    const [expandedDay, setExpandedDay] = useState<number | null>(null);
    const handleToggle = useCallback((dayIndex: number) => {
        setExpandedDay((prev) => (prev === dayIndex ? null : dayIndex));
    }, []);
    const { handleHourToggle, handlePreset, handleAllDay } = useMobileEditorHandlers(slots, onChange, readOnly);

    return (
        <div className="space-y-2" data-testid="game-time-mobile-editor">
            {tzLabel && <div className="flex items-center justify-end"><span className="text-[10px] text-dim font-medium">{tzLabel}</span></div>}
            {DAYS.map((_, i) => (
                <DaySection key={i} dayIndex={i} slots={slots} expanded={expandedDay === i} onToggle={() => handleToggle(i)} onHourToggle={handleHourToggle} onPreset={handlePreset} readOnly={readOnly} onAllDay={readOnly ? undefined : handleAllDay} />
            ))}
        </div>
    );
}
