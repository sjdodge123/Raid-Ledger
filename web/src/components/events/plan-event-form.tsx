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

/**
 * Plan Event Form — lets organizers pick candidate time slots and start a community poll.
 */
export function PlanEventForm() {
    const navigate = useNavigate();
    const createPlanMutation = useCreateEventPlan();
    const { defaultTimezone } = useAdminSettings();
    const communityTimezone = defaultTimezone.data?.timezone ?? undefined;

    const [form, setForm] = useState<FormState>({
        title: '', description: '', game: null, eventTypeId: null,
        durationMinutes: 120, customDuration: false,
        slotType: 'generic', slotTank: MMO_DEFAULTS.tank!, slotHealer: MMO_DEFAULTS.healer!,
        slotDps: MMO_DEFAULTS.dps!, slotFlex: MMO_DEFAULTS.flex!, slotPlayer: GENERIC_DEFAULTS.player!,
        maxAttendees: '', autoUnbench: true,
        pollDurationHours: 24, pollMode: 'standard',
        selectedTimeSlots: [], customDate: '', customTime: '',
        reminder15min: true, reminder1hour: false, reminder24hour: false,
        selectedInstances: [], titleIsAutoSuggested: false, descriptionIsAutoSuggested: false,
    });

    const [errors, setErrors] = useState<Record<string, string>>({});
    const registryGameId = useRegistryGameId(form.game);
    const { data: suggestions, isLoading: suggestionsLoading } = useTimeSuggestions({
        gameId: registryGameId,
        tzOffset: new Date().getTimezoneOffset(),
    });

    function updateField<K extends keyof FormState>(field: K, value: FormState[K]) {
        setForm((prev) => ({ ...prev, [field]: value }));
        if (field in errors) setErrors((prev) => ({ ...prev, [field]: '' }));
    }

    function addTimeSlot(option: PollOption) {
        if (form.selectedTimeSlots.length >= 9) return;
        if (form.selectedTimeSlots.some((s) => s.date === option.date)) return;
        setForm((prev) => ({ ...prev, selectedTimeSlots: [...prev.selectedTimeSlots, option] }));
        setErrors((prev) => ({ ...prev, timeSlots: '' }));
    }

    function removeTimeSlot(date: string) {
        setForm((prev) => ({ ...prev, selectedTimeSlots: prev.selectedTimeSlots.filter((s) => s.date !== date) }));
    }

    function addCustomTime() {
        if (!form.customDate || !form.customTime) return;
        const dateObj = new Date(`${form.customDate}T${form.customTime}`);
        if (isNaN(dateObj.getTime())) return;
        const label = dateObj.toLocaleDateString('en-US', {
            weekday: 'long', month: 'short', day: 'numeric',
            hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short',
            ...(communityTimezone ? { timeZone: communityTimezone } : {}),
        });
        addTimeSlot({ date: dateObj.toISOString(), label });
        setForm((prev) => ({ ...prev, customDate: '', customTime: '' }));
    }

    function buildSlotConfig(): SlotConfigDto | undefined {
        if (form.slotType === 'mmo') {
            return { type: 'mmo', tank: form.slotTank, healer: form.slotHealer, dps: form.slotDps, flex: form.slotFlex };
        }
        return { type: 'generic', player: form.slotPlayer };
    }

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        const newErrors: Record<string, string> = {};
        if (!form.title.trim()) newErrors.title = 'Title is required';
        if (form.selectedTimeSlots.length < 2) newErrors.timeSlots = 'Select at least 2 time options';
        if (form.selectedTimeSlots.length > 9) newErrors.timeSlots = 'Maximum 9 time options';
        if (form.durationMinutes <= 0) newErrors.duration = 'Duration must be greater than 0';
        setErrors(newErrors);
        if (Object.keys(newErrors).length > 0) return;

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
        createPlanMutation.mutate(dto, { onSuccess: () => navigate('/events') });
    }

    const alreadySelected = new Set(form.selectedTimeSlots.map((s) => s.date));

    return (
        <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-8">
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

            <div className="border-t border-edge-subtle" />

            <FormSection title="Candidate Time Slots">
                <TimeSlotsSection
                    suggestions={suggestions} suggestionsLoading={suggestionsLoading}
                    selectedTimeSlots={form.selectedTimeSlots} alreadySelected={alreadySelected}
                    customDate={form.customDate} customTime={form.customTime}
                    onAddTimeSlot={addTimeSlot} onRemoveTimeSlot={removeTimeSlot}
                    onCustomDateChange={(v) => updateField('customDate', v)}
                    onCustomTimeChange={(v) => updateField('customTime', v)}
                    onAddCustomTime={addCustomTime} timeSlotsError={errors.timeSlots}
                />
            </FormSection>

            <div className="border-t border-edge-subtle" />

            <FormSection title="Poll Settings">
                <PollSettingsSection
                    pollDurationHours={form.pollDurationHours} pollMode={form.pollMode}
                    onPollDurationChange={(v) => updateField('pollDurationHours', v)}
                    onPollModeChange={(v) => updateField('pollMode', v)}
                />
            </FormSection>

            <div className="border-t border-edge-subtle" />

            <FormSection title="Event Duration">
                <DurationSection
                    durationMinutes={form.durationMinutes} customDuration={form.customDuration}
                    durationError={errors.duration}
                    onDurationMinutesChange={(v) => updateField('durationMinutes', v)}
                    onCustomDurationChange={(v) => updateField('customDuration', v)}
                />
            </FormSection>

            <div className="border-t border-edge-subtle" />

            <FormSection title="Roster">
                <RosterSection
                    slotType={form.slotType} slotTank={form.slotTank} slotHealer={form.slotHealer}
                    slotDps={form.slotDps} slotFlex={form.slotFlex} slotPlayer={form.slotPlayer}
                    maxAttendees={form.maxAttendees} autoUnbench={form.autoUnbench}
                    maxAttendeesId="planMaxAttendees"
                    onSlotTypeChange={(v) => updateField('slotType', v)}
                    onSlotTankChange={(v) => updateField('slotTank', v)}
                    onSlotHealerChange={(v) => updateField('slotHealer', v)}
                    onSlotDpsChange={(v) => updateField('slotDps', v)}
                    onSlotFlexChange={(v) => updateField('slotFlex', v)}
                    onSlotPlayerChange={(v) => updateField('slotPlayer', v)}
                    onMaxAttendeesChange={(v) => updateField('maxAttendees', v)}
                    onAutoUnbenchChange={(v) => updateField('autoUnbench', v)}
                />
            </FormSection>

            <div className="border-t border-edge-subtle" />

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

            <div className="border-t border-edge-subtle" />

            <div className="flex items-center justify-end gap-4 pt-2">
                <button type="button" onClick={() => navigate('/events')}
                    className="px-6 py-3 text-secondary hover:text-foreground font-medium transition-colors">
                    Cancel
                </button>
                <button type="submit" disabled={createPlanMutation.isPending}
                    className="px-8 py-3 bg-violet-600 hover:bg-violet-500 disabled:bg-overlay disabled:text-muted text-foreground font-semibold rounded-lg transition-colors">
                    {createPlanMutation.isPending ? 'Posting Poll...' : 'Start Poll'}
                </button>
            </div>
        </form>
    );
}
