/**
 * ROK-1875 D5 — the hub kind label on nav rows and directory cards: a neutral
 * `StatusChip` (kind is a category, not a state), tokens only so it flips with
 * both colour families.
 */
import type { JSX } from 'react';
import type { GuildKind } from '@raid-ledger/contract';
import { StatusChip } from '../../ui/status-chip';

/** The short label each hub kind reads as. */
export const HUB_KIND_LABEL: Record<GuildKind, string> = {
    game_server: 'Server',
    game_community: 'Community',
    wow_guild: 'Guild',
};

/** "Server" / "Community" / "Guild" pill; the title spells out "<Kind> hub". */
export function HubKindChip({ kind }: { kind: GuildKind }): JSX.Element {
    const label = HUB_KIND_LABEL[kind];
    return (
        <span data-testid="hub-kind-chip" className="inline-flex shrink-0">
            <StatusChip tone="neutral" title={`${label} hub`}>{label}</StatusChip>
        </span>
    );
}
