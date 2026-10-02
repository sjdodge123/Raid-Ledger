import { describe, it, expect } from 'vitest';
import { at, defined } from './defined';

describe('defined', () => {
    it('returns the value when it is defined', () => {
        const value = { id: 1 };
        expect(defined(value)).toBe(value);
        expect(defined(0)).toBe(0);
        expect(defined('')).toBe('');
    });

    it('throws a descriptive Error on undefined', () => {
        expect(() => defined(undefined, 'the save button')).toThrow(
            new Error('expected the save button to be defined'),
        );
        expect(() => defined(undefined)).toThrow(
            new Error('expected value to be defined'),
        );
    });

    it('passes null through', () => {
        expect(defined(null, 'avatar')).toBeNull();
    });
});

describe('at', () => {
    it('returns the element at the index', () => {
        expect(at(['a', 'b', 'c'], 1)).toBe('b');
    });

    it('counts a negative index from the end', () => {
        expect(at(['a', 'b', 'c'], -1)).toBe('c');
    });

    it('reads array-likes such as a NodeList', () => {
        const list = { length: 2, 0: 'x', 1: 'y' };
        expect(at(list, 0)).toBe('x');
    });

    it('throws a descriptive Error when the index is out of range', () => {
        expect(() => at(['a'], 3)).toThrow(
            new Error('expected item at index 3 (of 1) to be defined'),
        );
    });

    it('passes a null element through', () => {
        expect(at([null], 0)).toBeNull();
    });
});
