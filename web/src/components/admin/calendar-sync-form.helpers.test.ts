import { describe, it, expect } from 'vitest';
import { buildCalendarSyncUpdate, buildProviderUpdate, draftFromSettings } from './calendar-sync-form.helpers';
import { calendarSyncSettingsFixture } from '../../test/mocks/calendar-sync-handlers';

describe('buildProviderUpdate (ROK-1591)', () => {
    it('returns undefined when nothing changed', () => {
        expect(buildProviderUpdate({ clientId: 'id', secret: '', secretCleared: false }, 'id')).toBeUndefined();
    });

    it('sends "" when the admin empties a saved client id', () => {
        expect(buildProviderUpdate({ clientId: '  ', secret: '', secretCleared: false }, 'id')).toEqual({ clientId: '' });
    });

    it('a typed secret wins over a pending removal', () => {
        expect(buildProviderUpdate({ clientId: '', secret: ' new ', secretCleared: true }, null))
            .toEqual({ clientSecret: 'new' });
    });
});

describe('buildCalendarSyncUpdate (ROK-1591)', () => {
    it('is empty for an untouched draft', () => {
        const draft = draftFromSettings(calendarSyncSettingsFixture);
        expect(buildCalendarSyncUpdate(draft, calendarSyncSettingsFixture)).toEqual({});
    });

    it('carries enabled only when the switch differs from the saved value', () => {
        const draft = { ...draftFromSettings(calendarSyncSettingsFixture), enabled: true };
        expect(buildCalendarSyncUpdate(draft, calendarSyncSettingsFixture)).toEqual({ enabled: true });
        expect(buildCalendarSyncUpdate(draft, { ...calendarSyncSettingsFixture, enabled: true })).toEqual({});
    });
});
