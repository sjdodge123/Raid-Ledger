/** Where the token goes (ROK-1833): the BepInEx config keys and the two ingest endpoints, as plain text. */
import type { JSX } from 'react';
import { modConfigLines } from './valheim-link-token.helpers';

/** The §4.7 neutral instruction callout — set-up steps carry no status hue. */
export function ValheimModInstructions({ serverId }: { serverId: string }): JSX.Element {
    const { config, endpoints } = modConfigLines(window.location.origin, serverId);
    return (
        <div className="bg-overlay/30 border border-edge rounded-lg p-4 space-y-2" data-testid="valheim-link-token-instructions">
            <p className="text-sm font-medium text-foreground">Paste into the mod&apos;s BepInEx config</p>
            <pre className="whitespace-pre-wrap break-all font-mono text-xs text-secondary">{config.join('\n')}</pre>
            <p className="text-sm font-medium text-foreground">The mod uploads to</p>
            <pre className="whitespace-pre-wrap break-all font-mono text-xs text-secondary">{endpoints.join('\n')}</pre>
        </div>
    );
}
