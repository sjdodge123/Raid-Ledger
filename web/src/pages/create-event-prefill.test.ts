import { describe, it, expect } from 'vitest';
import { invitePreviewText, parsePositiveIntList, parseUuidList } from './create-event-prefill';

const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('parsePositiveIntList (W1)', () => {
    it('keeps positive integers once, in order, and drops the rest', () => {
        expect(parsePositiveIntList('90000004,abc,-1,90000004')).toEqual([90000004]);
        expect(parsePositiveIntList('3, 1.5,0,2')).toEqual([3, 2]);
    });

    it('returns an empty list for a missing or empty param', () => {
        expect(parsePositiveIntList(null)).toEqual([]);
        expect(parsePositiveIntList('')).toEqual([]);
    });
});

describe('parseUuidList (W2)', () => {
    it('keeps valid uuids in order, de-duplicated, dropping malformed entries', () => {
        expect(parseUuidList(`${uuid(1)},nope,${uuid(2)},${uuid(1)},12345`)).toEqual([uuid(1), uuid(2)]);
    });

    it('keeps only the first five of seven valid uuids', () => {
        const seven = [1, 2, 3, 4, 5, 6, 7].map(uuid);
        expect(parseUuidList(seven.join(','))).toEqual(seven.slice(0, 5));
    });

    it('returns an empty list for a missing param', () => {
        expect(parseUuidList(null)).toEqual([]);
    });
});

describe('invitePreviewText (W3)', () => {
    it('names resolved characters and counts the rest', () => {
        expect(invitePreviewText(['Aelin', 'Brann'], 1)).toBe('Will invite: Aelin, Brann and 1 other character');
        expect(invitePreviewText(['Aelin'], 2)).toBe('Will invite: Aelin and 2 other characters');
        expect(invitePreviewText(['Aelin', 'Brann'], 0)).toBe('Will invite: Aelin, Brann');
    });

    it('falls back to a count when no name resolved', () => {
        expect(invitePreviewText([], 3)).toBe('Will invite 3 characters');
        expect(invitePreviewText([], 1)).toBe('Will invite 1 character');
    });
});
