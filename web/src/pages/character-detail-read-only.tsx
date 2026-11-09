/**
 * ROK-2149 — the read-only marks of `CharacterHeader` for a hub roster member
 * with no character: a neutral "Roster member" pill and, for the members
 * audience, the roster facts (rank, last seen). Tokens only.
 */
import type { JSX } from 'react';
import { StatusChip } from '../components/ui/status-chip';

export function RosterMemberPill(): JSX.Element {
    return (
        <StatusChip tone="neutral" title="A guild roster member without a Raid Ledger character">
            <span data-testid="roster-member-pill">Roster member</span>
        </StatusChip>
    );
}

/** "Rank: Officer · Last seen 3 days ago"; nothing when the viewer gets no roster facts. */
export function RosterMemberFacts({ facts, centered = false }: { facts: string[]; centered?: boolean }): JSX.Element | null {
    if (facts.length === 0) return null;
    return <p data-testid="roster-member-facts" className={`mt-1 text-sm text-muted${centered ? ' text-center' : ''}`}>{facts.join(' · ')}</p>;
}
