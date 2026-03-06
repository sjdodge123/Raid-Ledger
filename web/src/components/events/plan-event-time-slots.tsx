import type { PollOption, TimeSuggestionsResponse } from '@raid-ledger/contract';

const POLL_DURATION_PRESETS = [
    { label: '6h', hours: 6 },
    { label: '12h', hours: 12 },
    { label: '24h', hours: 24 },
    { label: '48h', hours: 48 },
    { label: '72h', hours: 72 },
] as const;

interface TimeSlotsProps {
    suggestions: TimeSuggestionsResponse | undefined;
    suggestionsLoading: boolean;
    selectedTimeSlots: PollOption[];
    alreadySelected: Set<string>;
    customDate: string;
    customTime: string;
    onAddTimeSlot: (option: PollOption) => void;
    onRemoveTimeSlot: (date: string) => void;
    onCustomDateChange: (value: string) => void;
    onCustomTimeChange: (value: string) => void;
    onAddCustomTime: () => void;
    timeSlotsError?: string;
}

export function TimeSlotsSection({
    suggestions, suggestionsLoading, selectedTimeSlots, alreadySelected,
    customDate, customTime, onAddTimeSlot, onRemoveTimeSlot,
    onCustomDateChange, onCustomTimeChange, onAddCustomTime, timeSlotsError,
}: TimeSlotsProps) {
    return (
        <>
            <p className="text-xs text-muted -mt-2">
                Select 2-9 time options for the poll. Times ranked by community availability.
            </p>

            {suggestionsLoading ? (
                <div className="text-sm text-muted">Loading suggestions...</div>
            ) : suggestions && suggestions.suggestions.length > 0 ? (
                <div className="space-y-2">
                    {suggestions.source === 'game-interest' && (
                        <p className="text-xs text-emerald-400">
                            Based on {suggestions.interestedPlayerCount} interested player{suggestions.interestedPlayerCount !== 1 ? 's' : ''}' game time
                        </p>
                    )}
                    <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto">
                        {suggestions.suggestions.map((s: TimeSuggestionsResponse['suggestions'][number]) => {
                            const isSelected = alreadySelected.has(s.date);
                            return (
                                <button
                                    key={s.date}
                                    type="button"
                                    onClick={() => onAddTimeSlot({ date: s.date, label: s.label })}
                                    disabled={isSelected || selectedTimeSlots.length >= 9}
                                    className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                                        isSelected
                                            ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/40 cursor-default'
                                            : 'bg-panel border border-edge text-secondary hover:text-foreground hover:border-emerald-500 disabled:opacity-40'
                                    }`}
                                >
                                    {s.label}
                                    {s.availableCount > 0 && (
                                        <span className="ml-1.5 text-xs text-emerald-400">({s.availableCount})</span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </div>
            ) : (
                <p className="text-sm text-muted">
                    No suggestions available. Add custom times below.
                </p>
            )}

            {/* Custom Time Entry */}
            <div className="bg-panel/50 border border-edge-subtle rounded-lg p-4 space-y-3">
                <p className="text-sm font-medium text-secondary">Add Custom Time</p>
                <div className="flex flex-col sm:flex-row gap-3">
                    <input
                        type="date"
                        value={customDate}
                        onChange={(e) => onCustomDateChange(e.target.value)}
                        className="flex-1 px-3 py-2 bg-panel border border-edge rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    <input
                        type="time"
                        value={customTime}
                        onChange={(e) => onCustomTimeChange(e.target.value)}
                        className="flex-1 px-3 py-2 bg-panel border border-edge rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    <button
                        type="button"
                        onClick={onAddCustomTime}
                        disabled={!customDate || !customTime || selectedTimeSlots.length >= 9}
                        className="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:bg-overlay disabled:text-muted text-white text-sm font-medium rounded-lg transition-colors"
                    >
                        Add
                    </button>
                </div>
            </div>

            {/* Selected Slots Summary */}
            {selectedTimeSlots.length > 0 && (
                <div className="space-y-2">
                    <p className="text-sm font-medium text-secondary">
                        Selected ({selectedTimeSlots.length}/9)
                    </p>
                    <div className="space-y-1">
                        {selectedTimeSlots.map((slot) => (
                            <div
                                key={slot.date}
                                className="flex items-center justify-between px-3 py-2 bg-emerald-600/10 border border-emerald-500/20 rounded-lg"
                            >
                                <span className="text-sm text-foreground">{slot.label}</span>
                                <button
                                    type="button"
                                    onClick={() => onRemoveTimeSlot(slot.date)}
                                    className="p-1 text-muted hover:text-red-400 transition-colors"
                                    aria-label="Remove time slot"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}
            {timeSlotsError && <p className="text-sm text-red-400">{timeSlotsError}</p>}
        </>
    );
}

interface PollSettingsProps {
    pollDurationHours: number;
    pollMode: 'standard' | 'all_or_nothing';
    onPollDurationChange: (hours: number) => void;
    onPollModeChange: (mode: 'standard' | 'all_or_nothing') => void;
}

export function PollSettingsSection({
    pollDurationHours, pollMode, onPollDurationChange, onPollModeChange,
}: PollSettingsProps) {
    return (
        <>
            <div>
                <label className="block text-sm font-medium text-secondary mb-2">Poll Duration</label>
                <div className="flex flex-wrap gap-2">
                    {POLL_DURATION_PRESETS.map((preset) => (
                        <button
                            key={preset.hours}
                            type="button"
                            onClick={() => onPollDurationChange(preset.hours)}
                            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                                pollDurationHours === preset.hours
                                    ? 'bg-emerald-600 text-white'
                                    : 'bg-panel border border-edge text-secondary hover:text-foreground hover:border-edge-subtle'
                            }`}
                        >
                            {preset.label}
                        </button>
                    ))}
                </div>
            </div>

            <div>
                <label className="block text-sm font-medium text-secondary mb-2">Poll Mode</label>
                <div className="flex gap-2">
                    <button
                        type="button"
                        onClick={() => onPollModeChange('standard')}
                        className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                            pollMode === 'standard'
                                ? 'bg-emerald-600 text-white'
                                : 'bg-panel border border-edge text-secondary hover:text-foreground'
                        }`}
                    >
                        Standard
                    </button>
                    <button
                        type="button"
                        onClick={() => onPollModeChange('all_or_nothing')}
                        className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                            pollMode === 'all_or_nothing'
                                ? 'bg-violet-600 text-white'
                                : 'bg-panel border border-edge text-secondary hover:text-foreground'
                        }`}
                    >
                        All or Nothing
                    </button>
                </div>
                <p className="mt-2 text-xs text-dim">
                    {pollMode === 'standard'
                        ? '"None of these work" only wins if it gets the most votes. Otherwise, the top time wins.'
                        : 'If ANY voter picks "None of these work", the poll re-sends with new time suggestions until everyone agrees.'}
                </p>
            </div>
        </>
    );
}
