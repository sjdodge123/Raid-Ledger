import type { EventResponseDto, SlotConfigDto } from '@raid-ledger/contract';
import { DURATION_PRESETS, MMO_DEFAULTS, GENERIC_DEFAULTS } from './shared/event-form-constants';
import type { FormState, FormErrors } from './create-event-form.types';

function getEditModeState(editEvent: EventResponseDto, resolved: string): FormState {
    const start = new Date(editEvent.startTime);
    const end = new Date(editEvent.endTime);
    const durationMinutes = Math.round((end.getTime() - start.getTime()) / 60000);
    const isPreset = DURATION_PRESETS.some((p) => p.minutes === durationMinutes);
    const startLocal = new Intl.DateTimeFormat('en-CA', { timeZone: resolved, year: 'numeric', month: '2-digit', day: '2-digit' }).format(start);
    const timeLocal = new Intl.DateTimeFormat('en-GB', { timeZone: resolved, hour: '2-digit', minute: '2-digit', hour12: false }).format(start);
    const sc = editEvent.slotConfig;
    return {
        title: editEvent.title, description: editEvent.description ?? '',
        game: editEvent.game ? { id: editEvent.game.id, name: editEvent.game.name, slug: editEvent.game.slug, coverUrl: editEvent.game.coverUrl } as FormState['game'] : null,
        eventTypeId: null, startDate: startLocal, startTime: timeLocal,
        durationMinutes, customDuration: !isPreset,
        slotType: sc?.type ?? 'generic',
        slotTank: sc?.tank ?? MMO_DEFAULTS.tank!, slotHealer: sc?.healer ?? MMO_DEFAULTS.healer!,
        slotDps: sc?.dps ?? MMO_DEFAULTS.dps!, slotFlex: sc?.flex ?? MMO_DEFAULTS.flex!,
        slotPlayer: sc?.player ?? GENERIC_DEFAULTS.player!,
        maxAttendees: editEvent.maxAttendees ? String(editEvent.maxAttendees) : '',
        autoUnbench: editEvent.autoUnbench ?? true,
        recurrenceFrequency: '', recurrenceUntil: '',
        reminder15min: editEvent.reminder15min ?? true,
        reminder1hour: editEvent.reminder1hour ?? false,
        reminder24hour: editEvent.reminder24hour ?? false,
        selectedInstances: (editEvent.contentInstances as Record<string, unknown>[]) ?? [],
        titleIsAutoSuggested: false, descriptionIsAutoSuggested: false,
    };
}

function getDefaultState(): FormState {
    return {
        title: '', description: '', game: null, eventTypeId: null,
        startDate: '', startTime: '', durationMinutes: 120, customDuration: false,
        slotType: 'generic',
        slotTank: MMO_DEFAULTS.tank!, slotHealer: MMO_DEFAULTS.healer!,
        slotDps: MMO_DEFAULTS.dps!, slotFlex: MMO_DEFAULTS.flex!,
        slotPlayer: GENERIC_DEFAULTS.player!,
        maxAttendees: '', autoUnbench: true,
        recurrenceFrequency: '', recurrenceUntil: '',
        reminder15min: true, reminder1hour: false, reminder24hour: false,
        selectedInstances: [], titleIsAutoSuggested: false, descriptionIsAutoSuggested: false,
    };
}

export function getInitialState(editEvent: EventResponseDto | undefined, resolved: string): FormState {
    return editEvent ? getEditModeState(editEvent, resolved) : getDefaultState();
}

function validateRecurrence(form: FormState, errors: FormErrors) {
    if (form.recurrenceFrequency && !form.recurrenceUntil) {
        errors.recurrenceUntil = 'End date is required for recurring events';
    } else if (form.recurrenceFrequency && form.recurrenceUntil && form.startDate) {
        if (new Date(form.recurrenceUntil) <= new Date(form.startDate)) {
            errors.recurrenceUntil = 'End date must be after start date';
        }
    }
}

export function validateForm(form: FormState): FormErrors {
    const errors: FormErrors = {};
    if (!form.title.trim()) errors.title = 'Title is required';
    else if (form.title.length > 200) errors.title = 'Title must be 200 characters or less';
    if (!form.startDate) errors.startDate = 'Start date is required';
    if (!form.startTime) errors.startTime = 'Start time is required';
    if (form.durationMinutes <= 0) errors.duration = 'Duration must be greater than 0';
    else if (form.durationMinutes > 1440) errors.duration = 'Duration cannot exceed 24 hours';
    if (form.maxAttendees !== '') {
        const max = parseInt(form.maxAttendees);
        if (isNaN(max) || max < 1) errors.maxAttendees = 'Must be a positive number';
    }
    validateRecurrence(form, errors);
    return errors;
}

export function buildSlotConfig(form: FormState): SlotConfigDto {
    if (form.slotType === 'mmo') {
        return { type: 'mmo', tank: form.slotTank, healer: form.slotHealer, dps: form.slotDps, flex: form.slotFlex };
    }
    return { type: 'generic', player: form.slotPlayer };
}

const MAX_RECURRENCE_INSTANCES = 52;

function advanceWeekly(current: Date, frequency: string): Date {
    const next = new Date(current);
    next.setUTCDate(next.getUTCDate() + (frequency === 'biweekly' ? 14 : 7));
    return next;
}

function advanceMonthly(current: Date, originalDay: number): Date {
    const next = new Date(current);
    next.setUTCMonth(next.getUTCMonth() + 1);
    const intendedMonth = (current.getUTCMonth() + 1) % 12;
    if (next.getUTCMonth() !== intendedMonth) next.setUTCDate(0);
    if (next.getUTCDate() !== originalDay) {
        const testDate = new Date(next);
        testDate.setUTCDate(originalDay);
        if (testDate.getUTCMonth() === next.getUTCMonth()) next.setUTCDate(originalDay);
    }
    return next;
}

export function computeRecurrenceCount(frequency: string, startDate: string, untilDate: string): number {
    if (!frequency || !startDate || !untilDate) return 0;
    const start = new Date(startDate);
    const until = new Date(untilDate);
    if (until <= start) return 0;
    const originalDay = start.getUTCDate();
    let count = 1;
    let current = new Date(start);
    while (count < MAX_RECURRENCE_INSTANCES) {
        const next = frequency === 'monthly' ? advanceMonthly(current, originalDay) : advanceWeekly(current, frequency);
        if (next > until) break;
        count++; current = next;
    }
    return count;
}

export function formatDuration(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
}
