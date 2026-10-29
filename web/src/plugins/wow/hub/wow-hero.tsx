/**
 * ROK-1830 — the WoW guild's hero contributions: the realm · region fact, the
 * faction pill, the viewer's role chips (ROK-1815) and the "Last imported
 * from LedgerLink" note under the next-raid chip. Core renders the crest, the
 * name and the member count.
 *
 * Founded date: deliberately not rendered — no source exists yet; the
 * Blizzard guild sync (ROK-1170) will add it.
 */
import type { JSX } from 'react';
import type { HubCtx } from '../../hub-module';
import { Pill } from '../../../components/hub/hub-bits';
import { guildRealm } from './wow-guild.helpers';
import { FACTION_LABEL, factionKey, heroRoleBadges } from './wow-hero.helpers';

export function WowWhereFact({ page }: HubCtx): JSX.Element {
    const { guild } = page;
    return <span>{[guildRealm(guild), guild.region.toUpperCase()].filter(Boolean).join(' · ')}</span>;
}

/** Alliance blue / Horde red from the faction tokens; any other value (e.g. Neutral) stays neutral. */
export function WowFactionPill({ page }: HubCtx): JSX.Element | null {
    const { faction } = page.guild;
    if (!faction) return null;
    const key = factionKey(faction);
    if (!key) return <Pill>{faction}</Pill>;
    return <Pill tone={`faction-${key}`}>{FACTION_LABEL[key]}</Pill>;
}

/** ROK-1815 — "Your role": Guild Master / Editor / Member (see `heroRoleBadges`). */
export function WowViewerRolePills({ page }: HubCtx): JSX.Element | null {
    const badges = heroRoleBadges(page.viewer);
    if (badges.length === 0) return null;
    return (
        <>
            {badges.map((badge) => (
                <Pill key={badge} tone={badge === 'Member' ? 'neutral' : 'success'} title="Your role in this guild">
                    <span className="sr-only">Your role: </span>{badge}
                </Pill>
            ))}
        </>
    );
}
