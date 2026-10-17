import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveVpDebug, wantsNoShellFloor } from './vpdebug-flag';

afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
});

describe('resolveVpDebug (ROK-1661 readout flag)', () => {
    it('remembers ?vpdebug=1 for a later bare URL and forgets it on ?vpdebug=0', () => {
        expect(resolveVpDebug('')).toBe(false);
        expect(resolveVpDebug('?vpdebug=1')).toBe(true);
        expect(resolveVpDebug('')).toBe(true);
        expect(resolveVpDebug('?vpdebug=0')).toBe(false);
        expect(resolveVpDebug('')).toBe(false);
    });

    it('still honours the URL when storage throws', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
        expect(resolveVpDebug('?vpdebug=1')).toBe(true);
        expect(resolveVpDebug('')).toBe(false);
    });
});

describe('wantsNoShellFloor (ROK-1661 ?noshellfloor experiment flag)', () => {
    it('is off by default and on only for ?noshellfloor=1, and is not remembered', () => {
        expect(wantsNoShellFloor('')).toBe(false);
        expect(wantsNoShellFloor('?vpdebug=1')).toBe(false);
        expect(wantsNoShellFloor('?noshellfloor=0')).toBe(false);
        expect(wantsNoShellFloor('?noshellfloor=1')).toBe(true);
        expect(wantsNoShellFloor('?vpdebug=1&noshellfloor=1')).toBe(true);
        expect(wantsNoShellFloor('')).toBe(false);
    });
});
