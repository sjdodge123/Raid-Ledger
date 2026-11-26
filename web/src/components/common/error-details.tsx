/**
 * The raw error text behind a friendly failure notice (ROK-2342 S4): collapsed in a
 * `<details>` so a 500 never shows a stack-ish message as the headline, but support
 * can still read it. Renders nothing when there is no message.
 */
import type { JSX } from 'react';
import { errorText } from '../../lib/error-text';

export function ErrorDetails({ error, className = 'mt-4' }: { error: unknown; className?: string }): JSX.Element | null {
    const text = errorText(error);
    if (!text) return null;
    return (
        <details className={`${className} mx-auto max-w-md text-left text-xs text-dim`}>
            <summary className="cursor-pointer text-center hover:text-muted">Technical details</summary>
            <p className="mt-2 break-words rounded-md border border-edge bg-panel p-2 font-mono">{text}</p>
        </details>
    );
}
