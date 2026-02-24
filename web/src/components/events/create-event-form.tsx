import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '../../lib/toast';
import type { IgdbGameDto, CreateEventDto, UpdateEventDto, SlotConfigDto, RecurrenceDto, TemplateConfigDto, EventResponseDto } from '@raid-ledger/contract';
import { createEvent, updateEvent } from '../../lib/api-client';
import { useTimezoneStore } from '../../stores/timezone-store';
import { getTimezoneAbbr } from '../../lib/timezone-utils';
import { TZDate } from '@date-fns/tz';
import { useEventTemplates, useCreateTemplate, useDeleteTemplate } from '../../hooks/use-event-templates';
import { useWantToPlay } from '../../hooks/use-want-to-play';
import '../../pages/event-detail-page.css';
import {
    DURATION_PRESETS,
    MMO_DEFAULTS,
    GENERIC_DEFAULTS,
    type SlotState,
} from './shared/event-form-constants';
import { GameDetailsSection } from './shared/game-details-section';
import { useRegistryGameId } from './shared/use-registry-game-id';
import { DurationSection } from './shared/duration-section';
import { RosterSection } from './shared/roster-section';
import { RemindersSection } from './shared/reminders-section';

// Recurrence options
const RECURRENCE_OPTIONS = [
    { value: '', label: 'Does not repeat' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'biweekly', label: 'Every 2 weeks' },
    { value: 'monthly', label: 'Monthly' },
] as const;

/**
 * Section wrapper for visual grouping in the form.
 */
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
    startDate: string;
    startTime: string;
    durationMinutes: number;
    customDuration: boolean;
    // Roster
    slotType: 'mmo' | 'generic';
    slotTank: number;
    slotHealer: number;
    slotDps: number;
    slotFlex: number;
    slotPlayer: number;
    slotBench: number;
    // Capacity
    maxAttendees: string;
    autoUnbench: boolean;
    // Recurrence
    recurrenceFrequency: '' | 'weekly' | 'biweekly' | 'monthly';
    recurrenceUntil: string;
    // Reminders (ROK-126)
    reminder15min: boolean;
    reminder1hour: boolean;
    reminder24hour: boolean;
    // Content instances
    selectedInstances: Record<string, unknown>[];
    titleIsAutoSuggested: boolean;
    descriptionIsAutoSuggested: boolean;
}

interface FormErrors {
    title?: string;
    startDate?: string;
    startTime?: string;
    duration?: string;
    maxAttendees?: string;
    recurrenceUntil?: string;
}

interface EventFormProps {
    /** Edit mode: existing event to pre-populate. Omit for create mode. */
    event?: EventResponseDto;
}

/**
 * Form for creating or editing an event.
 * Game-first guided flow: Game & Content → Details → When → Roster → Server Automation.
 */
export function CreateEventForm({ event: editEvent }: EventFormProps = {}) {
    const isEditMode = !!editEvent;
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const resolved = useTimezoneStore((s) => s.resolved);
    const tzAbbr = getTimezoneAbbr(resolved);

    // Compute initial form state from edit event
    function getInitialState(): FormState {
        if (editEvent) {
            const start = new Date(editEvent.startTime);
            const end = new Date(editEvent.endTime);
            const durationMs = end.getTime() - start.getTime();
            const durationMinutes = Math.round(durationMs / 60000);
            const isPreset = DURATION_PRESETS.some((p) => p.minutes === durationMinutes);
            const startLocal = new Intl.DateTimeFormat('en-CA', { timeZone: resolved, year: 'numeric', month: '2-digit', day: '2-digit' }).format(start);
            const timeLocal = new Intl.DateTimeFormat('en-GB', { timeZone: resolved, hour: '2-digit', minute: '2-digit', hour12: false }).format(start);
            const sc = editEvent.slotConfig;
            return {
                title: editEvent.title,
                description: editEvent.description ?? '',
                game: editEvent.game ? { id: editEvent.game.id, name: editEvent.game.name, slug: editEvent.game.slug, coverUrl: editEvent.game.coverUrl } as IgdbGameDto : null,
                eventTypeId: null,
                startDate: startLocal,
                startTime: timeLocal,
                durationMinutes,
                customDuration: !isPreset,
                slotType: sc?.type ?? 'generic',
                slotTank: sc?.tank ?? MMO_DEFAULTS.tank!,
                slotHealer: sc?.healer ?? MMO_DEFAULTS.healer!,
                slotDps: sc?.dps ?? MMO_DEFAULTS.dps!,
                slotFlex: sc?.flex ?? MMO_DEFAULTS.flex!,
                slotPlayer: sc?.player ?? GENERIC_DEFAULTS.player!,
                slotBench: sc?.bench ?? GENERIC_DEFAULTS.bench!,
                maxAttendees: editEvent.maxAttendees ? String(editEvent.maxAttendees) : '',
                autoUnbench: editEvent.autoUnbench ?? true,
                recurrenceFrequency: '',
                recurrenceUntil: '',
                reminder15min: editEvent.reminder15min ?? true,
                reminder1hour: editEvent.reminder1hour ?? false,
                reminder24hour: editEvent.reminder24hour ?? false,
                selectedInstances: (editEvent.contentInstances as Record<string, unknown>[]) ?? [],
                titleIsAutoSuggested: false,
                descriptionIsAutoSuggested: false,
            };
        }
        return {
            title: '',
            description: '',
            game: null,
            eventTypeId: null,
            startDate: '',
            startTime: '',
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
            recurrenceFrequency: '',
            recurrenceUntil: '',
            reminder15min: true,
            reminder1hour: false,
            reminder24hour: false,
            selectedInstances: [],
            titleIsAutoSuggested: false,
            descriptionIsAutoSuggested: false,
        };
    }

    const [form, setForm] = useState<FormState>(getInitialState);
    const [errors, setErrors] = useState<FormErrors>({});
    const [saveTemplateName, setSaveTemplateName] = useState('');
    const [showSaveTemplate, setShowSaveTemplate] = useState(false);

    // Templates
    const { data: templatesData } = useEventTemplates();
    const createTemplateMutation = useCreateTemplate();
    const deleteTemplateMutation = useDeleteTemplate();
    const templates = templatesData?.data ?? [];

    // Registry game ID for submission
    const registryGameId = useRegistryGameId(form.game);

    // Interest stats
    const igdbId = form.game?.igdbId ?? undefined;
    const { count: interestCount, isLoading: interestLoading } = useWantToPlay(igdbId);

    // Load template into form
    function loadTemplate(config: TemplateConfigDto) {
        setForm((prev) => ({
            ...prev,
            title: config.title ?? prev.title,
            description: config.description ?? prev.description,
            durationMinutes: config.durationMinutes ?? prev.durationMinutes,
            slotType: config.slotConfig?.type ?? prev.slotType,
            slotTank: config.slotConfig?.tank ?? prev.slotTank,
            slotHealer: config.slotConfig?.healer ?? prev.slotHealer,
            slotDps: config.slotConfig?.dps ?? prev.slotDps,
            slotFlex: config.slotConfig?.flex ?? prev.slotFlex,
            slotPlayer: config.slotConfig?.player ?? prev.slotPlayer,
            slotBench: config.slotConfig?.bench ?? prev.slotBench,
            maxAttendees: config.maxAttendees ? String(config.maxAttendees) : prev.maxAttendees,
            autoUnbench: config.autoUnbench ?? prev.autoUnbench,
            recurrenceFrequency: config.recurrence?.frequency ?? prev.recurrenceFrequency,
            titleIsAutoSuggested: false,
            descriptionIsAutoSuggested: false,
        }));
        toast.success('Template loaded');
    }

    // Save current form as template
    function saveTemplate() {
        if (!saveTemplateName.trim()) return;
        const config: TemplateConfigDto = {
            title: form.title || undefined,
            description: form.description || undefined,
            durationMinutes: form.durationMinutes,
            slotConfig: buildSlotConfig(),
            maxAttendees: form.maxAttendees ? parseInt(form.maxAttendees) : undefined,
            autoUnbench: form.autoUnbench,
        };
        createTemplateMutation.mutate(
            { name: saveTemplateName.trim(), config },
            { onSuccess: () => { setShowSaveTemplate(false); setSaveTemplateName(''); } },
        );
    }

    // Create/Update mutation
    const mutation = useMutation({
        mutationFn: (dto: CreateEventDto) =>
            isEditMode ? updateEvent(editEvent!.id, dto as UpdateEventDto) : createEvent(dto),
        onSuccess: (event) => {
            toast.success(isEditMode ? 'Event updated!' : 'Event created successfully!');
            queryClient.invalidateQueries({ queryKey: ['events'] });
            if (isEditMode) queryClient.invalidateQueries({ queryKey: ['event', editEvent!.id] });
            navigate(`/events/${event.id}`);
        },
        onError: (error: Error) => {
            toast.error(error.message || `Failed to ${isEditMode ? 'update' : 'create'} event`);
        },
    });

    // Compute end time preview from start + duration
    const endTimePreview = useMemo(() => {
        if (!form.startDate || !form.startTime || form.durationMinutes <= 0) return null;
        const start = new TZDate(`${form.startDate}T${form.startTime}`, resolved);
        const end = new Date(start.getTime() + form.durationMinutes * 60 * 1000);
        const endTz = new TZDate(end, resolved);
        return endTz.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
            timeZone: resolved,
        });
    }, [form.startDate, form.startTime, form.durationMinutes, resolved]);

    // Compute recurrence count preview (capped at 52 to match backend)
    // This mirrors the backend's generateRecurringDates() logic in recurrence.util.ts,
    // including UTC month-addition with day clamping and original-day restoration.
    const MAX_RECURRENCE_INSTANCES = 52;
    const recurrenceCount = useMemo(() => {
        if (!form.recurrenceFrequency || !form.startDate || !form.recurrenceUntil) return 0;
        const start = new Date(form.startDate);
        const until = new Date(form.recurrenceUntil);
        if (until <= start) return 0;
        const originalDay = start.getUTCDate();
        let count = 1;
        let current = new Date(start);
        while (count < MAX_RECURRENCE_INSTANCES) {
            const next = new Date(current);
            if (form.recurrenceFrequency === 'weekly') {
                next.setUTCDate(next.getUTCDate() + 7);
            } else if (form.recurrenceFrequency === 'biweekly') {
                next.setUTCDate(next.getUTCDate() + 14);
            } else {
                // Monthly: advance by one calendar month with day clamping
                next.setUTCMonth(next.getUTCMonth() + 1);

                // Clamp: if the day overflowed (e.g. 31 -> Mar 3), roll back to
                // the last day of the intended month.
                const intendedMonth = (current.getUTCMonth() + 1) % 12;
                if (next.getUTCMonth() !== intendedMonth) {
                    next.setUTCDate(0);
                }

                // Restore the original day if the target month can hold it,
                // to prevent drift from clamped months (e.g. Jan 31 -> Feb 28 -> Mar 31).
                if (next.getUTCDate() !== originalDay) {
                    const testDate = new Date(next);
                    testDate.setUTCDate(originalDay);
                    if (testDate.getUTCMonth() === next.getUTCMonth()) {
                        next.setUTCDate(originalDay);
                    }
                }
            }
            if (next > until) break;
            count++;
            current = next;
        }
        return count;
    }, [form.recurrenceFrequency, form.startDate, form.recurrenceUntil]);

    // Build slot config for submission
    function buildSlotConfig(): SlotConfigDto {
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

    // Validation
    function validate(): FormErrors {
        const newErrors: FormErrors = {};
        if (!form.title.trim()) {
            newErrors.title = 'Title is required';
        } else if (form.title.length > 200) {
            newErrors.title = 'Title must be 200 characters or less';
        }
        if (!form.startDate) {
            newErrors.startDate = 'Start date is required';
        }
        if (!form.startTime) {
            newErrors.startTime = 'Start time is required';
        }
        if (form.durationMinutes <= 0) {
            newErrors.duration = 'Duration must be greater than 0';
        } else if (form.durationMinutes > 1440) {
            newErrors.duration = 'Duration cannot exceed 24 hours';
        }
        if (form.maxAttendees !== '') {
            const max = parseInt(form.maxAttendees);
            if (isNaN(max) || max < 1) {
                newErrors.maxAttendees = 'Must be a positive number';
            }
        }
        if (form.recurrenceFrequency && !form.recurrenceUntil) {
            newErrors.recurrenceUntil = 'End date is required for recurring events';
        } else if (form.recurrenceFrequency && form.recurrenceUntil && form.startDate) {
            if (new Date(form.recurrenceUntil) <= new Date(form.startDate)) {
                newErrors.recurrenceUntil = 'End date must be after start date';
            }
        }
        setErrors(newErrors);
        return newErrors;
    }

    const errorFieldMap: Record<string, string> = {
        title: 'title',
        startDate: 'startDate',
        startTime: 'startTime',
        maxAttendees: 'maxAttendees',
        recurrenceUntil: 'recurrenceUntil',
    };

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        const validationErrors = validate();
        const errorKeys = Object.keys(validationErrors);
        if (errorKeys.length > 0) {
            const fieldId = errorFieldMap[errorKeys[0]];
            if (fieldId) {
                document.getElementById(fieldId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            return;
        }

        const start = new TZDate(`${form.startDate}T${form.startTime}`, resolved);
        const end = new Date(start.getTime() + form.durationMinutes * 60 * 1000);

        let recurrence: RecurrenceDto | undefined;
        if (form.recurrenceFrequency) {
            const untilDate = new TZDate(`${form.recurrenceUntil}T23:59:59`, resolved);
            recurrence = {
                frequency: form.recurrenceFrequency,
                until: untilDate.toISOString(),
            };
        }

        const dto: CreateEventDto = {
            title: form.title.trim(),
            description: form.description.trim() || undefined,
            gameId: registryGameId ?? undefined,
            startTime: start.toISOString(),
            endTime: end.toISOString(),
            slotConfig: buildSlotConfig(),
            maxAttendees: form.maxAttendees ? parseInt(form.maxAttendees) : undefined,
            autoUnbench: form.autoUnbench,
            recurrence,
            contentInstances: form.selectedInstances.length > 0 ? form.selectedInstances : undefined,
            reminder15min: form.reminder15min,
            reminder1hour: form.reminder1hour,
            reminder24hour: form.reminder24hour,
        };

        mutation.mutate(dto);
    }

    function updateField<K extends keyof FormState>(field: K, value: FormState[K]) {
        setForm((prev) => ({ ...prev, [field]: value }));
        if (field in errors) {
            setErrors((prev) => ({ ...prev, [field]: undefined }));
        }
    }

    function formatDuration(minutes: number): string {
        const h = Math.floor(minutes / 60);
        const m = minutes % 60;
        if (h === 0) return `${m}m`;
        if (m === 0) return `${h}h`;
        return `${h}h ${m}m`;
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-8">
            {/* Templates Bar */}
            {templates.length > 0 && (
                <div className="flex items-center gap-3 -mb-2">
                    <span className="text-xs text-muted shrink-0">Load template:</span>
                    <div className="flex flex-wrap gap-2">
                        {templates.map((t) => (
                            <div key={t.id} className="flex items-center gap-1">
                                <button
                                    type="button"
                                    onClick={() => loadTemplate(t.config)}
                                    className="px-3 py-1 rounded-md bg-panel border border-edge text-xs text-secondary hover:text-foreground hover:border-emerald-500 transition-colors"
                                >
                                    {t.name}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => deleteTemplateMutation.mutate(t.id)}
                                    className="p-0.5 text-dim hover:text-red-400 transition-colors"
                                    title="Delete template"
                                >
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Section 1: Game & Content + Section 2: Details */}
            <FormSection title="Game & Content">
                <GameDetailsSection
                    game={form.game}
                    eventTypeId={form.eventTypeId}
                    title={form.title}
                    description={form.description}
                    selectedInstances={form.selectedInstances}
                    titleIsAutoSuggested={form.titleIsAutoSuggested}
                    descriptionIsAutoSuggested={form.descriptionIsAutoSuggested}
                    titleError={errors.title}
                    titleInputId="title"
                    eventTypeSelectId="eventType"
                    showEventType={!isEditMode}
                    onGameChange={(game) => setForm((prev) => ({ ...prev, game, titleIsAutoSuggested: prev.titleIsAutoSuggested }))}
                    onEventTypeIdChange={(id) => setForm((prev) => ({ ...prev, eventTypeId: id }))}
                    onTitleChange={(title, isAuto) => {
                        setForm((prev) => ({ ...prev, title, titleIsAutoSuggested: isAuto }));
                        if (!isAuto && errors.title) setErrors((prev) => ({ ...prev, title: undefined }));
                    }}
                    onDescriptionChange={(description, isAuto) => setForm((prev) => ({ ...prev, description, descriptionIsAutoSuggested: isAuto }))}
                    onSelectedInstancesChange={(instances) => setForm((prev) => ({ ...prev, selectedInstances: instances }))}
                    onEventTypeDefaults={(defaults: Partial<SlotState>) => setForm((prev) => ({ ...prev, ...defaults }))}
                    interestCount={interestCount}
                    interestLoading={interestLoading}
                    slotBetween={
                        <>
                            <div className="border-t border-edge-subtle -mx-0" />
                            <h3 className="text-sm font-semibold text-muted uppercase tracking-wider">Details</h3>
                        </>
                    }
                />
            </FormSection>

            <div className="border-t border-edge-subtle" />

            {/* Section 2: When */}
            <FormSection title="When">
                <p className="text-xs text-muted -mt-2">Times in {tzAbbr}</p>

                {/* Date and Time row */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label htmlFor="startDate" className="block text-sm font-medium text-secondary mb-2">
                            Date <span className="text-red-400">*</span>
                        </label>
                        <input
                            id="startDate"
                            type="date"
                            value={form.startDate}
                            onChange={(e) => updateField('startDate', e.target.value)}
                            className={`w-full px-4 py-3 bg-panel border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors ${errors.startDate ? 'border-red-500' : 'border-edge'}`}
                        />
                        {errors.startDate && (
                            <p className="mt-1 text-sm text-red-400">{errors.startDate}</p>
                        )}
                    </div>
                    <div>
                        <label htmlFor="startTime" className="block text-sm font-medium text-secondary mb-2">
                            Start Time <span className="text-red-400">*</span>
                        </label>
                        <input
                            id="startTime"
                            type="time"
                            value={form.startTime}
                            onChange={(e) => updateField('startTime', e.target.value)}
                            className={`w-full px-4 py-3 bg-panel border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors ${errors.startTime ? 'border-red-500' : 'border-edge'}`}
                        />
                        {errors.startTime && (
                            <p className="mt-1 text-sm text-red-400">{errors.startTime}</p>
                        )}
                    </div>
                </div>

                {/* Duration Picker */}
                <DurationSection
                    durationMinutes={form.durationMinutes}
                    customDuration={form.customDuration}
                    durationError={errors.duration}
                    onDurationMinutesChange={(v) => updateField('durationMinutes', v)}
                    onCustomDurationChange={(v) => updateField('customDuration', v)}
                    onDurationErrorClear={() => setErrors((prev) => ({ ...prev, duration: undefined }))}
                />

                {/* End time preview */}
                {endTimePreview && (
                    <div className="flex items-center gap-2 text-sm text-muted bg-panel/50 border border-edge-subtle rounded-lg px-4 py-2.5">
                        <svg className="w-4 h-4 text-emerald-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span>
                            Ends at <span className="text-emerald-400 font-medium">{endTimePreview} {tzAbbr}</span>
                            {' '}({formatDuration(form.durationMinutes)})
                        </span>
                    </div>
                )}

                {/* Recurrence (create mode only) */}
                {!isEditMode && (
                    <>
                        <div>
                            <label htmlFor="recurrence" className="block text-sm font-medium text-secondary mb-2">
                                Repeat
                            </label>
                            <select
                                id="recurrence"
                                value={form.recurrenceFrequency}
                                onChange={(e) => updateField('recurrenceFrequency', e.target.value as FormState['recurrenceFrequency'])}
                                className="w-full px-4 py-3 bg-panel border border-edge rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors"
                            >
                                {RECURRENCE_OPTIONS.map((opt) => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                            </select>
                        </div>

                        {form.recurrenceFrequency && (
                            <div>
                                <label htmlFor="recurrenceUntil" className="block text-sm font-medium text-secondary mb-2">
                                    Repeat Until <span className="text-red-400">*</span>
                                </label>
                                <input
                                    id="recurrenceUntil"
                                    type="date"
                                    value={form.recurrenceUntil}
                                    min={form.startDate || undefined}
                                    onChange={(e) => {
                                        updateField('recurrenceUntil', e.target.value);
                                        setErrors((prev) => ({ ...prev, recurrenceUntil: undefined }));
                                    }}
                                    className={`w-full px-4 py-3 bg-panel border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors ${errors.recurrenceUntil ? 'border-red-500' : 'border-edge'}`}
                                />
                                {errors.recurrenceUntil && (
                                    <p className="mt-1 text-sm text-red-400">{errors.recurrenceUntil}</p>
                                )}
                                {recurrenceCount > 0 && (
                                    <p className="mt-1 text-sm text-muted">
                                        Creates <span className="text-emerald-400 font-medium">{recurrenceCount}</span> event{recurrenceCount !== 1 ? 's' : ''}
                                    </p>
                                )}
                            </div>
                        )}
                    </>
                )}
            </FormSection>

            <div className="border-t border-edge-subtle" />

            {/* Section 3: Roster */}
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
                    maxAttendeesError={errors.maxAttendees}
                    maxAttendeesId="maxAttendees"
                    onSlotTypeChange={(v) => updateField('slotType', v)}
                    onSlotTankChange={(v) => updateField('slotTank', v)}
                    onSlotHealerChange={(v) => updateField('slotHealer', v)}
                    onSlotDpsChange={(v) => updateField('slotDps', v)}
                    onSlotFlexChange={(v) => updateField('slotFlex', v)}
                    onSlotPlayerChange={(v) => updateField('slotPlayer', v)}
                    onSlotBenchChange={(v) => updateField('slotBench', v)}
                    onMaxAttendeesChange={(v) => {
                        updateField('maxAttendees', v);
                        setErrors((prev) => ({ ...prev, maxAttendees: undefined }));
                    }}
                    onAutoUnbenchChange={(v) => updateField('autoUnbench', v)}
                />
            </FormSection>

            <div className="border-t border-edge-subtle" />

            {/* Section 4: Reminders */}
            <FormSection title="Reminders">
                <RemindersSection
                    reminder15min={form.reminder15min}
                    reminder1hour={form.reminder1hour}
                    reminder24hour={form.reminder24hour}
                    onReminder15minChange={(v) => updateField('reminder15min', v)}
                    onReminder1hourChange={(v) => updateField('reminder1hour', v)}
                    onReminder24hourChange={(v) => updateField('reminder24hour', v)}
                />
            </FormSection>

            <div className="border-t border-edge-subtle" />

            {/* Save as Template */}
            {showSaveTemplate && (
                <div className="flex items-center gap-3 bg-panel/50 border border-edge-subtle rounded-lg px-4 py-3">
                    <input
                        type="text"
                        value={saveTemplateName}
                        onChange={(e) => setSaveTemplateName(e.target.value)}
                        placeholder="Template name..."
                        maxLength={100}
                        className="flex-1 px-3 py-2 bg-panel border border-edge rounded-md text-sm text-foreground placeholder-dim focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    <button
                        type="button"
                        onClick={saveTemplate}
                        disabled={!saveTemplateName.trim() || createTemplateMutation.isPending}
                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-overlay disabled:text-muted text-white text-sm font-medium rounded-md transition-colors"
                    >
                        {createTemplateMutation.isPending ? 'Saving...' : 'Save'}
                    </button>
                    <button
                        type="button"
                        onClick={() => { setShowSaveTemplate(false); setSaveTemplateName(''); }}
                        className="p-2 text-muted hover:text-foreground transition-colors"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
            )}

            {/* Footer */}
            <div className="flex items-center justify-between pt-2">
                <button
                    type="button"
                    onClick={() => setShowSaveTemplate(true)}
                    className="text-sm text-muted hover:text-secondary transition-colors"
                >
                    Save as Template
                </button>
                <div className="flex items-center gap-4">
                    <button
                        type="button"
                        onClick={() => navigate('/events')}
                        className="px-6 py-3 text-secondary hover:text-foreground font-medium transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        disabled={mutation.isPending}
                        className="px-8 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-overlay disabled:text-muted text-foreground font-semibold rounded-lg transition-colors"
                    >
                        {mutation.isPending
                            ? (isEditMode ? 'Saving...' : 'Creating...')
                            : (isEditMode ? 'Save Changes' : 'Create Event')}
                    </button>
                </div>
            </div>
        </form>
    );
}
