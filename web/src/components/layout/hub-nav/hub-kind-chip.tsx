/**
 * ROK-1875 D5 — the hub kind label on nav rows and directory cards: a neutral
 * `StatusChip` (kind is a category, not a state), tokens only so it flips with
 * both colour families.
 */
import type { JSX } from 'react';
import type { GuildKind } from '@raid-ledger/contract';
import { StatusChip, type StatusChipSize } from '../../ui/status-chip';
import { HUB_KIND_LABEL } from './hub-kind-label';

/** "Server" / "Community" / "Guild" pill; the title spells out "<Kind> hub". */
export function HubKindChip({ kind, size = 'sm' }: { kind: GuildKind; size?: StatusChipSize }): JSX.Element {
    const label = HUB_KIND_LABEL[kind];
    return (
        <span data-testid="hub-kind-chip" className="inline-flex shrink-0">
            <StatusChip tone="neutral" size={size} title={`${label} hub`}>{label}</StatusChip>
        </span>
    );
}

/** Re-exported for the directory (L4 imports it from here). */
export { HUB_KIND_LABEL } from './hub-kind-label';
