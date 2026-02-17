import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '../../lib/toast';
import type { IgdbGameDto, CreateEventDto, UpdateEventDto, SlotConfigDto, RecurrenceDto, TemplateConfigDto, EventResponseDto } from '@raid-ledger/contract';
import { createEvent, updateEvent } from '../../lib/api-client';
import { GameSearchInput } from './game-search-input';
import { TeamAvailabilityPicker } from '../features/heatmap';
import { useTimezoneStore } from '../../stores/timezone-store';
import { getTimezoneAbbr } from '../../lib/timezone-utils';
import { TZDate } from '@date-fns/tz';
import { useEventTemplates, useCreateTemplate, useDeleteTemplate } from '../../hooks/use-event-templates';
import { useGameRegistry, useEventTypes } from '../../hooks/use-game-registry';
import { useWantToPlay } from '../../hooks/use-want-to-play';
import { PluginSlot } from '../../plugins';
import { getWowVariant, getContentType } from '../../plugins/wow/utils';
import '../../pages/event-detail-page.css';

// Duration presets in minutes
const DURATION_PRESETS = [
    { label: '1h', minutes: 60 },
    { label: '1.5h', minutes: 90 },
    { label: '2h', minutes: 120 },
    { label: '3h', minutes: 180 },
    { label: '4h', minutes: 240 },
] as const;

// Default slot counts for each mode
const MMO_DEFAULTS: SlotConfigDto = { type: 'mmo', tank: 2, healer: 4, dps: 14, flex: 5, bench: 0 };
const GENERIC_DEFAULTS: SlotConfigDto = { type: 'generic', player: 10, bench: 5 };

// Recurrence options
const RECURRENCE_OPTIONS = [
    { value: '', label: 'Does not repeat' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'biweekly', label: 'Every 2 weeks' },
    { value: 'monthly', label: 'Monthly' },
] as const;

/**
 * Map a player cap to MMO composition slot counts.
 * Known breakpoints use hand-tuned values; unknown caps use proportional scaling.
 */
function getCompositionForCap(cap: number): Pick<FormState, 'slotTank' | 'slotHealer' | 'slotDps' | 'slotFlex' | 'slotBench'> {
    const known: Record<number, Pick<FormState, 'slotTank' | 'slotHealer' | 'slotDps' | 'slotFlex' | 'slotBench'>> = {
        5:  { slotTank: 1, slotHealer: 1, slotDps: 3, slotFlex: 0, slotBench: 0 },
        8:  { slotTank: 1, slotHealer: 2, slotDps: 5, slotFlex: 0, slotBench: 0 },
        10: { slotTank: 2, slotHealer: 2, slotDps: 5, slotFlex: 1, slotBench: 0 },
        20: { slotTank: 2, slotHealer: 4, slotDps: 12, slotFlex: 2, slotBench: 0 },
        24: { slotTank: 2, slotHealer: 5, slotDps: 15, slotFlex: 2, slotBench: 0 },
        25: { slotTank: 2, slotHealer: 5, slotDps: 15, slotFlex: 3, slotBench: 0 },
        30: { slotTank: 2, slotHealer: 6, slotDps: 18, slotFlex: 4, slotBench: 0 },
        40: { slotTank: 4, slotHealer: 10, slotDps: 22, slotFlex: 4, slotBench: 0 },
    };
    if (known[cap]) return known[cap];
    const tank = Math.max(1, Math.round(cap * 0.1));
    const healer = Math.max(1, Math.round(cap * 0.2));
    const flex = Math.round(cap * 0.15);
    const dps = cap - tank - healer - flex;
    return { slotTank: tank, slotHealer: healer, slotDps: Math.max(1, dps), slotFlex: flex, slotBench: 0 };
}

// getWowVariant and getContentType imported from plugin slot (ROK-238)

interface FormState {
    title: string;
    description: string;
    game: IgdbGameDto | null;
    eventTypeId: string | null;
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

/**
 * Number stepper for slot counts.
 */
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
                >
                    -
                </button>
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
                >
                    +
                </button>
            </div>
        </div>
    );
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
            selectedInstances: [],
            titleIsAutoSuggested: false,
            descriptionIsAutoSuggested: false,
        };
    }

    const [form, setForm] = useState<FormState>(getInitialState);
    const [errors, setErrors] = useState<FormErrors>({});
    const [saveTemplateName, setSaveTemplateName] = useState('');
    const [showSaveTemplate, setShowSaveTemplate] = useState(false);
    // Content search state moved to plugin slot (ROK-238)

    // Track previous auto-suggestions to detect manual edits
    const prevSuggestionRef = useRef('');
    const prevDescSuggestionRef = useRef('');

    // Templates
    const { data: templatesData } = useEventTemplates();
    const createTemplateMutation = useCreateTemplate();
    const deleteTemplateMutation = useDeleteTemplate();
    const templates = templatesData?.data ?? [];

    // Event type auto-populate
    const { games: registryGames } = useGameRegistry();
    const gameName = form.game?.name;
    const gameSlug = form.game?.slug;
    const registryGame = useMemo(() => {
        if (!gameName && !gameSlug) return undefined;
        return registryGames.find(
            (g) => (gameName && g.name.toLowerCase() === gameName.toLowerCase()) || g.slug === gameSlug,
        );
    }, [gameName, gameSlug, registryGames]);
    const registryGameId = registryGame?.id;
    const registrySlug = registryGame?.slug;
    const { data: eventTypesData } = useEventTypes(registryGameId);
    const eventTypes = eventTypesData?.data ?? [];

    // Interest stats
    const igdbId = form.game?.igdbId;
    const { count: interestCount, isLoading: interestLoading } = useWantToPlay(igdbId);

    // WoW content browsing (ROK-238: logic delegated to plugin slot)
    const wowVariant = registrySlug ? getWowVariant(registrySlug) : null;
    const selectedEventType = eventTypes.find((t) => t.id === form.eventTypeId);
    const contentType = selectedEventType?.slug ? getContentType(selectedEventType.slug) : null;

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
        // Intersection: highest min to lowest max = range where all dungeons are appropriate
        const overlapMin = Math.max(...levels.map((l) => l.min));
        const overlapMax = Math.min(...levels.map((l) => l.max));
        if (overlapMin > overlapMax) {
            // No overlap — fall back to full range
            const fullMin = Math.min(...levels.map((l) => l.min));
            const fullMax = Math.max(...levels.map((l) => l.max));
            return `Level ${fullMin}-${fullMax} suggested`;
        }
        if (overlapMin === overlapMax) return `Level ${overlapMin} suggested`;
        return `Level ${overlapMin}-${overlapMax} suggested`;
    }, [form.selectedInstances]);

    // Auto-fill title and description when suggestions change (if user hasn't manually edited)
    useEffect(() => {
        const newSuggestion = computeSuggestion();
        const newDescSuggestion = computeDescriptionSuggestion();

        setForm((prev) => {
            let next = prev;

            // Title auto-fill
            if (newSuggestion && (prev.titleIsAutoSuggested || prev.title === '' || prev.title === prevSuggestionRef.current)) {
                next = { ...next, title: newSuggestion, titleIsAutoSuggested: true };
            }
            prevSuggestionRef.current = newSuggestion;

            // Description auto-fill
            if (newDescSuggestion && (prev.descriptionIsAutoSuggested || prev.description === '' || prev.description === prevDescSuggestionRef.current)) {
                next = { ...next, description: newDescSuggestion, descriptionIsAutoSuggested: true };
            }
            prevDescSuggestionRef.current = newDescSuggestion;

            return next === prev ? prev : next;
        });
    }, [computeSuggestion, computeDescriptionSuggestion]);

    function handleEventTypeChange(eventTypeId: string) {
        if (eventTypeId === 'custom') {
            setForm((prev) => ({
                ...prev,
                eventTypeId: null,
                selectedInstances: [],
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
            }));
            return;
        }
        const et = eventTypes.find((t) => t.id === eventTypeId);
        if (!et) return;
        const updates: Partial<FormState> = { eventTypeId, selectedInstances: [] };
        if (et.defaultDurationMinutes) {
            updates.durationMinutes = et.defaultDurationMinutes;
            updates.customDuration = !DURATION_PRESETS.some((p) => p.minutes === et.defaultDurationMinutes);
        }
        if (et.defaultPlayerCap) {
            updates.maxAttendees = String(et.defaultPlayerCap);
            if (et.requiresComposition) {
                updates.slotType = 'mmo';
                Object.assign(updates, getCompositionForCap(et.defaultPlayerCap));
            } else {
                updates.slotType = 'generic';
                updates.slotPlayer = et.defaultPlayerCap;
                updates.slotBench = 0;
            }
        }
        if (et.requiresComposition && !et.defaultPlayerCap) {
            updates.slotType = 'mmo';
        } else if (!et.requiresComposition) {
            updates.slotType = 'generic';
        }
        setForm((prev) => ({ ...prev, ...updates }));
    }

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

    // Compute ISO strings for availability picker
    const computedTimes = useMemo(() => {
        if (!form.startDate || !form.startTime || form.durationMinutes <= 0) return null;
        const start = new TZDate(`${form.startDate}T${form.startTime}`, resolved);
        const end = new Date(start.getTime() + form.durationMinutes * 60 * 1000);
        return { startTime: start.toISOString(), endTime: end.toISOString() };
    }, [form.startDate, form.startTime, form.durationMinutes, resolved]);

    // Compute total slot count for preview
    const totalSlots = useMemo(() => {
        if (form.slotType === 'mmo') {
            return form.slotTank + form.slotHealer + form.slotDps + form.slotFlex + form.slotBench;
        }
        return form.slotPlayer + form.slotBench;
    }, [form.slotType, form.slotTank, form.slotHealer, form.slotDps, form.slotFlex, form.slotPlayer, form.slotBench]);

    // Compute recurrence count preview
    const recurrenceCount = useMemo(() => {
        if (!form.recurrenceFrequency || !form.startDate || !form.recurrenceUntil) return 0;
        const start = new Date(form.startDate);
        const until = new Date(form.recurrenceUntil);
        if (until <= start) return 0;
        let count = 1;
        let current = new Date(start);
        while (true) {
            const next = new Date(current);
            if (form.recurrenceFrequency === 'weekly') next.setDate(next.getDate() + 7);
            else if (form.recurrenceFrequency === 'biweekly') next.setDate(next.getDate() + 14);
            else next.setMonth(next.getMonth() + 1);
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
            gameId: form.game?.igdbId,
            registryGameId: registryGameId ?? undefined,
            startTime: start.toISOString(),
            endTime: end.toISOString(),
            slotConfig: buildSlotConfig(),
            maxAttendees: form.maxAttendees ? parseInt(form.maxAttendees) : undefined,
            autoUnbench: form.autoUnbench,
            recurrence,
            contentInstances: form.selectedInstances.length > 0 ? form.selectedInstances : undefined,
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
            {/* ═══════════ Templates Bar ═══════════ */}
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

            {/* ═══════════ Section 1: Game & Content ═══════════ */}
            <FormSection title="Game & Content">
                {/* Game Search — now first */}
                <GameSearchInput
                    value={form.game}
                    onChange={(game) => {
                        setForm((prev) => ({
                            ...prev,
                            game,
                            eventTypeId: null,
                            selectedInstances: [],
                            titleIsAutoSuggested: prev.titleIsAutoSuggested,
                        }));
                    }}
                />

                {/* Interest Stat */}
                {form.game && igdbId && !interestLoading && interestCount > 0 && (
                    <p className="text-xs text-muted -mt-2">
                        <span className="text-emerald-400 font-medium">{interestCount}</span> player{interestCount !== 1 ? 's' : ''} interested
                    </p>
                )}

                {/* Event Type Dropdown */}
                {!isEditMode && eventTypes.length > 0 && (
                    <div>
                        <label htmlFor="eventType" className="block text-sm font-medium text-secondary mb-2">
                            Event Type
                        </label>
                        <select
                            id="eventType"
                            value={form.eventTypeId ?? 'custom'}
                            onChange={(e) => handleEventTypeChange(e.target.value)}
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
                            Auto-fills duration and roster slots based on content type
                        </p>
                    </div>
                )}

                {/* Content Selection — plugin-provided (ROK-238) */}
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
            </FormSection>

            {/* Divider */}
            <div className="border-t border-edge-subtle" />

            {/* ═══════════ Section 2: Details ═══════════ */}
            <FormSection title="Details">
                {/* Title */}
                <div>
                    <label htmlFor="title" className="block text-sm font-medium text-secondary mb-2">
                        Event Title <span className="text-red-400">*</span>
                    </label>
                    <input
                        id="title"
                        type="text"
                        value={form.title}
                        onChange={(e) => {
                            const val = e.target.value;
                            setForm((prev) => ({
                                ...prev,
                                title: val,
                                titleIsAutoSuggested: false,
                            }));
                            if (errors.title) setErrors((prev) => ({ ...prev, title: undefined }));
                        }}
                        placeholder={computeSuggestion() || 'Weekly Raid Night'}
                        maxLength={200}
                        className={`w-full px-4 py-3 bg-panel border rounded-lg text-foreground placeholder-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors ${errors.title ? 'border-red-500' : 'border-edge'}`}
                    />
                    {form.titleIsAutoSuggested && (
                        <p className="mt-1 text-xs text-dim">Auto-suggested from your selections</p>
                    )}
                    {errors.title && (
                        <p className="mt-1 text-sm text-red-400">{errors.title}</p>
                    )}
                </div>

                {/* Description */}
                <div>
                    <label htmlFor="description" className="block text-sm font-medium text-secondary mb-2">
                        Description
                    </label>
                    <textarea
                        id="description"
                        value={form.description}
                        onChange={(e) => {
                            setForm((prev) => ({ ...prev, description: e.target.value, descriptionIsAutoSuggested: false }));
                        }}
                        placeholder={computeDescriptionSuggestion() || 'Add details about this event...'}
                        maxLength={2000}
                        rows={3}
                        className="w-full px-4 py-3 bg-panel border border-edge rounded-lg text-foreground placeholder-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors resize-none"
                    />
                    {form.descriptionIsAutoSuggested && (
                        <p className="mt-1 text-xs text-dim">Auto-suggested from your selections</p>
                    )}
                </div>
            </FormSection>

            {/* Divider */}
            <div className="border-t border-edge-subtle" />

            {/* ═══════════ Section 3: When ═══════════ */}
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
                                    updateField('durationMinutes', preset.minutes);
                                    updateField('customDuration', false);
                                    setErrors((prev) => ({ ...prev, duration: undefined }));
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
                        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 sm:items-center">
                            <div className="flex items-center gap-2">
                                <input
                                    type="number"
                                    min={0}
                                    max={24}
                                    value={Math.floor(form.durationMinutes / 60)}
                                    onChange={(e) => {
                                        const h = Math.max(0, Math.min(24, parseInt(e.target.value) || 0));
                                        const m = form.durationMinutes % 60;
                                        updateField('durationMinutes', h * 60 + m);
                                        setErrors((prev) => ({ ...prev, duration: undefined }));
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
                                    value={form.durationMinutes % 60}
                                    onChange={(e) => {
                                        const h = Math.floor(form.durationMinutes / 60);
                                        const m = Math.max(0, Math.min(59, parseInt(e.target.value) || 0));
                                        updateField('durationMinutes', h * 60 + m);
                                        setErrors((prev) => ({ ...prev, duration: undefined }));
                                    }}
                                    className="w-full sm:w-16 px-3 py-2 bg-panel border border-edge rounded-lg text-foreground text-center focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                />
                                <span className="text-sm text-muted shrink-0">min</span>
                            </div>
                        </div>
                    )}

                    {errors.duration && (
                        <p className="mt-1 text-sm text-red-400">{errors.duration}</p>
                    )}
                </div>

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

            {/* Divider */}
            <div className="border-t border-edge-subtle" />

            {/* ═══════════ Section 4: Roster ═══════════ */}
            <FormSection title="Roster">
                {/* Slot Type Toggle */}
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

                {/* Slot Steppers */}
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

                {/* Max Attendees */}
                <div>
                    <label htmlFor="maxAttendees" className="block text-sm font-medium text-secondary mb-2">
                        Max Attendees
                    </label>
                    <input
                        id="maxAttendees"
                        type="number"
                        min={1}
                        value={form.maxAttendees}
                        onChange={(e) => {
                            updateField('maxAttendees', e.target.value);
                            setErrors((prev) => ({ ...prev, maxAttendees: undefined }));
                        }}
                        placeholder="Unlimited"
                        className={`w-full px-4 py-3 bg-panel border rounded-lg text-foreground placeholder-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors ${errors.maxAttendees ? 'border-red-500' : 'border-edge'}`}
                    />
                    <p className="mt-1 text-xs text-dim">Leave empty for unlimited</p>
                    {errors.maxAttendees && (
                        <p className="mt-1 text-sm text-red-400">{errors.maxAttendees}</p>
                    )}
                </div>

                {/* Auto-Unbench Toggle — segmented pill style (matches event detail page) */}
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

            {/* Divider */}
            <div className="border-t border-edge-subtle" />

            {/* ═══════════ Section 5: Server Automation (stub) ═══════════ */}
            {form.game && (
                <>
                    <FormSection title="Server Automation">
                        <div className="bg-panel/30 border border-edge-subtle rounded-lg p-4 space-y-4 opacity-60">
                            <div className="flex items-center justify-between">
                                <label className="flex items-center gap-3">
                                    <input
                                        type="checkbox"
                                        disabled
                                        className="w-4 h-4 rounded border-edge bg-panel"
                                    />
                                    <span className="text-sm text-secondary">Auto-start server before event</span>
                                </label>
                                <span className="text-xs bg-overlay text-dim px-2 py-0.5 rounded-full">Coming soon</span>
                            </div>
                            <div>
                                <label className="block text-sm text-secondary mb-2">Server Host</label>
                                <select
                                    disabled
                                    className="w-full px-4 py-3 bg-panel border border-edge rounded-lg text-dim cursor-not-allowed"
                                >
                                    <option>Select server host...</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm text-secondary mb-2">Pre-start buffer</label>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="number"
                                        disabled
                                        value={5}
                                        className="w-20 px-3 py-2 bg-panel border border-edge rounded-lg text-dim text-center cursor-not-allowed"
                                    />
                                    <span className="text-sm text-dim">minutes before event</span>
                                </div>
                            </div>
                        </div>
                    </FormSection>
                    <div className="border-t border-edge-subtle" />
                </>
            )}

            {/* ═══════════ Section 6: Your Availability ═══════════ */}
            {computedTimes && (
                <>
                    <FormSection title="Your Availability">
                        <TeamAvailabilityPicker
                            eventStartTime={computedTimes.startTime}
                            eventEndTime={computedTimes.endTime}
                            gameId={form.game?.id?.toString()}
                        />
                    </FormSection>
                    <div className="border-t border-edge-subtle" />
                </>
            )}

            {/* ═══════════ Save as Template ═══════════ */}
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

            {/* ═══════════ Footer ═══════════ */}
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
