import type { IgdbGameDto, EventResponseDto } from '@raid-ledger/contract';

export interface FormState {
    title: string;
    description: string;
    game: IgdbGameDto | null;
    eventTypeId: number | null;
    startDate: string;
    startTime: string;
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
    recurrenceFrequency: '' | 'weekly' | 'biweekly' | 'monthly';
    recurrenceUntil: string;
    reminder15min: boolean;
    reminder1hour: boolean;
    reminder24hour: boolean;
    selectedInstances: Record<string, unknown>[];
    titleIsAutoSuggested: boolean;
    descriptionIsAutoSuggested: boolean;
}

export interface FormErrors {
    title?: string;
    startDate?: string;
    startTime?: string;
    duration?: string;
    maxAttendees?: string;
    recurrenceUntil?: string;
}

export interface EventFormProps {
    event?: EventResponseDto;
}

export const RECURRENCE_OPTIONS = [
    { value: '', label: 'Does not repeat' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'biweekly', label: 'Every 2 weeks' },
    { value: 'monthly', label: 'Monthly' },
] as const;

export const ERROR_FIELD_MAP: Record<string, string> = {
    title: 'title',
    startDate: 'startDate',
    startTime: 'startTime',
    maxAttendees: 'maxAttendees',
    recurrenceUntil: 'recurrenceUntil',
};
