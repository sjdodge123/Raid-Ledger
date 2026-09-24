import { useId } from 'react';
import type { PollOption, TimeSuggestionsResponse } from '@raid-ledger/contract';
import { Button } from '../ui/button';
import { Field } from '../ui/field';
import { Input } from '../ui/input';
import { RadioGroup } from '../ui/radio-group';

const POLL_DURATION_PRESETS = [
    { label: '6h', hours: 6 },
    { label: '12h', hours: 12 },
    { label: '24h', hours: 24 },
    { label: '48h', hours: 48 },
    { label: '72h', hours: 72 },
] as const;

type PollMode = 'standard' | 'all_or_nothing';

const POLL_MODE_OPTIONS: { value: PollMode; label: string }[] = [
    { value: 'standard', label: 'Standard' },
    { value: 'all_or_nothing', label: 'All or Nothing' },
];

/**
 * Selected chip: a success tint on tokens, at full opacity. `!` because these
 * override the secondary variant's own bg / text / border and the shared
 * disabled fade (a picked slot is disabled so it can't be added twice).
 */
const SELECTED_CHIP_CLS = 'bg-success/10! text-success! border-success/40! disabled:opacity-100! disabled:cursor-default!';

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

function SuggestionButton({ s, isSelected, onAdd, disabled }: {
    s: TimeSuggestionsResponse['suggestions'][number]; isSelected: boolean; onAdd: () => void; disabled: boolean;
}) {
    return (
        <Button variant="secondary" size="sm" onClick={onAdd} disabled={isSelected || disabled}
            className={isSelected ? SELECTED_CHIP_CLS : undefined}>
            {s.label}
            {s.availableCount > 0 && <span className="text-xs text-success">({s.availableCount})</span>}
        </Button>
    );
}

function SuggestionsList({ suggestions, alreadySelected, selectedCount, onAddTimeSlot }: {
    suggestions: TimeSuggestionsResponse; alreadySelected: Set<string>;
    selectedCount: number; onAddTimeSlot: (option: PollOption) => void;
}) {
    return (
        <div className="space-y-2">
            {suggestions.source === 'game-interest' && (
                <p className="text-xs text-success">
                    Based on {suggestions.interestedPlayerCount} interested player{suggestions.interestedPlayerCount !== 1 ? 's' : ''}' game time
                </p>
            )}
            <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto">
                {suggestions.suggestions.map((s) => (
                    <SuggestionButton key={s.date} s={s} isSelected={alreadySelected.has(s.date)}
                        onAdd={() => onAddTimeSlot({ date: s.date, label: s.label })} disabled={selectedCount >= 9} />
                ))}
            </div>
        </div>
    );
}

function CustomTimeEntry({ customDate, customTime, disabled, onDateChange, onTimeChange, onAdd }: {
    customDate: string; customTime: string; disabled: boolean;
    onDateChange: (v: string) => void; onTimeChange: (v: string) => void; onAdd: () => void;
}) {
    return (
        <div className="bg-panel/50 border border-edge-subtle rounded-lg p-4 space-y-3">
            <p className="text-sm font-medium text-secondary">Add Custom Time</p>
            <div className="flex flex-col sm:flex-row gap-3">
                <Field label="Custom date" hideLabel className="flex-1">
                    <Input type="date" value={customDate} onChange={(e) => onDateChange(e.target.value)} />
                </Field>
                <Field label="Custom time" hideLabel className="flex-1">
                    <Input type="time" value={customTime} onChange={(e) => onTimeChange(e.target.value)} />
                </Field>
                <Button onClick={onAdd} disabled={!customDate || !customTime || disabled}>
                    Add
                </Button>
            </div>
        </div>
    );
}

function SelectedSlotsList({ slots, onRemove }: { slots: PollOption[]; onRemove: (date: string) => void }) {
    if (slots.length === 0) return null;
    return (
        <div className="space-y-2">
            <p className="text-sm font-medium text-secondary">Selected ({slots.length}/9)</p>
            <div className="space-y-1">
                {slots.map((slot) => (
                    <div key={slot.date} className="flex items-center justify-between pl-3 pr-1 py-1 bg-success/10 border border-success/20 rounded-lg">
                        <span className="text-sm text-foreground">{slot.label}</span>
                        <Button variant="ghost" size="sm" iconOnly aria-label="Remove time slot" onClick={() => onRemove(slot.date)}>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </Button>
                    </div>
                ))}
            </div>
        </div>
    );
}

export function TimeSlotsSection({
    suggestions, suggestionsLoading, selectedTimeSlots, alreadySelected,
    customDate, customTime, onAddTimeSlot, onRemoveTimeSlot,
    onCustomDateChange, onCustomTimeChange, onAddCustomTime, timeSlotsError,
}: TimeSlotsProps) {
    return (
        <>
            <p className="text-xs text-muted -mt-2">Select 2-9 time options for the poll. Times ranked by community availability.</p>
            {suggestionsLoading ? (
                <div className="text-sm text-muted">Loading suggestions...</div>
            ) : suggestions && suggestions.suggestions.length > 0 ? (
                <SuggestionsList suggestions={suggestions} alreadySelected={alreadySelected}
                    selectedCount={selectedTimeSlots.length} onAddTimeSlot={onAddTimeSlot} />
            ) : (
                <p className="text-sm text-muted">No suggestions available. Add custom times below.</p>
            )}
            <CustomTimeEntry customDate={customDate} customTime={customTime} disabled={selectedTimeSlots.length >= 9}
                onDateChange={onCustomDateChange} onTimeChange={onCustomTimeChange} onAdd={onAddCustomTime} />
            <SelectedSlotsList slots={selectedTimeSlots} onRemove={onRemoveTimeSlot} />
            {timeSlotsError && <p role="alert" className="text-sm text-danger">{timeSlotsError}</p>}
        </>
    );
}

interface PollSettingsProps {
    pollDurationHours: number;
    pollMode: PollMode;
    onPollDurationChange: (hours: number) => void;
    onPollModeChange: (mode: PollMode) => void;
}

function PollDurationButtons({ pollDurationHours, onChange }: { pollDurationHours: number; onChange: (h: number) => void }) {
    const options = POLL_DURATION_PRESETS.map((p) => ({ value: String(p.hours), label: p.label }));
    return (
        <RadioGroup label="Poll Duration" appearance="segmented" options={options}
            value={String(pollDurationHours)} onChange={(v) => onChange(Number(v))} />
    );
}

function PollModeToggle({ pollMode, onChange }: { pollMode: PollMode; onChange: (m: PollMode) => void }) {
    const descId = useId();
    return (
        <div>
            <RadioGroup label="Poll Mode" appearance="segmented" options={POLL_MODE_OPTIONS}
                value={pollMode} onChange={onChange} aria-describedby={descId} />
            <p id={descId} className="mt-2 text-xs text-dim">
                {pollMode === 'standard'
                    ? '"None of these work" only wins if it gets the most votes. Otherwise, the top time wins.'
                    : 'If ANY voter picks "None of these work", the poll re-sends with new time suggestions until everyone agrees.'}
            </p>
        </div>
    );
}

export function PollSettingsSection({ pollDurationHours, pollMode, onPollDurationChange, onPollModeChange }: PollSettingsProps) {
    return (
        <>
            <PollDurationButtons pollDurationHours={pollDurationHours} onChange={onPollDurationChange} />
            <PollModeToggle pollMode={pollMode} onChange={onPollModeChange} />
        </>
    );
}
