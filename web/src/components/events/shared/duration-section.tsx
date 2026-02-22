import { DURATION_PRESETS } from './event-form-constants';

export interface DurationSectionProps {
    durationMinutes: number;
    customDuration: boolean;
    durationError?: string;
    onDurationMinutesChange: (v: number) => void;
    onCustomDurationChange: (v: boolean) => void;
    onDurationErrorClear?: () => void;
}

export function DurationSection({
    durationMinutes,
    customDuration,
    durationError,
    onDurationMinutesChange,
    onCustomDurationChange,
    onDurationErrorClear,
}: DurationSectionProps) {
    return (
        <div>
            <label className="block text-sm font-medium text-secondary mb-2">
                Duration <span className="text-red-400">*</span>
            </label>
            <div className="flex flex-wrap gap-2 mb-3">
                {DURATION_PRESETS.map((preset) => (
                    <button
                        key={preset.minutes}
                        type="button"
                        onClick={() => {
                            onDurationMinutesChange(preset.minutes);
                            onCustomDurationChange(false);
                            onDurationErrorClear?.();
                        }}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                            !customDuration && durationMinutes === preset.minutes
                                ? 'bg-emerald-600 text-white'
                                : 'bg-panel border border-edge text-secondary hover:text-foreground hover:border-edge-subtle'
                        }`}
                    >
                        {preset.label}
                    </button>
                ))}
                <button
                    type="button"
                    onClick={() => onCustomDurationChange(true)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                        customDuration
                            ? 'bg-emerald-600 text-white'
                            : 'bg-panel border border-edge text-secondary hover:text-foreground hover:border-edge-subtle'
                    }`}
                >
                    Custom
                </button>
            </div>

            {customDuration && (
                <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 sm:items-center">
                    <div className="flex items-center gap-2">
                        <input
                            type="number"
                            min={0}
                            max={24}
                            value={Math.floor(durationMinutes / 60)}
                            onChange={(e) => {
                                const h = Math.max(0, Math.min(24, parseInt(e.target.value) || 0));
                                const m = durationMinutes % 60;
                                onDurationMinutesChange(h * 60 + m);
                                onDurationErrorClear?.();
                            }}
                            className="w-full sm:w-16 px-3 py-2 bg-panel border border-edge rounded-lg text-foreground text-center focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                        <span className="text-sm text-muted shrink-0">hr</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <input
                            type="number"
                            min={0}
                            max={59}
                            step={5}
                            value={durationMinutes % 60}
                            onChange={(e) => {
                                const h = Math.floor(durationMinutes / 60);
                                const m = Math.max(0, Math.min(59, parseInt(e.target.value) || 0));
                                onDurationMinutesChange(h * 60 + m);
                                onDurationErrorClear?.();
                            }}
                            className="w-full sm:w-16 px-3 py-2 bg-panel border border-edge rounded-lg text-foreground text-center focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                        <span className="text-sm text-muted shrink-0">min</span>
                    </div>
                </div>
            )}

            {durationError && (
                <p className="mt-1 text-sm text-red-400">{durationError}</p>
            )}
        </div>
    );
}
