/**
 * ROK-1786 — the compact "Your guild recommends" card on a WoW character page
 * (prototype `CharacterAddonsCard.tsx`). Only for a character in a guild the
 * viewer can open; nothing otherwise. Read-only: required first, then a link
 * to the guild page's Resources tab. Lazy-loaded by the sections slot.
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';
import type { GuildSummary } from '@raid-ledger/contract';
import { guildAddonView, pinnedAddonView, type AddonView } from '../guild/addon-view';
import { Card, Pill } from '../../../components/hub/hub-bits';
import { guildRealm } from '../hub/wow-guild.helpers';
import { useGuildAddons } from '../../../components/hub/api/use-guild-content';
import { guildHref, useCharacterGuild } from './guild-queries';

function CompactRow({ addon }: { addon: AddonView }): JSX.Element {
    return (
        <li className="flex min-h-[44px] items-center gap-2 border-b border-edge-subtle py-1 last:border-b-0">
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">{addon.name}</span>
            {addon.required && <Pill tone="warning">Required</Pill>}
            <a href={addon.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${addon.name} on ${addon.source}`}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-overlay hover:text-foreground">
                <ArrowTopRightOnSquareIcon className="h-4 w-4" aria-hidden="true" />
            </a>
        </li>
    );
}

function AddonsCardBody({ guild }: { guild: GuildSummary }): JSX.Element | null {
    const { data } = useGuildAddons(guild.id);
    if (!data) return null;
    const rows = [...data.pinned.map(pinnedAddonView), ...data.addons.map(guildAddonView)]
        .sort((a, b) => Number(b.required) - Number(a.required));
    if (rows.length === 0) return null;
    const where = [guild.name, guildRealm(guild)].filter(Boolean).join(' · ');
    return (
        <div data-testid="character-guild-addons"><Card className="max-w-md">
            <h3 className="text-base font-semibold text-foreground">Your guild recommends</h3>
            <p className="mb-2 text-xs text-muted">{where}</p>
            <ul aria-label="Addons your guild recommends">{rows.map((a) => <CompactRow key={a.key} addon={a} />)}</ul>
            <Link to={`${guildHref(guild.id)}#resources`} className="mt-2 inline-flex min-h-[44px] items-center text-sm text-success hover:underline">
                See all on the guild page
            </Link>
        </Card></div>
    );
}

export function CharacterAddonsCard({ characterId }: { characterId: string }): JSX.Element | null {
    const { data } = useCharacterGuild(characterId);
    const entry = data?.data;
    if (!entry?.viewerCanOpen) return null;
    return <AddonsCardBody guild={entry.guild} />;
}
