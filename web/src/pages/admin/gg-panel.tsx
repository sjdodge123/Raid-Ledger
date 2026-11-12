import type { JSX } from 'react';
import { GgDeliverySettings } from './gg/gg-delivery-settings';
import { GgMascotSection } from './gg/gg-mascot-section';
import { GgAdminActions } from './gg/gg-admin-actions';
import { GgPreviewLauncher } from './gg/gg-preview-launcher';

/** Admin → General → GG (ROK-2187): delivery, community mascot, dry run / send. */
export function GgPanel(): JSX.Element {
    const year = new Date().getFullYear();
    return (
        <div className="space-y-6" data-testid="gg-admin-panel">
            <div>
                <h2 className="text-xl font-semibold text-foreground">GG {year}</h2>
                <p className="text-sm text-muted mt-1">Each player's year in review — when it goes out, the intro mascot and a dry run before sending.</p>
            </div>
            <GgDeliverySettings />
            <GgMascotSection />
            <GgPreviewLauncher />
            <GgAdminActions year={year} />
        </div>
    );
}
