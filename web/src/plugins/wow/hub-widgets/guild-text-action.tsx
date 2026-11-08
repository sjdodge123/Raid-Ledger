/**
 * ROK-2136 — the "Guild message" card's header action: a ghost "Edit" for
 * editors once either field is set (the empty card carries "Add guild text");
 * nothing for members. Imported eagerly by `guild-text.register.ts`, so it uses
 * only the light query layer and the dialog store, never the dialog chunk.
 */
import type { JSX } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '../../../components/ui/button';
import type { HubWidgetCtx } from '../../hub-game-widgets';
import { guildIngameTextQuery } from '../hooks/use-guild-ingame-text';
import { useGuildTextDialog } from './guild-text-dialog-store';

export function GuildTextAction({ page }: HubWidgetCtx): JSX.Element | null {
    const guildId = page.guild.id;
    const { data } = useQuery(guildIngameTextQuery(guildId));
    const open = useGuildTextDialog((s) => s.open);
    if (data === undefined || !data.viewer.canEdit) return null;
    if (data.motd === null && data.info === null) return null;
    return (
        <Button variant="ghost" size="sm" data-testid="guild-text-edit" onClick={() => open(guildId)}>
            Edit
        </Button>
    );
}
