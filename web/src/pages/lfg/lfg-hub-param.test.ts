import { describe, expect, it } from 'vitest';
import { parseHubParam } from './lfg-hub-param';

describe('parseHubParam', () => {
    it('accepts a positive integer and ignores anything else', () => {
        expect(parseHubParam('12')).toBe(12);
        expect(parseHubParam(null)).toBeNull();
        expect(parseHubParam('0')).toBeNull();
        expect(parseHubParam('-3')).toBeNull();
        expect(parseHubParam('abc')).toBeNull();
    });
});
