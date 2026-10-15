import { describe, it, expect } from 'vitest';
import type { EventResponseDto } from '@raid-ledger/contract';
import { buildSubmitDto, getInitialState, guildIdForSubmit } from './create-event-form.utils';

const TZ = 'UTC';

/**
 * A fully-configured ended event — every field the post-event follow-up flow
 * is expected to carry forward is set to a NON-default value, so a regression
 * that silently falls back to `getDefaultState()` fails loudly.
 */
function buildEndedEvent(overrides: Partial<EventResponseDto> = {}): EventResponseDto {
    return {
        id: 501,
        title: 'Thursday Deep Rock',
        description: 'Bring your own beer',
        startTime: '2026-08-20T20:00:00.000Z',
        endTime: '2026-08-20T23:00:00.000Z',
        creator: { id: 1, displayName: 'Jake', avatar: null },
        game: { id: 42, name: 'Deep Rock Galactic', slug: 'drg', coverUrl: null },
        signupCount: 4,
        slotConfig: { type: 'mmo', tank: 2, healer: 3, dps: 7, player: 0 },
        maxAttendees: 12,
        autoUnbench: false,
        contentInstances: [{ name: 'Salvage' }],
        reminder15min: false,
        reminder1hour: true,
        reminder24hour: true,
        ephemeralVoiceEnabled: true,
        privateVoice: true,
        ...overrides,
    } as unknown as EventResponseDto;
}

describe('getInitialState — copy-from-event prefill', () => {
    it('carries every configured field forward from the source event', () => {
        const state = getInitialState(undefined, TZ, null, buildEndedEvent());

        expect(state.title).toBe('Thursday Deep Rock');
        expect(state.description).toBe('Bring your own beer');
        expect(state.game?.id).toBe(42);
        expect(state.durationMinutes).toBe(180);
        expect(state.slotType).toBe('mmo');
        expect(state.slotTank).toBe(2);
        expect(state.slotHealer).toBe(3);
        expect(state.slotDps).toBe(7);
        expect(state.maxAttendees).toBe('12');
        expect(state.autoUnbench).toBe(false);
        expect(state.reminder15min).toBe(false);
        expect(state.reminder1hour).toBe(true);
        expect(state.reminder24hour).toBe(true);
        expect(state.ephemeralVoiceEnabled).toBe(true);
        expect(state.privateVoice).toBe(true);
        expect(state.selectedInstances).toEqual([{ name: 'Salvage' }]);
    });

    it('does NOT carry the old start date/time — the organizer picks a fresh one', () => {
        const state = getInitialState(undefined, TZ, null, buildEndedEvent());

        expect(state.startDate).toBe('');
        expect(state.startTime).toBe('');
    });

    it('lets an explicit initialStartTime (poll lock-in) fill the blank time', () => {
        const state = getInitialState(
            undefined,
            TZ,
            '2026-09-03T18:30:00.000Z',
            buildEndedEvent(),
        );

        expect(state.startDate).toBe('2026-09-03');
        expect(state.startTime).toBe('18:30');
        // Prefilled fields survive the start-time overlay.
        expect(state.title).toBe('Thursday Deep Rock');
        expect(state.durationMinutes).toBe(180);
    });

    it('does not carry recurrence — a follow-up is a fresh one-off', () => {
        const state = getInitialState(undefined, TZ, null, buildEndedEvent());

        expect(state.recurrenceFrequency).toBe('');
        expect(state.recurrenceUntil).toBe('');
    });

    it('marks the copied title/description as user-set, not auto-suggested', () => {
        const state = getInitialState(undefined, TZ, null, buildEndedEvent());

        expect(state.titleIsAutoSuggested).toBe(false);
        expect(state.descriptionIsAutoSuggested).toBe(false);
    });

    it('falls back to defaults with no copy source (ordinary create)', () => {
        const state = getInitialState(undefined, TZ, null, null);

        expect(state.title).toBe('');
        expect(state.durationMinutes).toBe(120);
        expect(state.slotType).toBe('generic');
    });
});

describe('guildId (ROK-1787)', () => {
    it('defaults to null on create and reads the tag in edit and copy modes', () => {
        expect(getInitialState(undefined, TZ).guildId).toBeNull();
        const tagged = buildEndedEvent({ guildId: 9 });
        expect(getInitialState(tagged, TZ).guildId, 'edit mode must show the existing tag').toBe(9);
        expect(
            getInitialState(undefined, TZ, null, tagged).guildId,
            'a copy/follow-up drops the guild — a non-editor cannot see or clear it, so it would 403',
        ).toBeNull();
        expect(getInitialState(buildEndedEvent(), TZ).guildId, 'an untagged event (no field) reads as null').toBeNull();
    });

    it('create sends guildId only when a guild is picked', () => {
        expect(guildIdForSubmit(null, false, null)).toEqual({});
        expect(guildIdForSubmit(9, false, null)).toEqual({ guildId: 9 });
    });

    it('edit sends guildId only when it changed — null clears the tag', () => {
        expect(guildIdForSubmit(9, true, 9), 'an unchanged tag is omitted so a non-editor can still save').toEqual({});
        expect(guildIdForSubmit(null, true, 9)).toEqual({ guildId: null });
        expect(guildIdForSubmit(4, true, 9)).toEqual({ guildId: 4 });
        expect(guildIdForSubmit(4, true, null)).toEqual({ guildId: 4 });
    });

    it('buildSubmitDto carries the guild into the create DTO', () => {
        const form = { ...getInitialState(undefined, TZ), title: 'MC', startDate: '2030-01-08', startTime: '20:00', guildId: 9 };
        expect(buildSubmitDto(form, TZ, 42, false)).toMatchObject({ gameId: 42, guildId: 9 });
        expect(buildSubmitDto({ ...form, guildId: null }, TZ, 42, false)).not.toHaveProperty('guildId');
        expect(buildSubmitDto({ ...form, guildId: null }, TZ, 42, true, null, 9)).toMatchObject({ guildId: null });
    });
});
