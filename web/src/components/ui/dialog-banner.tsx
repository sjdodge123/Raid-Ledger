/**
 * The §4.7 inline banner an editor dialog shows above its fields: `warning`
 * for a 409 ("Someone else changed this…" + a "Load their version" action),
 * `danger` for a failed save. Shared by the hub session-note dialog and the
 * Forever "Guild message" dialog (ROK-2136). Token tints only.
 */
import type { JSX, ReactNode } from 'react';

export type DialogBannerTone = 'warning' | 'danger';

const TONE_CLASS: Record<DialogBannerTone, string> = {
    warning: 'border-warning/30 bg-warning/10 text-warning',
    danger: 'border-danger/30 bg-danger/10 text-danger',
};

interface DialogBannerProps {
    tone: DialogBannerTone;
    /** e.g. `session-note-conflict` / `guild-text-error`. */
    testId: string;
    children: ReactNode;
}

export function DialogBanner({ tone, testId, children }: DialogBannerProps): JSX.Element {
    return (
        <div role="alert" data-testid={testId}
            className={`mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm ${TONE_CLASS[tone]}`}>
            {children}
        </div>
    );
}
