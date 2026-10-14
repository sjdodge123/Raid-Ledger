/**
 * ROK-1785 entry F (badge): the character page's guild badge — crest, guild
 * name and rank. It links to `/guilds/:id` only when the viewer may open that
 * page (`viewerCanOpen`); otherwise it is plain text. Nothing when the
 * character has no guild.
 */
import type { JSX, ReactNode } from 'react';
import { NavChip } from '../../../components/ui/nav-chip';
import { GuildCrest } from './guild-entry-bits';
import { guildHref, useCharacterGuild } from './guild-queries';

/** NavChip's shape without the hover affordance: it does not navigate. */
const STATIC_CHIP_CLASS = 'inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface text-sm';

export function CharacterGuildBadge({ characterId }: { characterId: string }): JSX.Element | null {
    const { data } = useCharacterGuild(characterId);
    const entry = data?.data;
    if (!entry) return null;
    const content: ReactNode = (
        <>
            <GuildCrest small />
            <span className="font-medium text-foreground">{entry.guild.name}</span>
            {entry.rankName && <span className="text-muted">· {entry.rankName}</span>}
        </>
    );
    if (!entry.viewerCanOpen) {
        return <span className={STATIC_CHIP_CLASS} data-testid="character-guild-badge">{content}</span>;
    }
    return <NavChip to={guildHref(entry.guild.id)} testId="character-guild-badge">{content}</NavChip>;
}
