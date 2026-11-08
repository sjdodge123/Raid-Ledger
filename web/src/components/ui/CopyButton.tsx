import { useState, type JSX } from 'react';
import { copyWithToast } from '../../lib/clipboard';

interface CopyButtonProps {
    text: string;
    className?: string;
    /** Fires after a successful copy (not on failure). */
    onCopied?: (() => void) | undefined;
    /**
     * ROK-2136 — visible text beside the icon (e.g. "Copy for in-game"); it reads
     * "Copied" for 2s after a copy. Omitted = the icon-only button named by `title`.
     */
    label?: string | undefined;
}

const ICON_ONLY = 'p-1.5 rounded-md text-muted hover:text-foreground hover:bg-overlay transition-colors';
const LABELLED = 'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted hover:text-foreground hover:bg-overlay transition-colors';

function CopyIcon({ copied }: { copied: boolean }): JSX.Element {
    return copied ? (
        <svg className="w-4 h-4 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
    ) : (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
    );
}

/**
 * Small button that copies text to clipboard — icon-only by default, icon + text
 * with `label`. Shows a checkmark briefly after a successful copy; surfaces an
 * error toast (via {@link copyWithToast}) if the copy fails in an insecure context.
 */
export function CopyButton({ text, className = '', onCopied, label }: CopyButtonProps) {
    const [copied, setCopied] = useState(false);

    const handleCopy = async (): Promise<void> => {
        const ok = await copyWithToast(text);
        if (!ok) return;
        setCopied(true);
        onCopied?.();
        setTimeout(() => setCopied(false), 2000);
    };

    if (label !== undefined) {
        return (
            <button type="button" onClick={handleCopy} className={`${LABELLED} ${className}`}>
                <CopyIcon copied={copied} />
                <span aria-live="polite">{copied ? 'Copied' : label}</span>
            </button>
        );
    }
    return (
        <button type="button" onClick={handleCopy} className={`${ICON_ONLY} ${className}`}
            title={copied ? 'Copied!' : 'Copy to clipboard'}>
            <CopyIcon copied={copied} />
        </button>
    );
}
