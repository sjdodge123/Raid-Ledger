/**
 * Adversarial tests for ROK-626: signup toast edge cases.
 * Tests all possible assignedSlot values and boundary inputs.
 */
import { describe, it, expect } from 'vitest';
import { getSignupToast } from './signup-toast.helpers';

describe('getSignupToast — exhaustive slot coverage', () => {
    it.each(['tank', 'healer', 'dps', 'flex', 'player'])(
        'returns success toast for non-bench slot: %s',
        (slot) => {
            const result = getSignupToast(slot);
            expect(result.title).toBe('Successfully signed up!');
            expect(result.description).toBe("You're on the roster!");
        },
    );

    it('returns bench toast for bench slot', () => {
        const result = getSignupToast('bench');
        expect(result.title).toBe('Placed on the bench');
        expect(result.description).toContain('roster is full');
        expect(result.description).toContain('promoted');
    });

    it('returns success toast for empty string', () => {
        const result = getSignupToast('');
        expect(result.title).toBe('Successfully signed up!');
    });

    it('returns success toast for undefined', () => {
        const result = getSignupToast(undefined);
        expect(result.title).toBe('Successfully signed up!');
    });

    it('returns success toast for null', () => {
        const result = getSignupToast(null);
        expect(result.title).toBe('Successfully signed up!');
    });

    it('returns success toast for unknown string values', () => {
        const result = getSignupToast('unknown_role');
        expect(result.title).toBe('Successfully signed up!');
        expect(result.description).toBe("You're on the roster!");
    });
});

describe('getSignupToast — return shape', () => {
    it('always returns an object with title and description', () => {
        const cases = ['bench', 'tank', null, undefined, '', 'dps'];
        for (const slot of cases) {
            const result = getSignupToast(slot);
            expect(result).toHaveProperty('title');
            expect(result).toHaveProperty('description');
            expect(typeof result.title).toBe('string');
            expect(typeof result.description).toBe('string');
            expect(result.title.length).toBeGreaterThan(0);
            expect(result.description.length).toBeGreaterThan(0);
        }
    });
});
