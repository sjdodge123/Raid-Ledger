/**
 * Clipboard helpers with an insecure-context fallback (ROK-1378).
 *
 * The async Clipboard API (`navigator.clipboard`) is only exposed in secure
 * contexts (HTTPS or localhost). On plain-HTTP LAN deployments it is
 * `undefined`, which previously made every "Copy link" / share button fail
 * silently — `navigator.clipboard.writeText(...)` throws a synchronous
 * TypeError that the call sites' `.catch()` never saw. These helpers
 * feature-detect the Clipboard API and fall back to a hidden `<textarea>` +
 * `document.execCommand('copy')` when it is unavailable, and always surface a
 * failure (via throw / error toast) so copy can never fail silently again.
 */
import { toast } from './toast';
import { Sentry } from '../sentry';

/**
 * Copy `text` to the clipboard, preferring the async Clipboard API and falling
 * back to a legacy `execCommand('copy')` in insecure (HTTP/LAN) contexts.
 *
 * @param text - The string to place on the clipboard.
 * @throws {Error} If neither the Clipboard API nor the legacy fallback succeeds.
 */
export async function copyToClipboard(text: string): Promise<void> {
    if (window.isSecureContext && typeof navigator.clipboard?.writeText === 'function') {
        try {
            await navigator.clipboard.writeText(text);
            return;
        } catch {
            // Secure-context writes can still fail (permissions, unfocused
            // document); fall through to the legacy path, which often rescues it.
        }
    }
    copyViaExecCommand(text);
}

/**
 * Legacy clipboard write via a hidden, selected `<textarea>` and
 * `document.execCommand('copy')`. Works in insecure contexts where the async
 * Clipboard API is unavailable.
 *
 * @param text - The string to copy.
 * @throws {Error} If `execCommand` is unavailable or reports failure.
 */
function copyViaExecCommand(text: string): void {
    if (typeof document.execCommand !== 'function') {
        throw new Error('Clipboard copy is not supported in this browser');
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
        if (!document.execCommand('copy')) {
            throw new Error('document.execCommand("copy") reported failure');
        }
    } finally {
        document.body.removeChild(textarea);
    }
}

/** Optional toast copy for {@link copyWithToast}. */
export interface CopyToastMessages {
    /** Shown on success. Omit to skip the success toast (e.g. inline checkmark). */
    success?: string;
    /** Shown on failure. Defaults to `'Failed to copy'`. */
    error?: string;
    /** Optional description attached to the success toast. */
    description?: string;
}

/**
 * Copy `text` and surface user feedback: a success toast on success, an error
 * toast plus a Sentry capture on failure. Never throws — returns whether the
 * copy succeeded so callers can branch on the result (e.g. toggle a checkmark).
 *
 * @param text - The string to copy.
 * @param messages - Optional success / error toast copy.
 * @returns `true` when the copy succeeded, `false` otherwise.
 */
export async function copyWithToast(
    text: string,
    messages?: CopyToastMessages,
): Promise<boolean> {
    try {
        await copyToClipboard(text);
        if (messages?.success) {
            if (messages.description) {
                toast.success(messages.success, { description: messages.description });
            } else {
                toast.success(messages.success);
            }
        }
        return true;
    } catch (err) {
        toast.error(messages?.error ?? 'Failed to copy');
        Sentry.captureException(err, { tags: { context: 'clipboard-copy' } });
        return false;
    }
}
