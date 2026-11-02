/**
 * ROK-1960 §7 — the sheet's one inline banner (§4.7 status tokens; never a
 * toast). `info` ("Already uploaded.") is not a status hue, so it takes the
 * neutral panel.
 */
import type { JSX, ReactNode } from 'react';

export type Bg3UploadBannerTone = 'danger' | 'success' | 'info';

/** §4.7 `warning` status tint — the cross-hub move confirm (`bg3-upload-move-confirm.tsx`). */
export const BG3_UPLOAD_WARNING_PANEL = 'rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm';

const TONE: Readonly<Record<Bg3UploadBannerTone, string>> = {
    danger: 'border-danger/30 bg-danger/10 text-danger',
    success: 'border-success/30 bg-success/10 text-success',
    info: 'border-edge bg-overlay/30 text-secondary',
};

export function Bg3UploadBanner({ tone, children }: { tone: Bg3UploadBannerTone; children: ReactNode }): JSX.Element {
    return (
        <p role={tone === 'danger' ? 'alert' : 'status'} data-testid={`bg3-upload-banner-${tone}`}
            className={`rounded-lg border px-3 py-2 text-sm ${TONE[tone]}`}>
            {children}
        </p>
    );
}
