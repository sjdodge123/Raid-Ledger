import { useCallback, useMemo } from 'react';
import type { GameTimeSlot } from '@raid-ledger/contract';

const FULL_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const ALL_HOURS = Array.from({ length: 24 }, (_, i) => i);

function formatHour(hour: number): string {
    if (hour === 0 || hour === 24) return '12a';
    if (hour === 12) return '12p';
    return hour < 12 ? `${hour}a` : `${hour - 12}p`;
}

export type Preset = 'morning' | 'afternoon' | 'evening' | 'night';

const PRESET_RANGES: Record<Preset, [number, number]> = {
    morning: [6, 12],
    afternoon: [12, 18],
    evening: [18, 24],
    night: [0, 6],
};

const PRESET_LABELS: Record<Preset, string> = {
    morning: 'Morning',
    afternoon: 'Afternoon',
    evening: 'Evening',
    night: 'Night',
};

const PRESET_SUBLABELS: Record<Preset, string> = {
    morning: '6a-12p',
    afternoon: '12p-6p',
    evening: '6p-12a',
    night: '12a-6a',
};

interface DaySectionProps {
    dayIndex: number;
    slots: GameTimeSlot[];
    expanded: boolean;
    onToggle: () => void;
    onHourToggle: (dayIndex: number, hour: number) => void;
    onPreset: (dayIndex: number, preset: Preset) => void;
    readOnly?: boolean;
}

export function DaySection({
    dayIndex,
    slots,
    expanded,
    onToggle,
    onHourToggle,
    onPreset,
    readOnly,
}: DaySectionProps) {
    const dayName = FULL_DAYS[dayIndex];

    const activeSet = useMemo(
        () =>
            new Set(
                slots
                    .filter((s) => s.dayOfWeek === dayIndex && (s.status === 'available' || !s.status))
                    .map((s) => s.hour),
            ),
        [slots, dayIndex],
    );

    const activeCount = activeSet.size;

    const handlePreset = useCallback(
        (preset: Preset) => {
            onPreset(dayIndex, preset);
        },
        [dayIndex, onPreset],
    );

    const isPresetFullyActive = useCallback(
        (preset: Preset) => {
            const [start, end] = PRESET_RANGES[preset];
            for (let h = start; h < end; h++) {
                if (!activeSet.has(h)) return false;
            }
            return true;
        },
        [activeSet],
    );

    return (
        <div className="border border-edge rounded-lg overflow-hidden">
            {/* Day header — always visible, fixed height */}
            <button
                type="button"
                className="w-full h-11 flex items-center justify-between px-3 bg-panel/50 hover:bg-panel/80 active:bg-panel transition-colors"
                onClick={onToggle}
            >
                <div className="flex items-center gap-2">
                    <svg
                        className={`w-3.5 h-3.5 text-muted transition-transform ${expanded ? 'rotate-90' : ''}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    <span className="text-sm font-medium text-foreground">{dayName}</span>
                </div>
                <span className={`text-xs tabular-nums ${activeCount > 0 ? 'text-emerald-400' : 'text-dim'}`}>
                    {activeCount > 0 ? `${activeCount}h selected` : 'None'}
                </span>
            </button>

            {/* Expanded content */}
            {expanded && (
                <div className="px-3 py-2.5 space-y-2.5 bg-surface/50">
                    {/* Presets */}
                    {!readOnly && (
                        <div className="grid grid-cols-4 gap-1.5">
                            {(Object.keys(PRESET_LABELS) as Preset[]).map((preset) => {
                                const fullyActive = isPresetFullyActive(preset);
                                return (
                                    <button
                                        key={preset}
                                        type="button"
                                        onClick={() => handlePreset(preset)}
                                        className={`flex flex-col items-center py-2 rounded-lg text-xs font-medium transition-colors active:scale-95 ${
                                            fullyActive
                                                ? 'bg-emerald-600 text-white shadow-sm'
                                                : 'bg-panel text-muted hover:bg-overlay active:bg-overlay'
                                        }`}
                                    >
                                        <span>{PRESET_LABELS[preset]}</span>
                                        <span className={`text-[10px] mt-0.5 ${fullyActive ? 'text-white/70' : 'text-dim'}`}>{PRESET_SUBLABELS[preset]}</span>
                                    </button>
                                );
                            })}
                        </div>
                    )}

                    {/* 4-column hour grid */}
                    <div className="grid grid-cols-4 gap-1.5">
                        {ALL_HOURS.map((hour) => {
                            const isActive = activeSet.has(hour);
                            return (
                                <button
                                    key={hour}
                                    type="button"
                                    disabled={readOnly}
                                    onClick={() => onHourToggle(dayIndex, hour)}
                                    className={`h-12 rounded-lg text-xs font-medium transition-colors ${
                                        isActive
                                            ? 'bg-emerald-600 text-white shadow-sm'
                                            : 'bg-panel text-muted hover:bg-overlay'
                                    } ${
                                        readOnly
                                            ? 'cursor-default'
                                            : 'active:scale-95'
                                    }`}
                                >
                                    {formatHour(hour)}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
