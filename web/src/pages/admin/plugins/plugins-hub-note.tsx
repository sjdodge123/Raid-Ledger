/**
 * ROK-1969 §5.4 — the one-line note under "Manage Plugins" (copy approved,
 * operator ruling 2026-10-25): where hub widgets and tabs come from.
 */
import type { JSX } from 'react';

/** Panel note: hub widgets and tabs come from plugins; Core is always on. */
export function PluginsHubNote(): JSX.Element {
    return (
        <p data-testid="plugins-hub-note"
            className="flex gap-2 rounded-lg border border-edge bg-panel px-3 py-2 text-sm text-secondary">
            <span aria-hidden="true" className="text-muted">ⓘ</span>
            <span>
                <strong className="font-medium text-foreground">Hub widgets and tabs come from plugins.</strong>{' '}
                Core is built in and always on, so every hub can add its widgets; a game plugin adds its own only to
                hubs of its games.
            </span>
        </p>
    );
}
