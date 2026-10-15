/** ROK-1775 — the calendar layer show/hide store + its preference write. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updatePreference } from '../lib/api-client';
import { getAuthToken } from '../hooks/use-auth';
import { CALENDAR_HIDDEN_LAYERS_PREF, useCalendarLayerFilterStore } from './calendar-layer-filter-store';

vi.mock('../lib/api-client', () => ({ updatePreference: vi.fn(() => Promise.resolve()) }));
vi.mock('../hooks/use-auth', () => ({ getAuthToken: vi.fn(() => 'token') }));

const store = () => useCalendarLayerFilterStore.getState();

describe('useCalendarLayerFilterStore (ROK-1775)', () => {
    beforeEach(() => {
        store()._reset();
        vi.mocked(updatePreference).mockClear();
        vi.mocked(getAuthToken).mockReturnValue('token');
    });

    it('defaults to every layer shown', () => {
        expect([...store().hiddenLayers]).toEqual([]);
    });

    it('toggling a layer off and on persists the hidden key list each time', () => {
        store().toggleLayer('p:layer');
        expect([...store().hiddenLayers]).toEqual(['p:layer']);
        expect(updatePreference).toHaveBeenLastCalledWith(CALENDAR_HIDDEN_LAYERS_PREF, ['p:layer']);
        store().toggleLayer('p:layer');
        expect([...store().hiddenLayers]).toEqual([]);
        expect(updatePreference).toHaveBeenLastCalledWith(CALENDAR_HIDDEN_LAYERS_PREF, []);
    });

    it('showAllLayers clears and persists, and is a no-op when nothing is hidden', () => {
        store().showAllLayers();
        expect(updatePreference).not.toHaveBeenCalled();
        store().toggleLayer('p:layer');
        store().showAllLayers();
        expect([...store().hiddenLayers]).toEqual([]);
        expect(updatePreference).toHaveBeenLastCalledWith(CALENDAR_HIDDEN_LAYERS_PREF, []);
    });

    it('loading the saved preference applies it without writing it back', () => {
        store().loadHiddenLayers(['p:layer']);
        expect(store().hiddenLayers.has('p:layer')).toBe(true);
        expect(updatePreference).not.toHaveBeenCalled();
    });

    it('does not write the preference when signed out', () => {
        vi.mocked(getAuthToken).mockReturnValue(null);
        store().toggleLayer('p:layer');
        expect(store().hiddenLayers.has('p:layer')).toBe(true);
        expect(updatePreference).not.toHaveBeenCalled();
    });
});
