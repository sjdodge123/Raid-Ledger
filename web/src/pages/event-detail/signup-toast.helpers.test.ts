/**
 * ROK-626: Tests for signup toast feedback helper.
 * Verifies bench-specific messaging when assignedSlot === 'bench'.
 */
import { describe, it, expect } from 'vitest';
import { getSignupToast } from './signup-toast.helpers';

describe('getSignupToast', () => {
    it('returns roster message when no assignedSlot', () => {
        const result = getSignupToast(undefined);
        expect(result.title).toBe('Successfully signed up!');
        expect(result.description).toBe("You're on the roster!");
    });

    it('returns roster message for non-bench slot', () => {
        const result = getSignupToast('dps');
        expect(result.title).toBe('Successfully signed up!');
        expect(result.description).toBe("You're on the roster!");
    });

    it('returns bench message when assignedSlot is bench', () => {
        const result = getSignupToast('bench');
        expect(result.title).toBe('Placed on the bench');
        expect(result.description).toBe(
            'The roster is full. You will be promoted when a slot opens up.',
        );
    });

    it('returns roster message for null assignedSlot', () => {
        const result = getSignupToast(null);
        expect(result.title).toBe('Successfully signed up!');
        expect(result.description).toBe("You're on the roster!");
    });
});
