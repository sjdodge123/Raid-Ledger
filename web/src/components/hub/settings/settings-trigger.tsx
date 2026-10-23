/**
 * ROK-1830 S4 — the single settings entry point, in the hero's action area.
 * Rendered only for `viewer.canManageEditors` (Leader = admin/operator today,
 * spec Q1); Officers keep the inline content-edit affordances they already
 * have and see no trigger (D10/Q4).
 */
import type { JSX } from 'react';
import { Cog6ToothIcon } from '@heroicons/react/24/outline';
import { Button } from '../../ui/button';

/**
 * `label` comes from `hubCopy(kind).settingsTitle` — "Hub settings" on a community hub.
 * Below `sm` the label is `sr-only` (icon-only, ROK-1884) so a 375px hero keeps room for the
 * title; the text stays the accessible name. `min-w-[44px]` keeps the touch target square.
 */
export function HubSettingsTrigger({ onOpen, label }: { onOpen: () => void; label: string }): JSX.Element {
    return (
        <Button variant="secondary" size="sm" onClick={onOpen} className="min-w-[44px]" data-testid="guild-settings-trigger">
            <Cog6ToothIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="sr-only sm:not-sr-only" data-testid="guild-settings-trigger-label">{label}</span>
        </Button>
    );
}
