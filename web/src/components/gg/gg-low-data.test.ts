/** ROK-2187 — Save-Data / slow links get stills only (spec UX line). */
import { afterEach, describe, expect, it } from 'vitest';
import { ggPrefersLowData } from './gg-low-data';

const setConnection = (value: unknown): void => {
    Object.defineProperty(navigator, 'connection', { configurable: true, value });
};

afterEach(() => { setConnection(undefined); });

describe('ggPrefersLowData', () => {
    it('is false without the Network Information API', () => {
        expect(ggPrefersLowData()).toBe(false);
    });
    it('is true under Save-Data', () => {
        setConnection({ saveData: true, effectiveType: '4g' });
        expect(ggPrefersLowData()).toBe(true);
    });
    it.each(['slow-2g', '2g', '3g'])('is true on a %s link', (effectiveType) => {
        setConnection({ saveData: false, effectiveType });
        expect(ggPrefersLowData()).toBe(true);
    });
    it('is false on 4g without Save-Data', () => {
        setConnection({ saveData: false, effectiveType: '4g' });
        expect(ggPrefersLowData()).toBe(false);
    });
});
