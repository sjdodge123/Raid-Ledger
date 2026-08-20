/**
 * Tests for the sessionStorage-backed state hook (ROK-1400).
 * Covers restore-across-remount, per-key isolation, key swaps, and the
 * degrade-silently paths (corrupt payload, storage unavailable).
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSessionState } from './use-session-state';

beforeEach(() => {
    window.sessionStorage.clear();
});

describe('useSessionState', () => {
    it('starts from the initial value when nothing is stored', () => {
        const { result } = renderHook(() => useSessionState('k', { n: 1 }));
        expect(result.current.value).toEqual({ n: 1 });
        expect(result.current.restored).toBe(false);
    });

    it('restores the stored value across an unmount / remount', () => {
        const first = renderHook(() => useSessionState('k', { n: 1 }));
        act(() => first.result.current.setValue({ n: 42 }));
        first.unmount();

        const second = renderHook(() => useSessionState('k', { n: 1 }));
        expect(second.result.current.value).toEqual({ n: 42 });
        expect(second.result.current.restored).toBe(true);
    });

    it('keeps different keys isolated', () => {
        const a = renderHook(() => useSessionState('a', 'default'));
        act(() => a.result.current.setValue('mine'));
        a.unmount();

        const b = renderHook(() => useSessionState('b', 'default'));
        expect(b.result.current.value).toBe('default');
    });

    it('swaps to the new key’s stored value when the key changes', () => {
        window.sessionStorage.setItem('two', JSON.stringify('stored-two'));
        const { result, rerender } = renderHook(
            ({ k }) => useSessionState(k, 'default'),
            { initialProps: { k: 'one' } },
        );
        expect(result.current.value).toBe('default');

        rerender({ k: 'two' });
        expect(result.current.value).toBe('stored-two');
        expect(result.current.restored).toBe(true);
    });

    it('does not persist when the key is null', () => {
        const { result } = renderHook(() => useSessionState(null, 'default'));
        act(() => result.current.setValue('typed'));
        expect(result.current.value).toBe('typed');
        expect(window.sessionStorage.length).toBe(0);
    });

    it('falls back to the initial value on a corrupt payload', () => {
        window.sessionStorage.setItem('k', '{not json');
        const { result } = renderHook(() => useSessionState('k', 'default'));
        expect(result.current.value).toBe('default');
    });
});

describe('useSessionState — storage unavailable', () => {
    afterEach(() => vi.restoreAllMocks());

    it('degrades silently when sessionStorage throws', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('private mode');
        });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('private mode');
        });

        const { result } = renderHook(() => useSessionState('k', 'default'));
        expect(result.current.value).toBe('default');
        expect(() => act(() => result.current.setValue('next'))).not.toThrow();
        expect(result.current.value).toBe('next');
    });
});
