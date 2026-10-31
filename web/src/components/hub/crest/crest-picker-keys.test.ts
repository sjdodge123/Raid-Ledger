import { describe, it, expect } from 'vitest';
import { radioKeyTarget } from './crest-picker-keys';

describe('radioKeyTarget', () => {
    const ids = [4, 5, 6];
    it('moves and wraps with the arrows', () => {
        expect(radioKeyTarget(ids, 2, 'ArrowRight')).toBe(4);
        expect(radioKeyTarget(ids, 0, 'ArrowUp')).toBe(6);
        expect(radioKeyTarget(ids, 1, 'ArrowDown')).toBe(6);
    });
    it('jumps with Home / End and ignores other keys', () => {
        expect(radioKeyTarget(ids, 1, 'Home')).toBe(4);
        expect(radioKeyTarget(ids, 1, 'End')).toBe(6);
        expect(radioKeyTarget(ids, 1, 'Enter')).toBeUndefined();
    });
});
