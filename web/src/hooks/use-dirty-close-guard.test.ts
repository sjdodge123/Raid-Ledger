/**
 * ROK-1655 — the shared dirty-close guard (relocated from game-time, ROK-1640).
 *
 * Clean close → `onClose` at once. Dirty close → `confirming`; `keep` dismisses
 * the confirm, `discard` closes once. The `blocked` latch holds for one
 * macrotask after the confirm settles, so the second listener of one Escape
 * dispatch cannot re-open the confirm the first just closed.
 */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useDirtyCloseGuard } from './use-dirty-close-guard';

function setup(isDirty: boolean) {
    const onClose = vi.fn();
    const hook = renderHook(({ dirty }) => useDirtyCloseGuard(dirty, onClose), {
        initialProps: { dirty: isDirty },
    });
    return { onClose, hook };
}

describe('useDirtyCloseGuard', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('closes at once when clean', () => {
        const { onClose, hook } = setup(false);
        act(() => hook.result.current.requestClose());
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(hook.result.current.confirming).toBe(false);
    });

    it('asks to confirm instead of closing when dirty', () => {
        const { onClose, hook } = setup(true);
        act(() => hook.result.current.requestClose());
        expect(hook.result.current.confirming).toBe(true);
        expect(onClose).not.toHaveBeenCalled();
    });

    it('keep dismisses the confirm and keeps the draft', () => {
        const { onClose, hook } = setup(true);
        act(() => hook.result.current.requestClose());
        act(() => hook.result.current.keep());
        expect(hook.result.current.confirming).toBe(false);
        expect(onClose).not.toHaveBeenCalled();
    });

    it('discard closes exactly once', () => {
        const { onClose, hook } = setup(true);
        act(() => hook.result.current.requestClose());
        act(() => hook.result.current.discard());
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(hook.result.current.confirming).toBe(false);
    });

    it('ignores a close request in the same macrotask as keep, then works again', () => {
        const { onClose, hook } = setup(true);
        act(() => hook.result.current.requestClose());
        act(() => hook.result.current.keep());
        act(() => hook.result.current.requestClose());
        expect(hook.result.current.confirming).toBe(false);
        expect(onClose).not.toHaveBeenCalled();
        act(() => { vi.advanceTimersByTime(0); });
        act(() => hook.result.current.requestClose());
        expect(hook.result.current.confirming).toBe(true);
    });
});
