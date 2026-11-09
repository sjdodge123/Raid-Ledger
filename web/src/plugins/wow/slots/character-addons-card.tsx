/**
 * ROK-1786 — the compact "Your guild recommends" card on a WoW character page
 * (prototype `CharacterAddonsCard.tsx`). Only for a character in a guild the
 * viewer can open; nothing otherwise. Read-only: required first, then a link
 * to the guild page's Resources tab. Lazy-loaded by the sections slot.
 * ROK-2147: for the owner and the guild's officers, each recommendation with a
 * folder name shows Installed / Missing from the LedgerLink export, plus the
 * other installed folders; everyone else sees the card exactly as before.
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import type { CharacterInstalledAddonsResponse, GuildSummary } from '@raid-ledger/contract';
import { guildAddonView, pinnedAddonView } from '../guild/addon-view';
import { Card } from '../../../components/hub/hub-bits';
import { guildRealm } from '../hub/wow-guild.helpers';
import { useGuildAddons } from '../../../components/hub/api/use-guild-content';
import { guildHref, useCharacterGuild } from './guild-queries';
import { useCharacterInstalledAddons } from './character-installed-addons-query';
import { CompactRow, InstalledAddonsList } from './character-addons-card.parts';

/** The installed list when the viewer may see it and an export carried one; else null (card as before). */
function visibleInstalled(res: CharacterInstalledAddonsResponse | undefined): CharacterInstalledAddonsResponse['installed'] {
    return res?.visible ? res.installed : null;
}

function AddonsCardBody({ guild, characterId }: { guild: GuildSummary; characterId: string }): JSX.Element | null {
    const { data } = useGuildAddons(guild.id);
    const installedQuery = useCharacterInstalledAddons(characterId);
    if (!data || installedQuery.isLoading) return null;
    const installed = visibleInstalled(installedQuery.data);
    const rows = [...data.pinned.map(pinnedAddonView), ...data.addons.map(guildAddonView)]
        .sort((a, b) => Number(b.required) - Number(a.required));
    if (rows.length === 0) return null;
    const where = [guild.name, guildRealm(guild)].filter(Boolean).join(' · ');
    return (
        <div data-testid="character-guild-addons"><Card>
            <h3 className="text-base font-semibold text-foreground">Your guild recommends</h3>
            <p className="mb-2 text-xs text-muted">{where}</p>
            {installed ? <InstalledAddonsList rows={rows} installed={installed} /> : (
                <ul aria-label="Addons your guild recommends">{rows.map((a) => <CompactRow key={a.key} addon={a} />)}</ul>
            )}
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
    return <AddonsCardBody guild={entry.guild} characterId={characterId} />;
}
