import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { IgdbGameDto, SlotConfigDto, CreateEventPlanDto, PollOption } from '@raid-ledger/contract';
import { useTimeSuggestions, useCreateEventPlan } from '../../hooks/use-event-plans';
import { GameSearchInput } from './game-search-input';
import { useGameRegistry, useEventTypes } from '../../hooks/use-game-registry';
import { PluginSlot } from '../../plugins';
import { getWowVariant, getContentType } from '../../plugins/wow/utils';
import '../../pages/event-detail-page.css';

// Duration presets in minutes (shared with create-event-form)
const DURATION_PRESETS = [
    { label: '1h', minutes: 60 },
    { label: '1.5h', minutes: 90 },
    { label: '2h', minutes: 120 },
    { label: '3h', minutes: 180 },
    { label: '4h', minutes: 240 },
] as const;

const POLL_DURATION_PRESETS = [
    { label: '6h', hours: 6 },
    { label: '12h', hours: 12 },
    { label: '24h', hours: 24 },
    { label: '48h', hours: 48 },
    { label: '72h', hours: 72 },
] as const;

const MMO_DEFAULTS: SlotConfigDto = { type: 'mmo', tank: 2, healer: 4, dps: 14, flex: 5, bench: 0 };
const GENERIC_DEFAULTS: SlotConfigDto = { type: 'generic', player: 10, bench: 5 };

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="space-y-4">
            <h3 className="text-sm font-semibold text-muted uppercase tracking-wider">{title}</h3>
            <div className="space-y-4">{children}</div>
        </div>
    );
}

function SlotStepper({ label, value, onChange, color, min = 0, max = 99 }: {
    label: string;
    value: number;
    onChange: (v: number) => void;
    color: string;
    min?: number;
    max?: number;
}) {
    return (
        <div className="flex items-center justify-between gap-3 py-2 min-h-[44px] sm:min-h-0">
            <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${color}`} />
                <span className="text-sm text-secondary font-medium">{label}</span>
            </div>
            <div className="flex items-center gap-1">
                <button
                    type="button"
                    onClick={() => onChange(Math.max(min, value - 1))}
                    disabled={value <= min}
                    className="w-11 h-11 sm:w-8 sm:h-8 rounded-md bg-panel border border-edge text-secondary hover:text-foreground hover:border-edge-subtle disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center text-lg font-medium"
                >-</button>
                <input
                    type="number"
                    min={min}
                    max={max}
                    value={value}
                    onChange={(e) => {
                        const v = parseInt(e.target.value);
                        if (!isNaN(v)) onChange(Math.max(min, Math.min(max, v)));
                    }}
                    className="w-14 h-11 sm:w-12 sm:h-8 bg-panel border border-edge rounded-md text-foreground text-center text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <button
                    type="button"
                    onClick={() => onChange(Math.min(max, value + 1))}
                    disabled={value >= max}
                    className="w-11 h-11 sm:w-8 sm:h-8 rounded-md bg-panel border border-edge text-secondary hover:text-foreground hover:border-edge-subtle disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center text-lg font-medium"
                >+</button>
            </div>
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
    const { games: registryGames } = useGameRegistry();

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

    // Resolve registry game for time suggestions and event types
    const registryGame = useMemo(() => {
        if (!form.game?.name && !form.game?.slug) return undefined;
        return registryGames.find(
            (g) => (form.game?.name && g.name.toLowerCase() === form.game.name.toLowerCase()) || g.slug === form.game?.slug,
        );
    }, [form.game, registryGames]);
    const registryGameId = registryGame?.id;
    const registrySlug = registryGame?.slug;

    // Event types for the selected game
    const { data: eventTypesData } = useEventTypes(registryGameId);
    const eventTypes = eventTypesData?.data ?? [];

    // WoW content browsing (same pattern as create-event-form)
    const wowVariant = registrySlug ? getWowVariant(registrySlug) : null;
    const selectedEventType = eventTypes.find((t) => t.id === form.eventTypeId);
    const contentType = selectedEventType?.slug ? getContentType(selectedEventType.slug) : null;

    // Track previous auto-suggestions to detect manual edits
    const prevSuggestionRef = useRef('');
    const prevDescSuggestionRef = useRef('');

    // Title auto-suggestion — uses shortNames for concise titles
    const computeSuggestion = useCallback((): string => {
        const etName = selectedEventType?.name;
        const gName = form.game?.name;
        const instances = form.selectedInstances;

        if (instances.length > 0 && etName) {
            const names = instances.map((i) => (i.shortName as string) || (i.name as string) || '');
            const playerCap = selectedEventType?.defaultPlayerCap;
            const suffix = playerCap ? ` ${playerCap} man` : '';
            return `${names.join(' + ')}${suffix}`;
        }
        if (etName && gName) {
            return `${etName} \u2014 ${gName}`;
        }
        if (gName) {
            return `${gName} Event`;
        }
        return '';
    }, [selectedEventType?.name, selectedEventType?.defaultPlayerCap, form.game?.name, form.selectedInstances]);

    // Description auto-suggestion — overlapping level range across selected instances
    const computeDescriptionSuggestion = useCallback((): string => {
        const instances = form.selectedInstances;
        if (instances.length === 0) return '';
        const levels = instances
            .map((i) => ({ min: i.minimumLevel as number | undefined, max: (i.maximumLevel ?? i.minimumLevel) as number | undefined }))
            .filter((l): l is { min: number; max: number } => l.min != null);
        if (levels.length === 0) return '';
        const overlapMin = Math.max(...levels.map((l) => l.min));
        const overlapMax = Math.min(...levels.map((l) => l.max));
        if (overlapMin > overlapMax) {
            const fullMin = Math.min(...levels.map((l) => l.min));
            const fullMax = Math.max(...levels.map((l) => l.max));
            return `Level ${fullMin}-${fullMax} suggested`;
        }
        if (overlapMin === overlapMax) return `Level ${overlapMin} suggested`;
        return `Level ${overlapMin}-${overlapMax} suggested`;
    }, [form.selectedInstances]);

    // Auto-fill title and description when suggestions change
    useEffect(() => {
        const newSuggestion = computeSuggestion();
        const newDescSuggestion = computeDescriptionSuggestion();

        setForm((prev) => {
            let next = prev;

            if (newSuggestion && (prev.titleIsAutoSuggested || prev.title === '' || prev.title === prevSuggestionRef.current)) {
                next = { ...next, title: newSuggestion, titleIsAutoSuggested: true };
            }
            prevSuggestionRef.current = newSuggestion;

            if (newDescSuggestion && (prev.descriptionIsAutoSuggested || prev.description === '' || prev.description === prevDescSuggestionRef.current)) {
                next = { ...next, description: newDescSuggestion, descriptionIsAutoSuggested: true };
            }
            prevDescSuggestionRef.current = newDescSuggestion;

            return next === prev ? prev : next;
        });
    }, [computeSuggestion, computeDescriptionSuggestion]);

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

    const totalSlots = useMemo(() => {
        if (form.slotType === 'mmo') {
            return form.slotTank + form.slotHealer + form.slotDps + form.slotFlex + form.slotBench;
        }
        return form.slotPlayer + form.slotBench;
    }, [form.slotType, form.slotTank, form.slotHealer, form.slotDps, form.slotFlex, form.slotPlayer, form.slotBench]);

    const alreadySelected = new Set(form.selectedTimeSlots.map((s) => s.date));

    return (
        <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-8">
            {/* Game & Details */}
            <FormSection title="Game & Details">
                <GameSearchInput
                    value={form.game}
                    onChange={(game) => setForm((prev) => ({
                        ...prev,
                        game,
                        eventTypeId: null,
                        selectedInstances: [],
                        titleIsAutoSuggested: prev.titleIsAutoSuggested,
                    }))}
                />

                {/* Event Type Dropdown */}
                {eventTypes.length > 0 && (
                    <div>
                        <label htmlFor="planEventType" className="block text-sm font-medium text-secondary mb-2">
                            Event Type
                        </label>
                        <select
                            id="planEventType"
                            value={form.eventTypeId != null ? String(form.eventTypeId) : 'custom'}
                            onChange={(e) => {
                                if (e.target.value === 'custom') {
                                    setForm((prev) => ({ ...prev, eventTypeId: null, selectedInstances: [] }));
                                } else {
                                    const id = parseInt(e.target.value, 10);
                                    setForm((prev) => ({ ...prev, eventTypeId: id, selectedInstances: [] }));
                                }
                            }}
                            className="w-full px-4 py-3 bg-panel border border-edge rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors"
                        >
                            <option value="custom">Custom</option>
                            {eventTypes.map((et) => (
                                <option key={et.id} value={et.id}>
                                    {et.name}
                                    {et.defaultPlayerCap ? ` (${et.defaultPlayerCap}-player)` : ''}
                                </option>
                            ))}
                        </select>
                        <p className="mt-1 text-xs text-dim">
                            Select event type for content browsing
                        </p>
                    </div>
                )}

                {/* Content Selection — plugin-provided (same as create-event-form) */}
                {wowVariant && contentType && (
                    <PluginSlot
                        name="event-create:content-browser"
                        context={{
                            wowVariant,
                            contentType,
                            selectedInstances: form.selectedInstances,
                            onInstancesChange: (instances: Record<string, unknown>[]) => setForm(prev => ({...prev, selectedInstances: instances})),
                        }}
                    />
                )}

                <div>
                    <label htmlFor="planTitle" className="block text-sm font-medium text-secondary mb-2">
                        Event Title <span className="text-red-400">*</span>
                    </label>
                    <input
                        id="planTitle"
                        type="text"
                        value={form.title}
                        onChange={(e) => {
                            const val = e.target.value;
                            setForm((prev) => ({
                                ...prev,
                                title: val,
                                titleIsAutoSuggested: false,
                            }));
                            if (errors.title) setErrors((prev) => ({ ...prev, title: '' }));
                        }}
                        placeholder={computeSuggestion() || 'Weekly Raid Night'}
                        maxLength={200}
                        className={`w-full px-4 py-3 bg-panel border rounded-lg text-foreground placeholder-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors ${errors.title ? 'border-red-500' : 'border-edge'}`}
                    />
                    {form.titleIsAutoSuggested && (
                        <p className="mt-1 text-xs text-dim">Auto-suggested from your selections</p>
                    )}
                    {errors.title && <p className="mt-1 text-sm text-red-400">{errors.title}</p>}
                </div>

                <div>
                    <label htmlFor="planDescription" className="block text-sm font-medium text-secondary mb-2">
                        Description
                    </label>
                    <textarea
                        id="planDescription"
                        value={form.description}
                        onChange={(e) => {
                            setForm((prev) => ({ ...prev, description: e.target.value, descriptionIsAutoSuggested: false }));
                        }}
                        placeholder={computeDescriptionSuggestion() || 'Details about this event...'}
                        maxLength={2000}
                        rows={2}
                        className="w-full px-4 py-3 bg-panel border border-edge rounded-lg text-foreground placeholder-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors resize-none"
                    />
                    {form.descriptionIsAutoSuggested && (
                        <p className="mt-1 text-xs text-dim">Auto-suggested from your selections</p>
                    )}
                </div>
            </FormSection>

            <div className="border-t border-edge-subtle" />

            {/* Time Suggestions */}
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
                <div>
                    <label className="block text-sm font-medium text-secondary mb-2">
                        Duration <span className="text-red-400">*</span>
                    </label>
                    <div className="flex flex-wrap gap-2">
                        {DURATION_PRESETS.map((preset) => (
                            <button
                                key={preset.minutes}
                                type="button"
                                onClick={() => {
                                    updateField('durationMinutes', preset.minutes);
                                    updateField('customDuration', false);
                                }}
                                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                                    !form.customDuration && form.durationMinutes === preset.minutes
                                        ? 'bg-emerald-600 text-white'
                                        : 'bg-panel border border-edge text-secondary hover:text-foreground hover:border-edge-subtle'
                                }`}
                            >
                                {preset.label}
                            </button>
                        ))}
                        <button
                            type="button"
                            onClick={() => updateField('customDuration', true)}
                            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                                form.customDuration
                                    ? 'bg-emerald-600 text-white'
                                    : 'bg-panel border border-edge text-secondary hover:text-foreground hover:border-edge-subtle'
                            }`}
                        >
                            Custom
                        </button>
                    </div>
                    {form.customDuration && (
                        <div className="flex gap-3 items-center mt-3">
                            <input
                                type="number"
                                min={0}
                                max={24}
                                value={Math.floor(form.durationMinutes / 60)}
                                onChange={(e) => {
                                    const h = Math.max(0, Math.min(24, parseInt(e.target.value) || 0));
                                    const m = form.durationMinutes % 60;
                                    updateField('durationMinutes', h * 60 + m);
                                }}
                                className="w-16 px-3 py-2 bg-panel border border-edge rounded-lg text-foreground text-center focus:outline-none focus:ring-2 focus:ring-emerald-500"
                            />
                            <span className="text-sm text-muted">hr</span>
                            <input
                                type="number"
                                min={0}
                                max={59}
                                step={5}
                                value={form.durationMinutes % 60}
                                onChange={(e) => {
                                    const h = Math.floor(form.durationMinutes / 60);
                                    const m = Math.max(0, Math.min(59, parseInt(e.target.value) || 0));
                                    updateField('durationMinutes', h * 60 + m);
                                }}
                                className="w-16 px-3 py-2 bg-panel border border-edge rounded-lg text-foreground text-center focus:outline-none focus:ring-2 focus:ring-emerald-500"
                            />
                            <span className="text-sm text-muted">min</span>
                        </div>
                    )}
                    {errors.duration && <p className="mt-1 text-sm text-red-400">{errors.duration}</p>}
                </div>
            </FormSection>

            <div className="border-t border-edge-subtle" />

            {/* Roster */}
            <FormSection title="Roster">
                <div>
                    <label className="block text-sm font-medium text-secondary mb-2">Slot Type</label>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => updateField('slotType', 'mmo')}
                            className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                                form.slotType === 'mmo'
                                    ? 'bg-emerald-600 text-white'
                                    : 'bg-panel border border-edge text-secondary hover:text-foreground'
                            }`}
                        >
                            MMO Roles
                        </button>
                        <button
                            type="button"
                            onClick={() => updateField('slotType', 'generic')}
                            className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                                form.slotType === 'generic'
                                    ? 'bg-emerald-600 text-white'
                                    : 'bg-panel border border-edge text-secondary hover:text-foreground'
                            }`}
                        >
                            Generic Slots
                        </button>
                    </div>
                </div>

                <div className="bg-panel/50 border border-edge-subtle rounded-lg px-4 divide-y divide-edge-subtle">
                    {form.slotType === 'mmo' ? (
                        <>
                            <SlotStepper label="Tank" value={form.slotTank} onChange={(v) => updateField('slotTank', v)} color="bg-blue-500" />
                            <SlotStepper label="Healer" value={form.slotHealer} onChange={(v) => updateField('slotHealer', v)} color="bg-green-500" />
                            <SlotStepper label="DPS" value={form.slotDps} onChange={(v) => updateField('slotDps', v)} color="bg-red-500" />
                            <SlotStepper label="Flex" value={form.slotFlex} onChange={(v) => updateField('slotFlex', v)} color="bg-purple-500" />
                        </>
                    ) : (
                        <SlotStepper label="Players" value={form.slotPlayer} onChange={(v) => updateField('slotPlayer', v)} color="bg-indigo-500" />
                    )}
                    <SlotStepper label="Bench" value={form.slotBench} onChange={(v) => updateField('slotBench', v)} color="bg-gray-500" />
                </div>

                <div className="text-sm text-muted">
                    Total slots: <span className="text-emerald-400 font-medium">{totalSlots}</span>
                    {form.slotBench > 0 && (
                        <span className="text-dim"> (incl. {form.slotBench} bench)</span>
                    )}
                </div>

                <div>
                    <label htmlFor="planMaxAttendees" className="block text-sm font-medium text-secondary mb-2">
                        Max Attendees
                    </label>
                    <input
                        id="planMaxAttendees"
                        type="number"
                        min={1}
                        value={form.maxAttendees}
                        onChange={(e) => updateField('maxAttendees', e.target.value)}
                        placeholder="Unlimited"
                        className="w-full px-4 py-3 bg-panel border border-edge rounded-lg text-foreground placeholder-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors"
                    />
                    <p className="mt-1 text-xs text-dim">Leave empty for unlimited</p>
                </div>

                <div className="flex items-center justify-between gap-3">
                    <div>
                        <span className="text-sm font-medium text-secondary">Auto-promote benched players</span>
                        <p className="text-xs text-dim mt-0.5">
                            When a roster slot opens, automatically move the next benched player in
                        </p>
                    </div>
                    <div className="event-detail-autosub-toggle shrink-0">
                        <div
                            className="event-detail-autosub-toggle__track"
                            role="switch"
                            aria-checked={form.autoUnbench}
                            aria-label="Auto-promote benched players"
                            tabIndex={0}
                            onClick={() => updateField('autoUnbench', !form.autoUnbench)}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); updateField('autoUnbench', !form.autoUnbench); } }}
                        >
                            <span className={`event-detail-autosub-toggle__option ${form.autoUnbench ? 'event-detail-autosub-toggle__option--active' : ''}`}>On</span>
                            <span className={`event-detail-autosub-toggle__option ${!form.autoUnbench ? 'event-detail-autosub-toggle__option--active' : ''}`}>Off</span>
                        </div>
                    </div>
                </div>
            </FormSection>

            <div className="border-t border-edge-subtle" />

            {/* Reminders */}
            <FormSection title="Reminders">
                <p className="text-xs text-dim -mt-2">
                    Reminders for the auto-created event (after the poll closes).
                </p>
                <div className="bg-panel/50 border border-edge-subtle rounded-lg px-4 divide-y divide-edge-subtle">
                    {[
                        { key: 'reminder15min' as const, label: '15 minutes before', sub: 'Starting soon!' },
                        { key: 'reminder1hour' as const, label: '1 hour before', sub: 'Coming up in 1 hour' },
                        { key: 'reminder24hour' as const, label: '24 hours before', sub: "Tomorrow's event" },
                    ].map(({ key, label, sub }) => (
                        <div key={key} className="flex items-center justify-between gap-3 py-3 min-h-[44px] sm:min-h-0">
                            <div>
                                <span className="text-sm text-secondary font-medium">{label}</span>
                                <p className="text-xs text-dim mt-0.5">{sub}</p>
                            </div>
                            <div className="event-detail-autosub-toggle shrink-0">
                                <div
                                    className="event-detail-autosub-toggle__track"
                                    role="switch"
                                    aria-checked={form[key]}
                                    aria-label={`${label} reminder`}
                                    tabIndex={0}
                                    onClick={() => updateField(key, !form[key])}
                                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); updateField(key, !form[key]); } }}
                                >
                                    <span className={`event-detail-autosub-toggle__option ${form[key] ? 'event-detail-autosub-toggle__option--active' : ''}`}>On</span>
                                    <span className={`event-detail-autosub-toggle__option ${!form[key] ? 'event-detail-autosub-toggle__option--active' : ''}`}>Off</span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
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
