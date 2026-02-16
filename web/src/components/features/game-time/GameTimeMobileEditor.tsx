import { useState, useCallback } from 'react';
import type { GameTimeSlot } from '@raid-ledger/contract';
import { DaySection } from './DaySection';
import type { Preset } from './DaySection';

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

export function GameTimeMobileEditor({
    slots,
    onChange,
    readOnly,
    tzLabel,
}: GameTimeMobileEditorProps) {
    const [expandedDay, setExpandedDay] = useState<number | null>(null);

    const handleToggle = useCallback((dayIndex: number) => {
        setExpandedDay((prev) => (prev === dayIndex ? null : dayIndex));
    }, []);

    const handleHourToggle = useCallback(
        (dayIndex: number, hour: number) => {
            if (readOnly) return;
            const existing = slots.find(
                (s) => s.dayOfWeek === dayIndex && s.hour === hour,
            );
            if (existing && (existing.status === 'available' || !existing.status)) {
                onChange(slots.filter((s) => !(s.dayOfWeek === dayIndex && s.hour === hour)));
            } else if (!existing) {
                onChange([...slots, { dayOfWeek: dayIndex, hour, status: 'available' }]);
            }
        },
        [slots, onChange, readOnly],
    );

    const handlePreset = useCallback(
        (dayIndex: number, preset: Preset) => {
            if (readOnly) return;
            const [start, end] = PRESET_RANGES[preset];
            const rangeHours = Array.from({ length: end - start }, (_, i) => start + i);

            // Check if all hours in the preset are already active
            const allActive = rangeHours.every((h) =>
                slots.some(
                    (s) =>
                        s.dayOfWeek === dayIndex &&
                        s.hour === h &&
                        (s.status === 'available' || !s.status),
                ),
            );

            let newSlots: GameTimeSlot[];
            if (allActive) {
                // Remove all hours in range
                newSlots = slots.filter(
                    (s) =>
                        !(
                            s.dayOfWeek === dayIndex &&
                            rangeHours.includes(s.hour) &&
                            (s.status === 'available' || !s.status)
                        ),
                );
            } else {
                // Add missing hours in range
                const existingHours = new Set(
                    slots
                        .filter(
                            (s) =>
                                s.dayOfWeek === dayIndex &&
                                (s.status === 'available' || !s.status),
                        )
                        .map((s) => s.hour),
                );
                const toAdd = rangeHours
                    .filter((h) => !existingHours.has(h))
                    .map((h) => ({ dayOfWeek: dayIndex, hour: h, status: 'available' as const }));
                newSlots = [...slots, ...toAdd];
            }
            onChange(newSlots);
        },
        [slots, onChange, readOnly],
    );

    return (
        <div className="space-y-2" data-testid="game-time-mobile-editor">
            {/* Timezone label */}
            {tzLabel && (
                <div className="flex items-center justify-end">
                    <span className="text-[10px] text-dim font-medium">{tzLabel}</span>
                </div>
            )}

            {/* Day sections */}
            {DAYS.map((_, i) => (
                <DaySection
                    key={i}
                    dayIndex={i}
                    slots={slots}
                    expanded={expandedDay === i}
                    onToggle={() => handleToggle(i)}
                    onHourToggle={handleHourToggle}
                    onPreset={handlePreset}
                    readOnly={readOnly}
                />
            ))}
        </div>
    );
}
