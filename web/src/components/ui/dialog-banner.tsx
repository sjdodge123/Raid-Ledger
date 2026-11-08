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
    /**
     * Default `alert` (a 409 / failed save the user just caused). A persistent
     * notice that is already there on load passes `status` so it is not
     * announced as an interruption (ROK-2137).
     */
    role?: 'alert' | 'status';
    /** Default `mb-4` (above a dialog's fields); `''` inside a card's own flow. */
    spacing?: string;
    children: ReactNode;
}

export function DialogBanner({ tone, testId, role = 'alert', spacing = 'mb-4', children }: DialogBannerProps): JSX.Element {
    return (
        <div role={role} data-testid={testId}
            className={`${spacing} flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm ${TONE_CLASS[tone]}`}>
            {children}
        </div>
    );
}
