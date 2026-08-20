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

    it('evicts an unparseable payload so it cannot wedge later mounts', () => {
        window.sessionStorage.setItem('k', '{not json');
        renderHook(() => useSessionState('k', 'default'));
        expect(window.sessionStorage.getItem('k')).toBeNull();
    });
});

// Stored JSON is untrusted: hand-editable, and shape-drifted blobs outlive
// deploys. Without validation a bad blob restores straight into state and
// takes the consumer down for the whole tab session.
describe('useSessionState — validate', () => {
    const asString = (raw: unknown): string | null =>
        typeof raw === 'string' ? raw : null;

    it('rejects a value of the wrong shape and uses the initial instead', () => {
        window.sessionStorage.setItem('k', JSON.stringify({ nope: 1 }));
        const { result } = renderHook(() =>
            useSessionState('k', 'default', asString),
        );
        expect(result.current.value).toBe('default');
        expect(result.current.restored).toBe(false);
    });

    it('evicts a rejected value so it is not re-read on every mount', () => {
        window.sessionStorage.setItem('k', JSON.stringify(42));
        renderHook(() => useSessionState('k', 'default', asString));
        expect(window.sessionStorage.getItem('k')).toBeNull();
    });

    it('passes a valid value through untouched', () => {
        window.sessionStorage.setItem('k', JSON.stringify('stored'));
        const { result } = renderHook(() =>
            useSessionState('k', 'default', asString),
        );
        expect(result.current.value).toBe('stored');
        expect(result.current.restored).toBe(true);
    });

    it('lets the validator narrow a partially-bad object', () => {
        window.sessionStorage.setItem(
            'k',
            JSON.stringify({ good: 1, bad: 'drop me' }),
        );
        const { result } = renderHook(() =>
            useSessionState<{ good: number }>('k', { good: 0 }, (raw) => {
                const r = raw as Record<string, unknown>;
                return typeof r?.good === 'number' ? { good: r.good } : null;
            }),
        );
        expect(result.current.value).toEqual({ good: 1 });
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
