import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    formatLastEvent,
    readActiveElement,
    readIcbGap,
    readScreen,
    readSignals,
    readVisibility,
    watchViewportEvents,
} from './viewport-signals';

function stubVisualViewport(height: number): EventTarget {
    const vv = Object.assign(new EventTarget(), { height });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv });
    return vv;
}

afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, 'visualViewport');
    document.body.innerHTML = '';
});

describe('viewport signals (ROK-1661 diagnostic rows)', () => {
    it('icb − vv is documentElement.clientHeight minus visualViewport.height', () => {
        vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(1180);
        stubVisualViewport(604);
        expect(readIcbGap()).toBe('576');
    });

    it('icb − vv reads "-" when there is no visualViewport', () => {
        Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined });
        expect(readIcbGap()).toBe('-');
    });

    it('activeElement names the focused tag and input type, and "none" when only the body has focus', () => {
        expect(readActiveElement()).toBe('none');
        const input = document.createElement('input');
        input.type = 'search';
        const textarea = document.createElement('textarea');
        document.body.append(input, textarea);
        input.focus();
        expect(readActiveElement()).toBe('input[search]');
        textarea.focus();
        expect(readActiveElement()).toBe('textarea');
    });

    it('screen shows screen.width×screen.height and window.innerWidth', () => {
        vi.spyOn(window.screen, 'width', 'get').mockReturnValue(820);
        vi.spyOn(window.screen, 'height', 'get').mockReturnValue(1180);
        vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(820);
        expect(readScreen()).toBe('820×1180 · inner 820');
    });

    it('visibility is document.visibilityState', () => {
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        expect(readVisibility()).toBe('hidden');
    });

    it('last event shows the name and how long ago it fired, or "none"', () => {
        expect(formatLastEvent(null, 5000)).toBe('none');
        expect(formatLastEvent({ name: 'focusout', at: 1000 }, 1375)).toBe('focusout 375ms ago');
    });

    it('readSignals returns the five rows in order', () => {
        vi.spyOn(Date, 'now').mockReturnValue(2000);
        const labels = readSignals({ name: 'pageshow', at: 1900 }).map(([label]) => label);
        expect(labels).toEqual(['icb − vv', 'activeElement', 'screen', 'visibility', 'last event']);
        expect(readSignals({ name: 'pageshow', at: 1900 })[4]).toEqual(['last event', 'pageshow 100ms ago']);
    });

    it('watchViewportEvents reports each watched event by name and stops after cleanup', () => {
        const vv = stubVisualViewport(604);
        const seen: string[] = [];
        const stop = watchViewportEvents((name) => seen.push(name));
        vv.dispatchEvent(new Event('resize'));
        vv.dispatchEvent(new Event('scroll'));
        window.dispatchEvent(new Event('resize'));
        document.body.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
        document.body.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
        window.dispatchEvent(new Event('pageshow'));
        document.dispatchEvent(new Event('visibilitychange'));
        expect(seen).toEqual(['vv.resize', 'vv.scroll', 'resize', 'focusin', 'focusout', 'pageshow', 'visibilitychange']);
        stop();
        window.dispatchEvent(new Event('pageshow'));
        vv.dispatchEvent(new Event('resize'));
        expect(seen).toHaveLength(7);
    });
});
