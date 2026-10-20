/**
 * ROK-1428 (L7, spec §3.2) — the bindings list's Lifecycle cell: auto-managed
 * rows only. A state chip ("Active" / "Archived <date>"), a "Managed" badge
 * and a Pin / Unpin toggle. Manual rows render nothing (no stray badge).
 */
import type { JSX } from 'react';
import { format } from 'date-fns';
import type { ChannelBindingDto } from '@raid-ledger/contract';
import { Button } from '../ui/button';
import { StatusChip } from '../ui/status-chip';

/** The pin toggle's wiring, scoped by the list to the row that pinned last. */
export interface LifecyclePinState {
    /** Called with the NEW pinned value. */
    onPin: (id: string, pinned: boolean) => void;
    /** This row's pin PATCH is in flight. */
    loading: boolean;
    /** Another PATCH is in flight (one at a time). */
    locked: boolean;
    /** This row's rejected pin. */
    error?: string | null | undefined;
}

interface LifecycleCellProps { binding: ChannelBindingDto; pin: LifecyclePinState }

function stateLabel(binding: ChannelBindingDto): string {
    if (binding.lifecycleState !== 'archived') return 'Active';
    return binding.archivedAt ? `Archived ${format(new Date(binding.archivedAt), 'MMM d')}` : 'Archived';
}

/** Lifecycle chip + Managed badge + pin toggle, or null for a manual binding. */
export function ChannelBindingLifecycleCell({ binding, pin }: LifecycleCellProps): JSX.Element | null {
    if (!binding.autoManaged) return null;
    const archived = binding.lifecycleState === 'archived';
    const pinned = binding.pinned === true;
    const verb = pinned ? 'Unpin' : 'Pin';
    return (
        <div className="flex flex-wrap items-center gap-2 mt-1" data-testid="binding-lifecycle-cell">
            <StatusChip tone={archived ? 'neutral' : 'success'} title={archived ? 'Archived by Raid Ledger' : 'Active'}>
                {stateLabel(binding)}
            </StatusChip>
            <StatusChip tone="neutral" title="Created and archived by Raid Ledger">Managed</StatusChip>
            {pinned && <StatusChip tone="neutral" title="Never archived or unarchived automatically">Pinned</StatusChip>}
            <Button size="sm" variant="ghost" loading={pin.loading} disabled={pin.locked}
                aria-pressed={pinned} aria-label={`${verb} #${binding.channelName ?? binding.channelId}`}
                title="Pinned channels are never archived or unarchived automatically"
                onClick={() => pin.onPin(binding.id, !pinned)}>
                {verb}
            </Button>
            {pin.error && <span role="alert" className="text-xs text-danger">{pin.error}</span>}
        </div>
    );
}
