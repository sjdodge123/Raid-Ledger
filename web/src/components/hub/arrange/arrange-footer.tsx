/**
 * ROK-1918 L5 — the arrange-mode action bar (spec §2.3): Reset to default
 * (left, confirms first), Cancel, Save layout (disabled until dirty). Sticky
 * to the bottom of the visible viewport on every width: below 768px it docks
 * above the phone bottom tab bar and its raised Hubs circle
 * (`--bottom-nav-clearance`, ROK-1875), which would otherwise cover Save;
 * from 768px there is no tab bar, so it sits flush, above the safe area.
 */
import type { JSX } from 'react';
import { Button } from '../../ui/button';

export interface ArrangeFooterProps {
    dirty: boolean;
    saving: boolean;
    error: string | null;
    onReset: () => void;
    onCancel: () => void;
    onSave: () => void;
}

export function ArrangeFooter({ dirty, saving, error, onReset, onCancel, onSave }: ArrangeFooterProps): JSX.Element {
    return (
        <div className="sticky bottom-[var(--bottom-nav-clearance)] z-10 mt-4 flex flex-wrap items-center gap-2 border-t border-edge bg-surface py-3 md:bottom-0 md:pb-[max(0.75rem,env(safe-area-inset-bottom))]"
            data-testid="arrange-footer">
            <Button variant="ghost" size="sm" onClick={onReset} disabled={saving} data-testid="arrange-reset">Reset to default</Button>
            <span className="flex-1" />
            {error !== null && <p role="alert" className="w-full text-sm text-danger sm:order-none sm:w-auto">{error}</p>}
            {dirty && <span className="hidden text-sm text-muted lg:inline">Unsaved changes</span>}
            <Button variant="secondary" size="sm" onClick={onCancel} disabled={saving} data-testid="arrange-cancel">Cancel</Button>
            <Button size="sm" onClick={onSave} loading={saving} disabled={!dirty} data-testid="arrange-save">Save layout</Button>
        </div>
    );
}
