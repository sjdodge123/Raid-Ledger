/**
 * ROK-1830 — the WoW guild's hero contributions: the realm · region fact, the
 * faction pill, and the "Last imported from LedgerLink" note under the
 * next-raid chip. Core renders the crest, the name and the member count.
 */
import type { JSX } from 'react';
import type { HubCtx } from '../../hub-module';
import { Pill } from '../../../components/hub/hub-bits';
import { guildRealm } from './wow-guild.helpers';

export function WowWhereFact({ page }: HubCtx): JSX.Element {
    const { guild } = page;
    return <span>{[guildRealm(guild), guild.region.toUpperCase()].filter(Boolean).join(' · ')}</span>;
}

export function WowFactionPill({ page }: HubCtx): JSX.Element | null {
    const { faction } = page.guild;
    return faction ? <Pill tone="success">{faction}</Pill> : null;
}

export function wowHeroNote({ page }: HubCtx): string | null {
    const at = page.guild.lastSnapshotAt;
    if (!at) return null;
    const when = new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    return page.importedBy ? `Last imported from LedgerLink ${when} by ${page.importedBy}` : `Last imported from LedgerLink ${when}`;
}
