import { describe, it, expect } from 'vitest';
import { compactJoin } from './compact-join';

describe('compactJoin (ROK-2140 meta separators)', () => {
    it('joins only the present parts with " · "', () => {
        expect(compactJoin(['Night Elf Warrior', 'Protection'])).toBe('Night Elf Warrior · Protection');
    });

    it.each([
        [[null, 'Warrior', undefined]],
        [['', 'Warrior', '  ']],
        [[undefined, null, 'Warrior', false]],
    ])('never yields a leading or trailing "·" for %j', (parts) => {
        const out = compactJoin(parts);
        expect(out).toBe('Warrior');
        expect(out.startsWith('·')).toBe(false);
        expect(out.endsWith('·')).toBe(false);
    });

    it('returns an empty string when nothing is present', () => {
        expect(compactJoin([null, undefined, '', false])).toBe('');
    });

    it('accepts a custom separator', () => {
        expect(compactJoin(['Night Elf', null, 'Warrior'], ' ')).toBe('Night Elf Warrior');
    });
});
