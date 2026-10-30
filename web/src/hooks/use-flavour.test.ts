/** ROK-1700 — resolveFlavour: a missing payload or field means `nas`. */
import { describe, it, expect } from 'vitest';
import { resolveFlavour } from './use-flavour';

describe('resolveFlavour (ROK-1700)', () => {
    it('treats a missing status payload as nas', () => {
        expect(resolveFlavour(undefined)).toBe('nas');
    });

    it('treats a payload without flavour (older api) as nas', () => {
        expect(resolveFlavour({})).toBe('nas');
    });

    it.each(['nas', 'cloud'] as const)('passes %s through', (flavour) => {
        expect(resolveFlavour({ flavour })).toBe(flavour);
    });
});
