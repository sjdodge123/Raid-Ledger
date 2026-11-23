import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
    safeGetItem,
    safeRemoveItem,
    safeSessionGetItem,
    safeSessionRemoveItem,
    safeSessionSetItem,
    safeSetItem,
} from './safe-storage';
import { blockWebStorage } from '../test/block-web-storage';

describe('safe-storage with working storage', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
    });

    it('round-trips localStorage values', () => {
        safeSetItem('k', 'v');
        expect(safeGetItem('k')).toBe('v');
        safeRemoveItem('k');
        expect(safeGetItem('k')).toBeNull();
    });

    it('round-trips sessionStorage values without touching localStorage', () => {
        safeSessionSetItem('k', 'v');
        expect(sessionStorage.getItem('k')).toBe('v');
        expect(localStorage.getItem('k')).toBeNull();
        expect(safeSessionGetItem('k')).toBe('v');
        safeSessionRemoveItem('k');
        expect(sessionStorage.getItem('k')).toBeNull();
    });
});

describe('safe-storage when the browser blocks storage', () => {
    let restore: () => void = () => undefined;
    beforeEach(() => {
        restore = blockWebStorage();
    });
    afterEach(() => restore());

    it('the helper really blocks storage (sanity)', () => {
        expect(() => window.localStorage.getItem('k')).toThrow(/insecure/);
        expect(() => window.sessionStorage.getItem('k')).toThrow(/insecure/);
    });

    it('reads fall back to null', () => {
        expect(safeGetItem('k')).toBeNull();
        expect(safeSessionGetItem('k')).toBeNull();
    });

    it('writes and removals are silent no-ops', () => {
        expect(() => {
            safeSetItem('k', 'v');
            safeRemoveItem('k');
            safeSessionSetItem('k', 'v');
            safeSessionRemoveItem('k');
        }).not.toThrow();
    });
});
