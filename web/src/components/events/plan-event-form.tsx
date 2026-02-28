import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { IgdbGameDto, SlotConfigDto, CreateEventPlanDto, PollOption } from '@raid-ledger/contract';
import { useTimeSuggestions, useCreateEventPlan } from '../../hooks/use-event-plans';
import { useAdminSettings } from '../../hooks/use-admin-settings';
import '../../pages/event-detail-page.css';
import { MMO_DEFAULTS, GENERIC_DEFAULTS, type SlotState } from './shared/event-form-constants';
import { GameDetailsSection } from './shared/game-details-section';
import { useRegistryGameId } from './shared/use-registry-game-id';
import { DurationSection } from './shared/duration-section';
import { RosterSection } from './shared/roster-section';
import { RemindersSection } from './shared/reminders-section';

const POLL_DURATION_PRESETS = [
    { label: '6h', hours: 6 },
    { label: '12h', hours: 12 },
    { label: '24h', hours: 24 },
    { label: '48h', hours: 48 },
    { label: '72h', hours: 72 },
] as const;

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="space-y-4">
            <h3 className="text-sm font-semibold text-muted uppercase tracking-wider">{title}</h3>
            <div className="space-y-4">{children}</div>
        </div>
    );
}

interface FormState {
    title: string;
    description: string;
    game: IgdbGameDto | null;
    eventTypeId: number | null;
    durationMinutes: number;
    customDuration: boolean;
    slotType: 'mmo' | 'generic';
    slotTank: number;
    slotHealer: number;
    slotDps: number;
    slotFlex: number;
    slotPlayer: number;
    slotBench: number;
    maxAttendees: string;
    autoUnbench: boolean;
    pollDurationHours: number;
    pollMode: 'standard' | 'all_or_nothing';
    selectedTimeSlots: PollOption[];
    customDate: string;
    customTime: string;
    reminder15min: boolean;
    reminder1hour: boolean;
    reminder24hour: boolean;
    selectedInstances: Record<string, unknown>[];
    titleIsAutoSuggested: boolean;
    descriptionIsAutoSuggested: boolean;
}

/**
 * Plan Event Form — lets organizers pick candidate time slots and start a community poll.
 */
export function PlanEventForm() {
    const navigate = useNavigate();
    const createPlanMutation = useCreateEventPlan();
    const { defaultTimezone } = useAdminSettings();
    const communityTimezone = defaultTimezone.data?.timezone ?? undefined;

    const [form, setForm] = useState<FormState>({
        title: '',
        description: '',
        game: null,
        eventTypeId: null,
        durationMinutes: 120,
        customDuration: false,
        slotType: 'generic',
        slotTank: MMO_DEFAULTS.tank!,
        slotHealer: MMO_DEFAULTS.healer!,
        slotDps: MMO_DEFAULTS.dps!,
        slotFlex: MMO_DEFAULTS.flex!,
        slotPlayer: GENERIC_DEFAULTS.player!,
        slotBench: GENERIC_DEFAULTS.bench!,
        maxAttendees: '',
        autoUnbench: true,
        pollDurationHours: 24,
        pollMode: 'standard',
        selectedTimeSlots: [],
        customDate: '',
        customTime: '',
        reminder15min: true,
        reminder1hour: false,
        reminder24hour: false,
        selectedInstances: [],
        titleIsAutoSuggested: false,
        descriptionIsAutoSuggested: false,
    });

    const [errors, setErrors] = useState<Record<string, string>>({});

    // Registry game ID for submission and time suggestions
    const registryGameId = useRegistryGameId(form.game);

    // Fetch time suggestions
    const { data: suggestions, isLoading: suggestionsLoading } = useTimeSuggestions({
        gameId: registryGameId,
        tzOffset: new Date().getTimezoneOffset(),
    });

    function updateField<K extends keyof FormState>(field: K, value: FormState[K]) {
        setForm((prev) => ({ ...prev, [field]: value }));
        if (field in errors) {
            setErrors((prev) => ({ ...prev, [field]: '' }));
        }
    }

    function addTimeSlot(option: PollOption) {
        if (form.selectedTimeSlots.length >= 9) return;
        if (form.selectedTimeSlots.some((s) => s.date === option.date)) return;
        setForm((prev) => ({
            ...prev,
            selectedTimeSlots: [...prev.selectedTimeSlots, option],
        }));
        setErrors((prev) => ({ ...prev, timeSlots: '' }));
    }

    function removeTimeSlot(date: string) {
        setForm((prev) => ({
            ...prev,
            selectedTimeSlots: prev.selectedTimeSlots.filter((s) => s.date !== date),
        }));
    }

    function addCustomTime() {
        if (!form.customDate || !form.customTime) return;
        const dateObj = new Date(`${form.customDate}T${form.customTime}`);
        if (isNaN(dateObj.getTime())) return;

        const label = dateObj.toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
            timeZoneName: 'short',
            ...(communityTimezone ? { timeZone: communityTimezone } : {}),
        });

        addTimeSlot({ date: dateObj.toISOString(), label });
        setForm((prev) => ({ ...prev, customDate: '', customTime: '' }));
    }

    function buildSlotConfig(): SlotConfigDto | undefined {
        if (form.slotType === 'mmo') {
            return {
                type: 'mmo',
                tank: form.slotTank,
                healer: form.slotHealer,
                dps: form.slotDps,
                flex: form.slotFlex,
                bench: form.slotBench,
            };
        }
        return {
            type: 'generic',
            player: form.slotPlayer,
            bench: form.slotBench,
        };
    }

    function validate(): Record<string, string> {
        const newErrors: Record<string, string> = {};
        if (!form.title.trim()) newErrors.title = 'Title is required';
        if (form.selectedTimeSlots.length < 2) newErrors.timeSlots = 'Select at least 2 time options';
        if (form.selectedTimeSlots.length > 9) newErrors.timeSlots = 'Maximum 9 time options';
        if (form.durationMinutes <= 0) newErrors.duration = 'Duration must be greater than 0';
        setErrors(newErrors);
        return newErrors;
    }

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        const validationErrors = validate();
        if (Object.keys(validationErrors).length > 0) return;

        const dto: CreateEventPlanDto = {
            title: form.title.trim(),
            description: form.description.trim() || undefined,
            gameId: registryGameId,
            slotConfig: buildSlotConfig(),
            maxAttendees: form.maxAttendees ? parseInt(form.maxAttendees) : undefined,
            autoUnbench: form.autoUnbench,
            durationMinutes: form.durationMinutes,
            pollOptions: form.selectedTimeSlots,
            pollDurationHours: form.pollDurationHours,
            pollMode: form.pollMode,
            contentInstances: form.selectedInstances.length > 0 ? form.selectedInstances : undefined,
            reminder15min: form.reminder15min,
            reminder1hour: form.reminder1hour,
            reminder24hour: form.reminder24hour,
        };

        createPlanMutation.mutate(dto, {
            onSuccess: () => navigate('/events'),
        });
    }

    const alreadySelected = new Set(form.selectedTimeSlots.map((s) => s.date));

    return (
        <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-8">
            {/* Game & Details */}
            <FormSection title="Game & Details">
                <GameDetailsSection
                    game={form.game}
                    eventTypeId={form.eventTypeId}
                    title={form.title}
                    description={form.description}
                    selectedInstances={form.selectedInstances}
                    titleIsAutoSuggested={form.titleIsAutoSuggested}
                    descriptionIsAutoSuggested={form.descriptionIsAutoSuggested}
                    titleError={errors.title}
                    titleInputId="planTitle"
                    eventTypeSelectId="planEventType"
                    onGameChange={(game) => setForm((prev) => ({ ...prev, game, titleIsAutoSuggested: prev.titleIsAutoSuggested }))}
                    onEventTypeIdChange={(id) => setForm((prev) => ({ ...prev, eventTypeId: id }))}
                    onTitleChange={(title, isAuto) => {
                        setForm((prev) => ({ ...prev, title, titleIsAutoSuggested: isAuto }));
                        if (!isAuto && errors.title) setErrors((prev) => ({ ...prev, title: '' }));
                    }}
                    onDescriptionChange={(description, isAuto) => setForm((prev) => ({ ...prev, description, descriptionIsAutoSuggested: isAuto }))}
                    onSelectedInstancesChange={(instances) => setForm((prev) => ({ ...prev, selectedInstances: instances }))}
                    onEventTypeDefaults={(defaults: Partial<SlotState>) => setForm((prev) => ({ ...prev, ...defaults }))}
                />
            </FormSection>

            <div className="border-t border-edge-subtle" />

            {/* Candidate Time Slots */}
            <FormSection title="Candidate Time Slots">
                <p className="text-xs text-muted -mt-2">
                    Select 2-9 time options for the poll. Times ranked by community availability.
                </p>

                {/* Smart Suggestions */}
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
                            {suggestions.suggestions.map((s) => {
                                const isSelected = alreadySelected.has(s.date);
                                return (
                                    <button
                                        key={s.date}
                                        type="button"
                                        onClick={() => addTimeSlot({ date: s.date, label: s.label })}
                                        disabled={isSelected || form.selectedTimeSlots.length >= 9}
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
                            value={form.customDate}
                            onChange={(e) => updateField('customDate', e.target.value)}
                            className="flex-1 px-3 py-2 bg-panel border border-edge rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                        <input
                            type="time"
                            value={form.customTime}
                            onChange={(e) => updateField('customTime', e.target.value)}
                            className="flex-1 px-3 py-2 bg-panel border border-edge rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                        <button
                            type="button"
                            onClick={addCustomTime}
                            disabled={!form.customDate || !form.customTime || form.selectedTimeSlots.length >= 9}
                            className="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:bg-overlay disabled:text-muted text-white text-sm font-medium rounded-lg transition-colors"
                        >
                            Add
                        </button>
                    </div>
                </div>

                {/* Selected Slots Summary */}
                {form.selectedTimeSlots.length > 0 && (
                    <div className="space-y-2">
                        <p className="text-sm font-medium text-secondary">
                            Selected ({form.selectedTimeSlots.length}/9)
                        </p>
                        <div className="space-y-1">
                            {form.selectedTimeSlots.map((slot) => (
                                <div
                                    key={slot.date}
                                    className="flex items-center justify-between px-3 py-2 bg-emerald-600/10 border border-emerald-500/20 rounded-lg"
                                >
                                    <span className="text-sm text-foreground">{slot.label}</span>
                                    <button
                                        type="button"
                                        onClick={() => removeTimeSlot(slot.date)}
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
                {errors.timeSlots && <p className="text-sm text-red-400">{errors.timeSlots}</p>}
            </FormSection>

            <div className="border-t border-edge-subtle" />

            {/* Poll Settings */}
            <FormSection title="Poll Settings">
                {/* Poll Duration */}
                <div>
                    <label className="block text-sm font-medium text-secondary mb-2">Poll Duration</label>
                    <div className="flex flex-wrap gap-2">
                        {POLL_DURATION_PRESETS.map((preset) => (
                            <button
                                key={preset.hours}
                                type="button"
                                onClick={() => updateField('pollDurationHours', preset.hours)}
                                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                                    form.pollDurationHours === preset.hours
                                        ? 'bg-emerald-600 text-white'
                                        : 'bg-panel border border-edge text-secondary hover:text-foreground hover:border-edge-subtle'
                                }`}
                            >
                                {preset.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Poll Mode */}
                <div>
                    <label className="block text-sm font-medium text-secondary mb-2">Poll Mode</label>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => updateField('pollMode', 'standard')}
                            className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                                form.pollMode === 'standard'
                                    ? 'bg-emerald-600 text-white'
                                    : 'bg-panel border border-edge text-secondary hover:text-foreground'
                            }`}
                        >
                            Standard
                        </button>
                        <button
                            type="button"
                            onClick={() => updateField('pollMode', 'all_or_nothing')}
                            className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                                form.pollMode === 'all_or_nothing'
                                    ? 'bg-violet-600 text-white'
                                    : 'bg-panel border border-edge text-secondary hover:text-foreground'
                            }`}
                        >
                            All or Nothing
                        </button>
                    </div>
                    <p className="mt-2 text-xs text-dim">
                        {form.pollMode === 'standard'
                            ? '"None of these work" only wins if it gets the most votes. Otherwise, the top time wins.'
                            : 'If ANY voter picks "None of these work", the poll re-sends with new time suggestions until everyone agrees.'}
                    </p>
                </div>
            </FormSection>

            <div className="border-t border-edge-subtle" />

            {/* Event Duration */}
            <FormSection title="Event Duration">
                <DurationSection
                    durationMinutes={form.durationMinutes}
                    customDuration={form.customDuration}
                    durationError={errors.duration}
                    onDurationMinutesChange={(v) => updateField('durationMinutes', v)}
                    onCustomDurationChange={(v) => updateField('customDuration', v)}
                />
            </FormSection>

            <div className="border-t border-edge-subtle" />

            {/* Roster */}
            <FormSection title="Roster">
                <RosterSection
                    slotType={form.slotType}
                    slotTank={form.slotTank}
                    slotHealer={form.slotHealer}
                    slotDps={form.slotDps}
                    slotFlex={form.slotFlex}
                    slotPlayer={form.slotPlayer}
                    slotBench={form.slotBench}
                    maxAttendees={form.maxAttendees}
                    autoUnbench={form.autoUnbench}
                    maxAttendeesId="planMaxAttendees"
                    onSlotTypeChange={(v) => updateField('slotType', v)}
                    onSlotTankChange={(v) => updateField('slotTank', v)}
                    onSlotHealerChange={(v) => updateField('slotHealer', v)}
                    onSlotDpsChange={(v) => updateField('slotDps', v)}
                    onSlotFlexChange={(v) => updateField('slotFlex', v)}
                    onSlotPlayerChange={(v) => updateField('slotPlayer', v)}
                    onSlotBenchChange={(v) => updateField('slotBench', v)}
                    onMaxAttendeesChange={(v) => updateField('maxAttendees', v)}
                    onAutoUnbenchChange={(v) => updateField('autoUnbench', v)}
                />
            </FormSection>

            <div className="border-t border-edge-subtle" />

            {/* Reminders */}
            <FormSection title="Reminders">
                <RemindersSection
                    reminder15min={form.reminder15min}
                    reminder1hour={form.reminder1hour}
                    reminder24hour={form.reminder24hour}
                    onReminder15minChange={(v) => updateField('reminder15min', v)}
                    onReminder1hourChange={(v) => updateField('reminder1hour', v)}
                    onReminder24hourChange={(v) => updateField('reminder24hour', v)}
                    description="Reminders for the auto-created event (after the poll closes)."
                />
            </FormSection>

            <div className="border-t border-edge-subtle" />

            {/* Footer */}
            <div className="flex items-center justify-end gap-4 pt-2">
                <button
                    type="button"
                    onClick={() => navigate('/events')}
                    className="px-6 py-3 text-secondary hover:text-foreground font-medium transition-colors"
                >
                    Cancel
                </button>
                <button
                    type="submit"
                    disabled={createPlanMutation.isPending}
                    className="px-8 py-3 bg-violet-600 hover:bg-violet-500 disabled:bg-overlay disabled:text-muted text-foreground font-semibold rounded-lg transition-colors"
                >
                    {createPlanMutation.isPending ? 'Posting Poll...' : 'Start Poll'}
                </button>
            </div>
        </form>
    );
}
