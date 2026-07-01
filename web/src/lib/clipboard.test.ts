/**
 * Unit tests for the clipboard helper (ROK-1378).
 *
 * Covers the three behaviours the fix guarantees:
 *   1. Secure context   → uses the async Clipboard API.
 *   2. Insecure context → falls back to `document.execCommand('copy')`.
 *   3. Total failure     → throws (so callers surface a toast, never silence).
 * Plus the `copyWithToast` UX wrapper (success toast vs. error toast + Sentry).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../sentry', () => ({ Sentry: { captureException: vi.fn() } }));

import { copyToClipboard, copyWithToast } from './clipboard';
import { toast } from './toast';
import { Sentry } from '../sentry';

function setSecureContext(value: boolean): void {
    Object.defineProperty(window, 'isSecureContext', {
        configurable: true,
        value,
    });
}

function setClipboard(clipboard: unknown): void {
    Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: clipboard,
    });
}

/** jsdom does not implement execCommand — install a controllable stub. */
function stubExecCommand(returnValue: boolean): ReturnType<typeof vi.fn> {
    const fn = vi.fn(() => {
        // Capture the text that would have been copied at call time.
        (fn as unknown as { copied?: string }).copied =
            document.querySelector('textarea')?.value;
        return returnValue;
    });
    Object.defineProperty(document, 'execCommand', {
        configurable: true,
        writable: true,
        value: fn,
    });
    return fn;
}

describe('copyToClipboard', () => {
    beforeEach(() => vi.clearAllMocks());
    afterEach(() => vi.restoreAllMocks());

    it('uses the async Clipboard API in a secure context', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        setClipboard({ writeText });
        setSecureContext(true);
        const exec = stubExecCommand(true);

        await copyToClipboard('secure-link');

        expect(writeText).toHaveBeenCalledWith('secure-link');
        expect(exec).not.toHaveBeenCalled();
    });

    it('falls back to execCommand("copy") when the Clipboard API is unavailable (insecure context)', async () => {
        setClipboard(undefined);
        setSecureContext(false);
        const exec = stubExecCommand(true);

        await copyToClipboard('lan-link');

        expect(exec).toHaveBeenCalledWith('copy');
        expect((exec as unknown as { copied?: string }).copied).toBe('lan-link');
        // The temporary textarea is cleaned up afterwards.
        expect(document.querySelector('textarea')).toBeNull();
    });

    it('falls back to execCommand when a secure-context write rejects', async () => {
        const writeText = vi.fn().mockRejectedValue(new Error('NotAllowed'));
        setClipboard({ writeText });
        setSecureContext(true);
        const exec = stubExecCommand(true);

        await copyToClipboard('rescued');

        expect(writeText).toHaveBeenCalled();
        expect(exec).toHaveBeenCalledWith('copy');
    });

    it('throws when both the Clipboard API and the fallback fail', async () => {
        setClipboard(undefined);
        setSecureContext(false);
        stubExecCommand(false);

        await expect(copyToClipboard('nope')).rejects.toThrow();
    });
});

describe('copyWithToast', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setClipboard(undefined);
        setSecureContext(false);
    });
    afterEach(() => vi.restoreAllMocks());

    it('shows a success toast and returns true on success', async () => {
        stubExecCommand(true);

        const ok = await copyWithToast('link', { success: 'Copied!' });

        expect(ok).toBe(true);
        expect(toast.success).toHaveBeenCalledWith('Copied!');
        expect(toast.error).not.toHaveBeenCalled();
        expect(Sentry.captureException).not.toHaveBeenCalled();
    });

    it('shows an error toast and captures to Sentry on failure', async () => {
        stubExecCommand(false);

        const ok = await copyWithToast('link', { error: 'Failed to copy link' });

        expect(ok).toBe(false);
        expect(toast.error).toHaveBeenCalledWith('Failed to copy link');
        expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    });
});
