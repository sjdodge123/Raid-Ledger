import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '../../lib/toast';
import type { CreateEventDto, UpdateEventDto, RecurrenceDto, TemplateConfigDto, EventResponseDto, SeriesScope } from '@raid-ledger/contract';
import { createEvent, updateEvent, updateSeries, completeStandalonePoll } from '../../lib/api-client';
import { useTimezoneStore } from '../../stores/timezone-store';
import { getTimezoneAbbr } from '../../lib/timezone-utils';
import { TZDate } from '@date-fns/tz';
import { useEventTemplates, useCreateTemplate, useDeleteTemplate } from '../../hooks/use-event-templates';
import { useWantToPlay } from '../../hooks/use-want-to-play';
import '../../pages/event-detail-page.css';
import { type SlotState } from './shared/event-form-constants';
import { GameDetailsSection } from './shared/game-details-section';
import { useRegistryGameId } from './shared/use-registry-game-id';
import { RosterSection } from './shared/roster-section';
import { RemindersSection } from './shared/reminders-section';
import type { FormState, FormErrors, EventFormProps } from './create-event-form.types';
import { ERROR_FIELD_MAP } from './create-event-form.types';
import { getInitialState, validateForm, buildSlotConfig, computeRecurrenceCount } from './create-event-form.utils';
import { FormSection, TemplatesBar, WhenSection, SaveTemplateBar, FormFooter } from './create-event-form-sections';

function useCreateEventMutation(isEditMode: boolean, editEventId: number | undefined, seriesScope?: SeriesScope, schedulingMatchId?: number | null, schedulingStartTime?: string | null) {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const isSeriesEdit = isEditMode && !!seriesScope && seriesScope !== 'this';

    return useMutation({
        mutationFn: (dto: CreateEventDto) => {
            if (isSeriesEdit) return updateSeries(editEventId!, seriesScope!, dto as UpdateEventDto).then(() => undefined);
            return isEditMode ? updateEvent(editEventId!, dto as UpdateEventDto) : createEvent(dto);
        },
        onSuccess: (event) => {
            toast.success(isSeriesEdit ? 'Series updated!' : isEditMode ? 'Event updated!' : 'Event created successfully!');
            queryClient.invalidateQueries({ queryKey: ['events'] });
            if (isEditMode) queryClient.invalidateQueries({ queryKey: ['event', editEventId!] });
            if (schedulingMatchId) void completeStandalonePoll(schedulingMatchId, event?.id, schedulingStartTime ?? undefined);
            navigate(event ? `/events/${event.id}` : `/events/${editEventId}`);
        },
        onError: (error: Error) => { toast.error(error.message || `Failed to ${isEditMode ? 'update' : 'create'} event`); },
    });
}

function buildSubmitDto(form: FormState, resolved: string, registryGameId: number | null | undefined): CreateEventDto {
    const start = new TZDate(`${form.startDate}T${form.startTime}`, resolved);
    const end = new Date(start.getTime() + form.durationMinutes * 60 * 1000);
    let recurrence: RecurrenceDto | undefined;
    if (form.recurrenceFrequency) {
        recurrence = { frequency: form.recurrenceFrequency, until: new TZDate(`${form.recurrenceUntil}T23:59:59`, resolved).toISOString() };
    }
    return {
        title: form.title.trim(), description: form.description.trim() || undefined,
        gameId: registryGameId ?? undefined, startTime: start.toISOString(), endTime: end.toISOString(),
        slotConfig: buildSlotConfig(form), maxAttendees: form.maxAttendees ? parseInt(form.maxAttendees) : undefined,
        autoUnbench: form.autoUnbench, recurrence,
        contentInstances: form.selectedInstances.length > 0 ? form.selectedInstances : undefined,
        reminder15min: form.reminder15min, reminder1hour: form.reminder1hour, reminder24hour: form.reminder24hour,
    };
}

function loadTemplateIntoForm(config: TemplateConfigDto, setForm: React.Dispatch<React.SetStateAction<FormState>>) {
    setForm((prev) => ({
        ...prev,
        title: config.title ?? prev.title, description: config.description ?? prev.description,
        durationMinutes: config.durationMinutes ?? prev.durationMinutes,
        slotType: config.slotConfig?.type ?? prev.slotType,
        slotTank: config.slotConfig?.tank ?? prev.slotTank, slotHealer: config.slotConfig?.healer ?? prev.slotHealer,
        slotDps: config.slotConfig?.dps ?? prev.slotDps, slotFlex: 0,
        slotPlayer: config.slotConfig?.player ?? prev.slotPlayer,
        maxAttendees: config.maxAttendees ? String(config.maxAttendees) : prev.maxAttendees,
        autoUnbench: config.autoUnbench ?? prev.autoUnbench,
        recurrenceFrequency: config.recurrence?.frequency ?? prev.recurrenceFrequency,
        titleIsAutoSuggested: false, descriptionIsAutoSuggested: false,
    }));
    toast.success('Template loaded');
}

function useEndTimePreview(startDate: string, startTime: string, durationMinutes: number, resolved: string) {
    return useMemo(() => {
        if (!startDate || !startTime || durationMinutes <= 0) return null;
        const start = new TZDate(`${startDate}T${startTime}`, resolved);
        const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
        return new TZDate(end, resolved).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: resolved });
    }, [startDate, startTime, durationMinutes, resolved]);
}

function useTemplateActions(form: FormState) {
    const [saveTemplateName, setSaveTemplateName] = useState('');
    const [showSaveTemplate, setShowSaveTemplate] = useState(false);
    const { data: templatesData } = useEventTemplates();
    const createTemplateMutation = useCreateTemplate();
    const deleteTemplateMutation = useDeleteTemplate();

    function saveTemplate() {
        if (!saveTemplateName.trim()) return;
        const config: TemplateConfigDto = {
            title: form.title || undefined, description: form.description || undefined,
            durationMinutes: form.durationMinutes, slotConfig: buildSlotConfig(form),
            maxAttendees: form.maxAttendees ? parseInt(form.maxAttendees) : undefined,
            autoUnbench: form.autoUnbench,
        };
        createTemplateMutation.mutate(
            { name: saveTemplateName.trim(), config },
            { onSuccess: () => { setShowSaveTemplate(false); setSaveTemplateName(''); } },
        );
    }

    return {
        templates: templatesData?.data ?? [],
        saveTemplateName, setSaveTemplateName,
        showSaveTemplate, setShowSaveTemplate,
        createTemplateMutation, deleteTemplateMutation,
        saveTemplate,
    };
}

function submitForm(form: FormState, _errors: FormErrors, setErrors: React.Dispatch<React.SetStateAction<FormErrors>>,
    resolved: string, registryGameId: number | null | undefined,
    mutate: (dto: CreateEventDto) => void) {
    const validationErrors = validateForm(form);
    setErrors(validationErrors);
    const errorKeys = Object.keys(validationErrors);
    if (errorKeys.length > 0) {
        const fieldId = ERROR_FIELD_MAP[errorKeys[0]];
        if (fieldId) document.getElementById(fieldId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }
    mutate(buildSubmitDto(form, resolved, registryGameId));
}

function useCreateEventFormState(
    editEvent?: EventResponseDto, seriesScope?: SeriesScope,
    initialGame?: EventFormProps['initialGame'], initialStartTime?: string | null,
    schedulingMatchId?: number | null,
) {
    const resolved = useTimezoneStore((s) => s.resolved);
    const tzAbbr = getTimezoneAbbr(resolved);
    const [form, setForm] = useState<FormState>(() => {
        const state = getInitialState(editEvent, resolved, initialStartTime);
        if (!editEvent && initialGame) {
            state.game = initialGame as FormState['game'];
            if (initialGame.playerCount?.max) {
                state.slotPlayer = initialGame.playerCount.max;
                if (!state.maxAttendees) state.maxAttendees = String(initialGame.playerCount.max);
            }
        }
        return state;
    });
    const [errors, setErrors] = useState<FormErrors>({});
    const registryGameId = useRegistryGameId(form.game);
    const { count: interestCount, isLoading: interestLoading } = useWantToPlay(form.game?.id ?? undefined);
    const mutation = useCreateEventMutation(!!editEvent, editEvent?.id, seriesScope, schedulingMatchId, initialStartTime);
    const tpl = useTemplateActions(form);
    const endTimePreview = useEndTimePreview(form.startDate, form.startTime, form.durationMinutes, resolved);
    const recurrenceCount = useMemo(() => computeRecurrenceCount(form.recurrenceFrequency, form.startDate, form.recurrenceUntil), [form.recurrenceFrequency, form.startDate, form.recurrenceUntil]);

    function updateField<K extends keyof FormState>(field: K, value: FormState[K]) {
        setForm((prev) => ({ ...prev, [field]: value }));
        if (field in errors) setErrors((prev) => ({ ...prev, [field]: undefined }));
    }

    return { form, setForm, errors, setErrors, registryGameId, interestCount, interestLoading, mutation, tpl, endTimePreview, recurrenceCount, updateField, resolved, tzAbbr };
}

export function CreateEventForm({ event: editEvent, seriesScope, initialGame, initialStartTime, schedulingMatchId }: EventFormProps = {}) {
    const isEditMode = !!editEvent;
    const navigate = useNavigate();
    const s = useCreateEventFormState(editEvent, seriesScope, initialGame, initialStartTime, schedulingMatchId);

    return (
        <form onSubmit={(e) => { e.preventDefault(); submitForm(s.form, s.errors, s.setErrors, s.resolved, s.registryGameId, s.mutation.mutate); }} className="space-y-4 sm:space-y-8">
            <TemplatesBar templates={s.tpl.templates} onLoad={(c) => loadTemplateIntoForm(c, s.setForm)} onDelete={(id) => s.tpl.deleteTemplateMutation.mutate(id)} />
            <GameContentSection form={s.form} setForm={s.setForm} errors={s.errors} setErrors={s.setErrors}
                isEditMode={isEditMode} interestCount={s.interestCount} interestLoading={s.interestLoading} />
            <div className="border-t border-edge-subtle" />
            <WhenSection form={s.form} errors={s.errors} isEditMode={isEditMode} tzAbbr={s.tzAbbr}
                endTimePreview={s.endTimePreview} recurrenceCount={s.recurrenceCount} updateField={s.updateField} setErrors={s.setErrors} />
            <div className="border-t border-edge-subtle" />
            <RosterFormSection form={s.form} errors={s.errors} updateField={s.updateField} setErrors={s.setErrors} />
            <div className="border-t border-edge-subtle" />
            <RemindersFormSection form={s.form} updateField={s.updateField} />
            <div className="border-t border-edge-subtle" />
            <SaveTemplateBar show={s.tpl.showSaveTemplate} name={s.tpl.saveTemplateName} isPending={s.tpl.createTemplateMutation.isPending}
                onNameChange={s.tpl.setSaveTemplateName} onSave={s.tpl.saveTemplate}
                onClose={() => { s.tpl.setShowSaveTemplate(false); s.tpl.setSaveTemplateName(''); }} />
            <FormFooter isEditMode={isEditMode} isPending={s.mutation.isPending}
                onShowSaveTemplate={() => s.tpl.setShowSaveTemplate(true)} onCancel={() => navigate('/events')} />
        </form>
    );
}

function GameContentSection({ form, setForm, errors, setErrors, isEditMode, interestCount, interestLoading }: {
    form: FormState; setForm: React.Dispatch<React.SetStateAction<FormState>>;
    errors: FormErrors; setErrors: React.Dispatch<React.SetStateAction<FormErrors>>;
    isEditMode: boolean;
    interestCount: number; interestLoading: boolean;
}) {
    return (
        <FormSection title="Game & Content">
            <GameDetailsSection
                game={form.game} eventTypeId={form.eventTypeId} title={form.title} description={form.description}
                selectedInstances={form.selectedInstances} titleIsAutoSuggested={form.titleIsAutoSuggested}
                descriptionIsAutoSuggested={form.descriptionIsAutoSuggested} titleError={errors.title}
                titleInputId="title" eventTypeSelectId="eventType" showEventType={!isEditMode}
                onGameChange={(game) => setForm((prev) => {
                    const updates: Partial<typeof prev> = { game, titleIsAutoSuggested: prev.titleIsAutoSuggested };
                    if (game?.playerCount?.max) {
                        updates.slotPlayer = game.playerCount.max;
                        if (!prev.maxAttendees) updates.maxAttendees = String(game.playerCount.max);
                    }
                    return { ...prev, ...updates };
                })}
                onEventTypeIdChange={(id) => setForm((prev) => ({ ...prev, eventTypeId: id }))}
                onTitleChange={(title, isAuto) => { setForm((prev) => ({ ...prev, title, titleIsAutoSuggested: isAuto })); if (!isAuto && errors.title) setErrors((prev) => ({ ...prev, title: undefined })); }}
                onDescriptionChange={(description, isAuto) => setForm((prev) => ({ ...prev, description, descriptionIsAutoSuggested: isAuto }))}
                onSelectedInstancesChange={(instances) => setForm((prev) => ({ ...prev, selectedInstances: instances }))}
                onEventTypeDefaults={(defaults: Partial<SlotState>) => setForm((prev) => ({ ...prev, ...defaults }))}
                interestCount={interestCount} interestLoading={interestLoading}
                slotBetween={<><div className="border-t border-edge-subtle -mx-0" /><h3 className="text-sm font-semibold text-muted uppercase tracking-wider">Details</h3></>}
            />
        </FormSection>
    );
}

function RosterFormSection({ form, errors, updateField, setErrors }: {
    form: FormState; errors: FormErrors;
    updateField: <K extends keyof FormState>(field: K, value: FormState[K]) => void;
    setErrors: React.Dispatch<React.SetStateAction<FormErrors>>;
}) {
    return (
        <FormSection title="Roster">
            <RosterSection
                slotType={form.slotType} slotTank={form.slotTank} slotHealer={form.slotHealer}
                slotDps={form.slotDps} slotPlayer={form.slotPlayer}
                maxAttendees={form.maxAttendees} autoUnbench={form.autoUnbench}
                maxAttendeesError={errors.maxAttendees} maxAttendeesId="maxAttendees"
                onSlotTypeChange={(v) => updateField('slotType', v)} onSlotTankChange={(v) => updateField('slotTank', v)}
                onSlotHealerChange={(v) => updateField('slotHealer', v)} onSlotDpsChange={(v) => updateField('slotDps', v)}
                onSlotPlayerChange={(v) => updateField('slotPlayer', v)}
                onMaxAttendeesChange={(v) => { updateField('maxAttendees', v); setErrors((prev) => ({ ...prev, maxAttendees: undefined })); }}
                onAutoUnbenchChange={(v) => updateField('autoUnbench', v)}
            />
        </FormSection>
    );
}

function RemindersFormSection({ form, updateField }: {
    form: FormState; updateField: <K extends keyof FormState>(field: K, value: FormState[K]) => void;
}) {
    return (
        <FormSection title="Reminders">
            <RemindersSection
                reminder15min={form.reminder15min} reminder1hour={form.reminder1hour} reminder24hour={form.reminder24hour}
                onReminder15minChange={(v) => updateField('reminder15min', v)}
                onReminder1hourChange={(v) => updateField('reminder1hour', v)}
                onReminder24hourChange={(v) => updateField('reminder24hour', v)}
            />
        </FormSection>
    );
}



