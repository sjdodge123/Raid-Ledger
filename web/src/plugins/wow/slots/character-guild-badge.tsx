/**
 * ROK-1785 entry F (badge): the character page's guild badge — crest, guild
 * name and rank, linking to `/guilds/:id`. Nothing when the character has no guild.
 */
import type { JSX } from 'react';
import { NavChip } from '../../../components/ui/nav-chip';
import { GuildCrest } from './guild-entry-bits';
import { guildHref, useCharacterGuild } from './guild-queries';

export function CharacterGuildBadge({ characterId }: { characterId: string }): JSX.Element | null {
    const { data } = useCharacterGuild(characterId);
    const entry = data?.data;
    if (!entry) return null;
    return (
        <NavChip to={guildHref(entry.guild.id)} testId="character-guild-badge">
            <GuildCrest small />
            <span className="font-medium text-foreground">{entry.guild.name}</span>
            {entry.rankName && <span className="text-muted">· {entry.rankName}</span>}
        </NavChip>
    );
}
