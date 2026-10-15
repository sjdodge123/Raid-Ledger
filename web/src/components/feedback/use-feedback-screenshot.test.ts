/**
 * ROK-1313 — a screenshot read still pending when the dialog unmounts must
 * revoke its object URL when it completes, not keep the image alive.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { FeedbackScreenshot } from './feedback-screenshot';

const read = vi.hoisted(() => ({ resolve: (_s: FeedbackScreenshot) => {} }));

vi.mock('./feedback-screenshot', () => ({
    SCREENSHOT_ERROR: 'error',
    validateScreenshotFile: vi.fn(() => null),
    readScreenshot: vi.fn(() => new Promise<FeedbackScreenshot>((r) => { read.resolve = r; })),
}));

const revoke = vi.fn();
const originalRevoke = URL.revokeObjectURL;

beforeEach(() => { revoke.mockClear(); URL.revokeObjectURL = revoke; });
afterEach(() => { URL.revokeObjectURL = originalRevoke; });

describe('useFeedbackScreenshot — unmount during a read', () => {
    it('revokes the late preview URL of a read that completes after unmount', async () => {
        const { useFeedbackScreenshot } = await import('./use-feedback-screenshot');
        const { result, unmount } = renderHook(() => useFeedbackScreenshot());
        act(() => { result.current.attachScreenshot(new File(['x'], 'a.png', { type: 'image/png' })); });
        unmount();
        const late = { previewUrl: 'blob:late-read' } as FeedbackScreenshot;
        await act(async () => { read.resolve(late); await Promise.resolve(); });
        expect(revoke.mock.calls).toEqual([['blob:late-read']]);
    });
});
