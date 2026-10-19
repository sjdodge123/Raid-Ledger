/** ROK-1836 — which state the character page shows. */
import { describe, it, expect } from 'vitest';
import { characterPageState } from './valheim-character-page.helpers';

const base = {
    hasId: true,
    isPending: false,
    isError: false,
    notFound: false,
    hasData: false,
};

describe('characterPageState', () => {
    it('keeps the loaded sheet when a background refetch fails', () =>
        expect(
            characterPageState({ ...base, isError: true, hasData: true }),
        ).toBe('ready'));
    it('fails only when there is no data', () =>
        expect(characterPageState({ ...base, isError: true })).toBe('failed'));
    it('shows the loading skeleton on the initial load', () =>
        expect(characterPageState({ ...base, isPending: true })).toBe(
            'loading',
        ));
    it('a bad id or a 404 is not-found', () => {
        expect(characterPageState({ ...base, hasId: false })).toBe(
            'not-found',
        );
        expect(
            characterPageState({ ...base, isError: true, notFound: true }),
        ).toBe('not-found');
    });
});
