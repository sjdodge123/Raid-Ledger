/** ROK-1959 D-7 — the Saves filter: its own chip after Screenshots, only when the hub has save pictures. */
import { describe, expect, it } from 'vitest';
import { availableFilters, clampHubMediaFilter, kindForFilter } from './hub-media-query';

describe('hub-media-query — Saves filter (ROK-1959)', () => {
    it('kindForFilter maps save to the save kind and All to no kind', () => {
        expect(kindForFilter('save')).toBe('save');
        expect(kindForFilter('all')).toBeUndefined();
    });

    it('a hub with only saves gets All + Saves', () => {
        expect(availableFilters(['save'])).toEqual(['all', 'save']);
    });

    it('uploads + saves give All · Screenshots · Saves, in that order', () => {
        expect(availableFilters(['upload', 'save'])).toEqual(['all', 'screenshot', 'save']);
    });

    it('every kind gives All · Deaths · Screenshots · Saves', () => {
        expect(availableFilters(['save', 'image', 'death'])).toEqual(['all', 'death', 'screenshot', 'save']);
    });

    it('no save kind → no Saves chip, and a chosen Saves clamps back to All', () => {
        expect(availableFilters(['death', 'screenshot'])).toEqual(['all', 'death', 'screenshot']);
        expect(clampHubMediaFilter('save', ['death', 'screenshot'])).toBe('all');
        expect(clampHubMediaFilter('save', ['death', 'save'])).toBe('save');
    });
});
