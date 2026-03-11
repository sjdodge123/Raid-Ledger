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
import { TimeSlotsSection, PollSettingsSection } from './plan-event-time-slots';

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

function getInitialFormState(): FormState {
    return {
        title: '', description: '', game: null, eventTypeId: null,
        durationMinutes: 120, customDuration: false,
        slotType: 'generic', slotTank: MMO_DEFAULTS.tank!, slotHealer: MMO_DEFAULTS.healer!,
        slotDps: MMO_DEFAULTS.dps!, slotFlex: 0, slotPlayer: GENERIC_DEFAULTS.player!,
        maxAttendees: '', autoUnbench: true,
        pollDurationHours: 24, pollMode: 'standard',
        selectedTimeSlots: [], customDate: '', customTime: '',
        reminder15min: true, reminder1hour: false, reminder24hour: false,
        selectedInstances: [], titleIsAutoSuggested: false, descriptionIsAutoSuggested: false,
    };
}

function buildSlotConfig(form: FormState): SlotConfigDto | undefined {
    if (form.slotType === 'mmo') {
        return { type: 'mmo', tank: form.slotTank, healer: form.slotHealer, dps: form.slotDps, flex: form.slotFlex };
    }
    return { type: 'generic', player: form.slotPlayer };
}

function buildSubmitDto(form: FormState, registryGameId: number | null | undefined): CreateEventPlanDto {
    return {
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        gameId: registryGameId ?? undefined,
        slotConfig: buildSlotConfig(form),
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
}

function validatePlanForm(form: FormState): Record<string, string> {
    const newErrors: Record<string, string> = {};
    if (!form.title.trim()) newErrors.title = 'Title is required';
    if (form.selectedTimeSlots.length < 2) newErrors.timeSlots = 'Select at least 2 time options';
    if (form.selectedTimeSlots.length > 9) newErrors.timeSlots = 'Maximum 9 time options';
    if (form.durationMinutes <= 0) newErrors.duration = 'Duration must be greater than 0';
    return newErrors;
}

/**
 * Plan Event Form — lets organizers pick candidate time slots and start a community poll.
 */
function usePlanFormState() {
    const { defaultTimezone } = useAdminSettings();
    const communityTimezone = defaultTimezone.data?.timezone ?? undefined;
    const [form, setForm] = useState<FormState>(getInitialFormState);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const registryGameId = useRegistryGameId(form.game);
    const { data: suggestions, isLoading: suggestionsLoading } = useTimeSuggestions({ gameId: registryGameId, tzOffset: new Date().getTimezoneOffset() });

    function updateField<K extends keyof FormState>(field: K, value: FormState[K]) {
        setForm((prev) => ({ ...prev, [field]: value }));
        if (field in errors) setErrors((prev) => ({ ...prev, [field]: '' }));
    }
    return { form, setForm, errors, setErrors, registryGameId, suggestions, suggestionsLoading, updateField, communityTimezone };
}

function usePlanTimeSlots(s: ReturnType<typeof usePlanFormState>) {
    function addTimeSlot(option: PollOption) {
        if (s.form.selectedTimeSlots.length >= 9) return;
        if (s.form.selectedTimeSlots.some((sl) => sl.date === option.date)) return;
        s.setForm((prev) => ({ ...prev, selectedTimeSlots: [...prev.selectedTimeSlots, option] }));
        s.setErrors((prev) => ({ ...prev, timeSlots: '' }));
    }

    function removeTimeSlot(date: string) {
        s.setForm((prev) => ({ ...prev, selectedTimeSlots: prev.selectedTimeSlots.filter((sl) => sl.date !== date) }));
    }

    function addCustomTime() {
        if (!s.form.customDate || !s.form.customTime) return;
        const dateObj = new Date(`${s.form.customDate}T${s.form.customTime}`);
        if (isNaN(dateObj.getTime())) return;
        const label = dateObj.toLocaleDateString('en-US', {
            weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short',
            ...(s.communityTimezone ? { timeZone: s.communityTimezone } : {}),
        });
        addTimeSlot({ date: dateObj.toISOString(), label });
        s.setForm((prev) => ({ ...prev, customDate: '', customTime: '' }));
    }

    return { addTimeSlot, removeTimeSlot, addCustomTime };
}

function usePlanFormSubmit(s: ReturnType<typeof usePlanFormState>) {
    const navigate = useNavigate();
    const createPlanMutation = useCreateEventPlan();
    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const newErrors = validatePlanForm(s.form);
        s.setErrors(newErrors);
        if (Object.keys(newErrors).length > 0) return;
        createPlanMutation.mutate(buildSubmitDto(s.form, s.registryGameId), { onSuccess: () => navigate('/events') });
    };
    return { navigate, createPlanMutation, handleSubmit };
}

export function PlanEventForm() {
    const s = usePlanFormState();
    const ts = usePlanTimeSlots(s);
    const { navigate, createPlanMutation, handleSubmit } = usePlanFormSubmit(s);
    const alreadySelected = new Set(s.form.selectedTimeSlots.map((sl) => sl.date));

    return (
        <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-8">
            <PlanGameSection form={s.form} setForm={s.setForm} errors={s.errors} setErrors={s.setErrors} />
            <div className="border-t border-edge-subtle" />
            <PlanTimeSlotsFormSection s={s} ts={ts} alreadySelected={alreadySelected} />
            <div className="border-t border-edge-subtle" />
            <PlanPollFormSection s={s} />
            <div className="border-t border-edge-subtle" />
            <PlanDurationFormSection s={s} />
            <div className="border-t border-edge-subtle" />
            <PlanRosterSection form={s.form} updateField={s.updateField} />
            <div className="border-t border-edge-subtle" />
            <PlanRemindersSection form={s.form} updateField={s.updateField} />
            <div className="border-t border-edge-subtle" />
            <PlanFormFooter isPending={createPlanMutation.isPending} onCancel={() => navigate('/events')} />
        </form>
    );
}

function PlanTimeSlotsFormSection({ s, ts, alreadySelected }: { s: ReturnType<typeof usePlanFormState>; ts: ReturnType<typeof usePlanTimeSlots>; alreadySelected: Set<string> }) {
    return (
        <FormSection title="Candidate Time Slots">
            <TimeSlotsSection suggestions={s.suggestions} suggestionsLoading={s.suggestionsLoading}
                selectedTimeSlots={s.form.selectedTimeSlots} alreadySelected={alreadySelected}
                customDate={s.form.customDate} customTime={s.form.customTime}
                onAddTimeSlot={ts.addTimeSlot} onRemoveTimeSlot={ts.removeTimeSlot}
                onCustomDateChange={(v) => s.updateField('customDate', v)} onCustomTimeChange={(v) => s.updateField('customTime', v)}
                onAddCustomTime={ts.addCustomTime} timeSlotsError={s.errors.timeSlots} />
        </FormSection>
    );
}

function PlanPollFormSection({ s }: { s: ReturnType<typeof usePlanFormState> }) {
    return (
        <FormSection title="Poll Settings">
            <PollSettingsSection pollDurationHours={s.form.pollDurationHours} pollMode={s.form.pollMode}
                onPollDurationChange={(v) => s.updateField('pollDurationHours', v)} onPollModeChange={(v) => s.updateField('pollMode', v)} />
        </FormSection>
    );
}

function PlanDurationFormSection({ s }: { s: ReturnType<typeof usePlanFormState> }) {
    return (
        <FormSection title="Event Duration">
            <DurationSection durationMinutes={s.form.durationMinutes} customDuration={s.form.customDuration} durationError={s.errors.duration}
                onDurationMinutesChange={(v) => s.updateField('durationMinutes', v)} onCustomDurationChange={(v) => s.updateField('customDuration', v)} />
        </FormSection>
    );
}

function PlanGameSection({ form, setForm, errors, setErrors }: {
    form: FormState; setForm: React.Dispatch<React.SetStateAction<FormState>>;
    errors: Record<string, string>; setErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}) {
    return (
        <FormSection title="Game & Details">
            <GameDetailsSection
                game={form.game} eventTypeId={form.eventTypeId} title={form.title}
                description={form.description} selectedInstances={form.selectedInstances}
                titleIsAutoSuggested={form.titleIsAutoSuggested}
                descriptionIsAutoSuggested={form.descriptionIsAutoSuggested}
                titleError={errors.title} titleInputId="planTitle" eventTypeSelectId="planEventType"
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
    );
}

function PlanRosterSection({ form, updateField }: {
    form: FormState; updateField: <K extends keyof FormState>(field: K, value: FormState[K]) => void;
}) {
    return (
        <FormSection title="Roster">
            <RosterSection
                slotType={form.slotType} slotTank={form.slotTank} slotHealer={form.slotHealer}
                slotDps={form.slotDps} slotPlayer={form.slotPlayer}
                maxAttendees={form.maxAttendees} autoUnbench={form.autoUnbench}
                maxAttendeesId="planMaxAttendees"
                onSlotTypeChange={(v) => updateField('slotType', v)}
                onSlotTankChange={(v) => updateField('slotTank', v)}
                onSlotHealerChange={(v) => updateField('slotHealer', v)}
                onSlotDpsChange={(v) => updateField('slotDps', v)}
                onSlotPlayerChange={(v) => updateField('slotPlayer', v)}
                onMaxAttendeesChange={(v) => updateField('maxAttendees', v)}
                onAutoUnbenchChange={(v) => updateField('autoUnbench', v)}
            />
        </FormSection>
    );
}

function PlanRemindersSection({ form, updateField }: {
    form: FormState; updateField: <K extends keyof FormState>(field: K, value: FormState[K]) => void;
}) {
    return (
        <FormSection title="Reminders">
            <RemindersSection
                reminder15min={form.reminder15min} reminder1hour={form.reminder1hour}
                reminder24hour={form.reminder24hour}
                onReminder15minChange={(v) => updateField('reminder15min', v)}
                onReminder1hourChange={(v) => updateField('reminder1hour', v)}
                onReminder24hourChange={(v) => updateField('reminder24hour', v)}
                description="Reminders for the auto-created event (after the poll closes)."
            />
        </FormSection>
    );
}

function PlanFormFooter({ isPending, onCancel }: { isPending: boolean; onCancel: () => void }) {
    return (
        <div className="flex items-center justify-end gap-4 pt-2">
            <button type="button" onClick={onCancel}
                className="px-6 py-3 text-secondary hover:text-foreground font-medium transition-colors">
                Cancel
            </button>
            <button type="submit" disabled={isPending}
                className="px-8 py-3 bg-violet-600 hover:bg-violet-500 disabled:bg-overlay disabled:text-muted text-foreground font-semibold rounded-lg transition-colors">
                {isPending ? 'Posting Poll...' : 'Start Poll'}
            </button>
        </div>
    );
}
