/**
 * Tests for LineupShareCopy (ROK-1378).
 *
 * The public-link "Copy link" affordance must surface a visible error (toast)
 * when the clipboard write fails — the pre-fix code called
 * `navigator.clipboard.writeText` directly, which throws synchronously in
 * insecure contexts (LAN/HTTP) where `navigator.clipboard` is `undefined`,
 * leaving the user with no feedback at all.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../lib/toast', () => ({
    toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('../../sentry', () => ({ Sentry: { captureException: vi.fn() } }));

import { LineupShareCopy } from './LineupShareCopy';
import { toast } from '../../lib/toast';
import { Sentry } from '../../sentry';

function setSecureContext(value: boolean): void {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value });
}

function setClipboard(clipboard: unknown): void {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });
}

function stubExecCommand(returnValue: boolean): void {
    Object.defineProperty(document, 'execCommand', {
        configurable: true,
        writable: true,
        value: vi.fn(() => returnValue),
    });
}

describe('LineupShareCopy', () => {
    beforeEach(() => vi.clearAllMocks());
    afterEach(() => vi.restoreAllMocks());

    it('surfaces a toast.error when the copy fails (insecure context, no clipboard)', async () => {
        setClipboard(undefined);
        setSecureContext(false);
        stubExecCommand(false); // both clipboard + fallback unavailable

        render(<LineupShareCopy slug="raid-night" />);
        await userEvent.click(screen.getByRole('button', { name: /copy public link/i }));

        expect(toast.error).toHaveBeenCalledWith('Failed to copy link');
        expect(toast.success).not.toHaveBeenCalled();
        expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    });

    it('surfaces a toast.success when the copy succeeds', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        setClipboard({ writeText });
        setSecureContext(true);

        render(<LineupShareCopy slug="raid-night" />);
        await userEvent.click(screen.getByRole('button', { name: /copy public link/i }));

        expect(writeText).toHaveBeenCalledWith(
            `${window.location.origin}/p/lineup/raid-night`,
        );
        expect(toast.success).toHaveBeenCalledWith('Public link copied');
        expect(toast.error).not.toHaveBeenCalled();
    });
});
